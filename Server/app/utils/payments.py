"""Payment confirmation: money becomes income only when an administrator confirms it was received.

Before this, an auction collected or a Smart Tag approved was counted as income automatically. Now those events only put the sale in a
queue ("awaiting payment confirmation"). The queue is DERIVED from the auctions and Smart Tags themselves, so it can never disagree with
them. An administrator opens an item, says how it was paid (and the GCash, Maya or bank reference), and confirms. That single action:
  * writes ONE sale into the income ledger, at the amount the SERVER reads from the auction or tag (the browser only echoes it back,
    so a stale screen cannot confirm the wrong amount);
  * issues a payment receipt (PR-<date>-AU-<auction> / PR-<date>-TG-<tag>) with a verification code, in the payer's My receipts, by
    in-app notice and by email;
  * is written to the activity log.
GCash, Maya and bank payments need PROOF: the payer's receipt screenshot. The payer can submit it themselves (`submit_proof`, shown to the
administrator in the queue) or the administrator can attach one while confirming. The proof is kept, privately, with the confirmed payment.
A wrong confirmation is not edited: a super administrator REVERSES it, which adds a refund row linked to the receipt (the receipt then
verifies as reversed). Auctions can still be handed over before payment is confirmed, so the desk is never blocked; those items are
flagged "released, payment not confirmed" until someone confirms them.
A SELLER'S auction (someone's own item, see seller_auctions.py) is confirmed the same way, but the seller's share is written to the ledger
in the same insert as the sale (kind 'payout', negative), so income counts only the office's commission, and a payout is opened for the
seller. Reversing it also cancels the seller's share; it is refused once the seller has been paid.
"""
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional

from app.utils import receipts
from app.utils.income import MAX_ROWS, METHODS, IncomeError, IncomeService, IncomeUnavailable, _missing_schema, _parse_moment, money

logger = logging.getLogger(__name__)

PAYABLE = ('auction', 'smart_tag')
NEEDS_REFERENCE = ('gcash', 'maya', 'bank')
SETUP_MESSAGE = 'Payment confirmation is not set up yet. Run Server/manual_migrations/20261024_payment_confirmation.sql in Supabase.'
PROOF_SETUP = 'Payment proofs are not set up yet. Run Server/manual_migrations/20261025_payment_proofs_and_matching.sql in Supabase.'
PROOF_BUCKET = 'payment-proofs'
PROOF_URL_SECONDS = 600
PROOF_METHODS = ('gcash', 'maya', 'bank', 'other')       # a payer submits proof for a payment made outside the office


def _clean(value: Any, limit: int) -> str:
    return ' '.join(str(value or '').split())[:limit]


class PaymentDesk:
    def __init__(self, db):
        self.db = db
        self.client = db.client
        self.ledger = IncomeService(db)

    # ------------------------------------------------------------------ what is owed
    def _record(self, source: str, ref: str) -> Dict[str, Any]:
        """The authoritative amount, payer and description for an auction or tag, or an IncomeError saying why there is nothing to confirm."""
        if source == 'auction':
            rows = self._auction_rows('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status', lambda q: q.eq('auction_id', ref).limit(1))
            if not rows:
                raise IncomeError('This auction was not found.', 404, 'not_found')
            row = rows[0]
            amount = Decimal(str(row.get('winning_amount') or 0))
            if amount <= 0:
                raise IncomeError('This auction has no winning amount to confirm.', 409, 'nothing_owed')
            if not row.get('winner_account_id') or row.get('fulfillment_status') not in ('awaiting_pickup', 'collected'):
                raise IncomeError('There is no winner payment to confirm for this auction (it has no winner, or it was forfeited).', 409, 'nothing_owed')
            return {'source': 'auction', 'ref': str(row['auction_id']), 'title': row.get('title') or 'Auction item', 'description': f"Auction: {row.get('title') or 'item'}",
                    'payer': row.get('winner_account_id'), 'amount': amount, 'released': row.get('fulfillment_status') == 'collected', 'item_reference': row.get('item_reference') or '',
                    'seller': row.get('seller_account_id'), 'auction': row}
        rows = self.client.table('smart_tags').select('tag_id,status,price,paid_at,is_disabled,owner_account_id,item_name').eq('tag_id', ref).limit(1).execute().data or []
        if not rows:
            raise IncomeError('This Smart Tag was not found.', 404, 'not_found')
        row = rows[0]
        amount = Decimal(str(row.get('price') or 0))
        if amount <= 0:
            raise IncomeError('This Smart Tag is free, so there is no payment to confirm.', 409, 'nothing_owed')
        if not row.get('owner_account_id') or row.get('status') == 'blank':
            raise IncomeError('Nobody has registered this Smart Tag yet, so there is nobody to take payment from.', 409, 'nothing_owed')
        if row.get('is_disabled'):
            raise IncomeError('This Smart Tag is disabled.', 409, 'nothing_owed')
        return {'source': 'smart_tag', 'ref': str(row['tag_id']), 'title': row.get('item_name') or 'Smart Tag', 'description': f"Smart Tag {row['tag_id']} ({row.get('item_name') or 'item'})",
                'payer': row.get('owner_account_id'), 'amount': amount, 'released': False, 'item_reference': str(row['tag_id'])}

    def _auction_rows(self, columns: str, narrow: Callable) -> List[Dict[str, Any]]:
        """Auctions with their seller columns, or without them on a database that has not run the seller auctions migration yet."""
        try:
            return narrow(self.client.table('auctions').select(columns + ',seller_account_id,submission_id')).execute().data or []
        except Exception as error:
            if 'seller_account_id' not in str(error) and 'submission_id' not in str(error):
                raise
            return narrow(self.client.table('auctions').select(columns)).execute().data or []

    def _seller_split(self, auction: Dict[str, Any], amount: Decimal) -> Optional[Dict[str, Any]]:
        if not auction.get('seller_account_id'):
            return None
        from app.utils.seller_auctions import SellerDesk
        return SellerDesk(self.db).split_for(auction, amount)

    def _sales(self, source: str, refs: List[str]) -> Dict[str, Dict[str, Any]]:
        if not refs:
            return {}
        try:
            rows = self.client.table('income_ledger').select('*').eq('source', source).eq('kind', 'sale').in_('source_ref', refs).execute().data or []
        except Exception as error:
            if _missing_schema(error):
                raise IncomeUnavailable('Income tracking is not set up yet. Run Server/manual_migrations/20261022_income_ledger.sql in Supabase.') from error
            raise
        return {str(r['source_ref']): r for r in rows}

    def awaiting(self) -> Dict[str, Any]:
        """Everything that is owed and not yet confirmed: auction winners and registered priced Smart Tags."""
        items: List[Dict[str, Any]] = []
        try:
            auctions = self._auction_rows('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status,fulfillment_updated_at,ended_at',
                                          lambda q: q.eq('status', 'ended').in_('fulfillment_status', ['awaiting_pickup', 'collected']).not_.is_('winner_account_id', 'null').limit(MAX_ROWS))
        except Exception as error:
            logger.info('Auction payments unavailable: %s', str(error)[:120])
            auctions = []
        auctions = [a for a in auctions if Decimal(str(a.get('winning_amount') or 0)) > 0]
        paid = self._sales('auction', [str(a['auction_id']) for a in auctions])
        for a in auctions:
            if str(a['auction_id']) in paid:
                continue
            released = a.get('fulfillment_status') == 'collected'
            split = None
            if a.get('seller_account_id'):
                try:
                    split = self._seller_split(a, Decimal(str(a['winning_amount'])))
                except Exception as error:
                    logger.info('Seller split unavailable: %s', str(error)[:120])
            items.append({'source': 'auction', 'source_ref': str(a['auction_id']), 'title': a.get('title') or 'Auction item', 'reference': a.get('item_reference') or '',
                          'payer_account_id': a.get('winner_account_id'), 'amount': float(Decimal(str(a['winning_amount']))), 'released': released,
                          'state': 'released' if released else 'awaiting_pickup', 'since': a.get('fulfillment_updated_at') or a.get('ended_at'),
                          'seller_listing': bool(a.get('seller_account_id')),
                          'seller_split': {'commission': float(split['commission']), 'share': float(split['share']), 'rate': float(split['rate'])} if split else None})
        try:
            tags = self.client.table('smart_tags').select('tag_id,status,price,paid_at,is_disabled,owner_account_id,item_name').neq('status', 'blank').not_.is_('owner_account_id', 'null').limit(MAX_ROWS).execute().data or []
        except Exception as error:
            logger.info('Smart Tag payments unavailable (price column needs 20261022): %s', str(error)[:120])
            tags = []
        tags = [t for t in tags if Decimal(str(t.get('price') or 0)) > 0 and not t.get('is_disabled')]
        paid_tags = self._sales('smart_tag', [str(t['tag_id']) for t in tags])
        for t in tags:
            if str(t['tag_id']) in paid_tags:
                continue
            items.append({'source': 'smart_tag', 'source_ref': str(t['tag_id']), 'title': t.get('item_name') or 'Smart Tag', 'reference': str(t['tag_id']),
                          'payer_account_id': t.get('owner_account_id'), 'amount': float(Decimal(str(t['price']))), 'released': False,
                          'state': 'pending_approval' if t.get('status') == 'pending_verification' else 'registered', 'since': None})
        names = self.ledger._names([i['payer_account_id'] for i in items])
        for item in items:
            item['payer_name'] = names.get(str(item['payer_account_id']), '')
        proofs: Dict[Any, Dict[str, Any]] = {}
        for source in PAYABLE:
            for ref, proof in self._proofs(source, [i['source_ref'] for i in items if i['source'] == source]).items():
                proofs[(source, ref)] = proof
        for item in items:
            proof = proofs.get((item['source'], item['source_ref']))
            item['proof'] = self._proof_view(proof) if proof else None
        items.sort(key=lambda i: (not i['released'], i['proof'] is None, str(i.get('since') or '')))     # handed over unpaid first, then proof submitted, then oldest
        total = sum(Decimal(str(i['amount'])) for i in items)
        unpaid_released = [i for i in items if i['released']]
        return {'items': items, 'totals': {
            'count': len(items), 'amount': float(total),
            'auction': float(sum(Decimal(str(i['amount'])) for i in items if i['source'] == 'auction')), 'auction_count': sum(1 for i in items if i['source'] == 'auction'),
            'smart_tag': float(sum(Decimal(str(i['amount'])) for i in items if i['source'] == 'smart_tag')), 'smart_tag_count': sum(1 for i in items if i['source'] == 'smart_tag'),
            'released_unpaid': float(sum(Decimal(str(i['amount'])) for i in unpaid_released)), 'released_unpaid_count': len(unpaid_released),
            'proofs_waiting': sum(1 for i in items if i['proof']),
        }}

    def status(self, source: str, ref: str) -> Dict[str, Any]:
        """For one auction or tag: confirmed (with its receipt), awaiting confirmation (with the amount), or nothing owed."""
        if source not in PAYABLE or not ref:
            raise IncomeError('Choose an auction or a Smart Tag.')
        sale = self._sales(source, [str(ref)]).get(str(ref))
        if sale:
            return {'state': 'confirmed', 'receipt_no': sale.get('receipt_no') or receipts.payment_number(source, ref, _parse_moment(sale.get('received_at'))), 'amount': float(Decimal(str(sale['amount']))), 'method': sale.get('method'), 'entry_id': sale.get('entry_id')}
        try:
            record = self._record(source, str(ref))
        except IncomeError as error:
            if error.code in ('nothing_owed', 'not_found'):
                return {'state': 'none', 'reason': error.message}
            raise
        name = self.ledger._names([record['payer']]).get(str(record['payer']), '')
        proof = self._proofs(source, [str(ref)]).get(str(ref))
        return {'state': 'awaiting', 'amount': float(record['amount']), 'title': record['title'], 'payer_name': name, 'released': record['released'], 'proof': self._proof_view(proof) if proof else None}

    def paid_map(self, source: str, refs: List[str]) -> Optional[Dict[str, Dict[str, Any]]]:
        """ref -> the confirmed, not reversed sale ({amount, receipt_no}) for each of these items. None when income tracking is not set up yet."""
        refs = [str(r) for r in refs if r]
        if not refs:
            return {}
        try:
            sales = self._sales(source, refs)
        except IncomeUnavailable:
            return None
        reversed_numbers = receipts._reversed_numbers(self.db)
        paid = {}
        for ref, sale in sales.items():
            number = receipts._entry_number(sale)
            if number not in reversed_numbers:
                paid[ref] = {'amount': float(Decimal(str(sale.get('amount') or 0))), 'receipt_no': number}
        return paid

    def is_paid(self, source: str, ref: str) -> Optional[bool]:
        """True when a payment was confirmed (and not reversed), False when it was not, None when income tracking is not set up yet."""
        paid = self.paid_map(source, [ref])
        return None if paid is None else str(ref) in paid

    # ------------------------------------------------------------------ confirming
    def confirm(self, source: str, source_ref: str, method: Any, reference: Any, notes: Any, expected_amount: Any, admin_id: str,
                proof_id: Any = None, proof_data: Optional[bytes] = None) -> Dict[str, Any]:
        if source not in PAYABLE:
            raise IncomeError('Choose an auction or a Smart Tag.')
        method = str(method or '').strip().lower()
        if method not in METHODS:
            raise IncomeError('Choose how the money was paid.')
        ref = str(source_ref or '').strip()
        record = self._record(source, ref)
        proof_row = None
        if proof_id:
            proof_row = self._proof_row(proof_id)
            if not proof_row or proof_row.get('source') != source or str(proof_row.get('source_ref')) != record['ref'] or proof_row.get('status') != 'pending':
                raise IncomeError('That payment proof is no longer waiting for review. Reload the list.', 409, 'proof_gone')
        reference = _clean(reference, 64) or (_clean(proof_row.get('reference'), 64) if proof_row else '')
        if method in NEEDS_REFERENCE and len(reference) < 4:
            raise IncomeError('Enter the payment reference number (at least 4 characters) for GCash, Maya or bank payments.')
        if method in NEEDS_REFERENCE and not proof_row and not proof_data:
            raise IncomeError("Attach the payer's payment receipt (a screenshot or photo) for GCash, Maya and bank payments.", 400, 'proof_required')
        if expected_amount in (None, ''):
            raise IncomeError('Confirm the amount you received.')
        if money(expected_amount) != record['amount']:
            raise IncomeError(f"The amount owed is now ₱{record['amount']:,.2f}, not what your screen showed. Reload and check again.", 409, 'amount_changed')
        existing = self._sales(source, [record['ref']]).get(record['ref'])
        if existing:
            raise IncomeError(f"This payment was already confirmed (receipt {existing.get('receipt_no') or 'on file'}).", 409, 'already_confirmed')
        split = self._seller_split(record['auction'], record['amount']) if source == 'auction' and record.get('seller') else None
        uploaded = None
        if proof_data and not proof_row:
            uploaded = self._store_image(record['ref'], proof_data)        # validated and stored before the sale is written
        proof_path = proof_row['image_path'] if proof_row else uploaded
        now = datetime.now(timezone.utc)
        row = {
            'source': source, 'kind': 'sale', 'source_ref': record['ref'][:64], 'description': record['description'][:255], 'amount': str(record['amount']),
            'payer_account_id': str(record['payer']) if record['payer'] else None, 'method': method, 'payment_reference': reference or None,
            'receipt_no': receipts.payment_number(source, record['ref'], now), 'notes': _clean(notes, 300) or None,
            'recorded_by': str(admin_id), 'received_at': now.isoformat(),
        }
        if proof_path:
            row['proof_path'] = proof_path
        rows = [row]
        if split and split['share'] > 0:
            # The seller's share is not the office's income. Same keys as the sale, one insert: both rows are written or neither is.
            rows.append({**row, 'kind': 'payout', 'amount': str(-split['share']), 'payer_account_id': str(record['seller']), 'payment_reference': None,
                         'receipt_no': None, 'notes': f"Owed to the seller ({float(split['rate']):g}% office fee ₱{split['commission']:,.2f} kept)",
                         'description': f"Seller's share: {record['title']}"[:255], **({'proof_path': None} if proof_path else {})})
        try:
            written = self.client.table('income_ledger').insert(rows if len(rows) > 1 else row).execute().data or rows
            entry = next((r for r in written if r.get('kind') == 'sale'), written[0])
        except Exception as error:
            self._remove_image(uploaded)
            text = str(error).lower()
            if 'duplicate' in text or '23505' in text:
                raise IncomeError('This payment was already confirmed.', 409, 'already_confirmed') from error
            if 'proof_path' in text:
                raise IncomeUnavailable(PROOF_SETUP) from error
            if 'payment_reference' in text:
                raise IncomeUnavailable(SETUP_MESSAGE) from error
            if 'kind' in text and ('check' in text or '23514' in text):
                raise IncomeUnavailable('Seller auctions are not set up yet. Run Server/manual_migrations/20261027_seller_auctions.sql in Supabase.') from error
            if _missing_schema(error):
                raise IncomeUnavailable('Income tracking is not set up yet. Run Server/manual_migrations/20261022_income_ledger.sql in Supabase.') from error
            raise
        if source == 'smart_tag':
            try:
                self.client.table('smart_tags').update({'paid_at': now.isoformat()}).eq('tag_id', record['ref']).is_('paid_at', 'null').execute()
            except Exception as error:
                logger.warning('Smart Tag %s paid_at not saved: %s', record['ref'], error)
        self._close_proofs(source, record['ref'], accepted=proof_row, admin_id=admin_id)
        if split:
            from app.utils.seller_auctions import SellerDesk
            SellerDesk(self.db).open_payout(record['auction'], entry, split)
        receipt = receipts.receipt_for_payment(self.db, entry['entry_id'])
        self._notify_paid(record, receipt)
        return {'entry': entry, 'receipt': receipt}

    def _notify_paid(self, record: Dict[str, Any], receipt: Optional[Dict[str, Any]], notice: bool = True) -> bool:
        """Tell the payer: an in-app notice and an email with the receipt number and code. Never fails the confirmation. True if the email was accepted."""
        if not receipt or not record.get('payer'):
            return False
        sent = False
        if notice:
            try:
                self.db.create_user_notification(
                    str(record['payer']), 'Payment received', f"Your payment for \"{record['title']}\" was confirmed. Open your receipts to print or save the receipt.",
                    notification_type='receipt', link_label='View receipt', link_page='receipts',
                )
            except Exception as error:
                logger.warning('Payment notice failed: %s', error)
        try:
            profile = self.db.get_user_by_account_id(str(record['payer'])) or {}
            if profile.get('email'):
                from app.utils.email_service import send_notice_email_best_effort, site_url
                sent = send_notice_email_best_effort(
                    profile['email'], f"Payment receipt {receipt['receipt_no']}", title='Payment received', preheader=f"Receipt {receipt['receipt_no']}",
                    greeting=f"Hello {str(profile.get('fname') or '').strip() or 'there'},",
                    paragraphs=[f"The Lost and Found Office confirmed your payment of PHP {Decimal(str(receipt['amount'])):,.2f} for \"{record['title']}\". Keep this receipt number and code: anyone can use them to check the receipt is genuine."],
                    highlight=('RECEIPT NUMBER', receipt['receipt_no']), highlight_note=f"Verification code {receipt['code']}",
                    details={'Item': record['title'], 'Amount': f"PHP {Decimal(str(receipt['amount'])):,.2f}", 'Paid by': METHODS.get(receipt.get('method'), receipt.get('method'))},
                    cta=('View my receipts', site_url()),
                )
        except Exception as error:
            logger.warning('Payment receipt email failed: %s', error)
        return bool(sent)

    def resend_receipt(self, entry_id: str) -> bool:
        """Email a payment receipt to the payer again (no new in-app notice). A reversed receipt is not sent."""
        receipt = receipts.receipt_for_payment(self.db, entry_id)
        if not receipt:
            raise IncomeError('This entry has no payment receipt.', 404, 'not_found')
        if receipt.get('reversed'):
            raise IncomeError('This receipt was reversed, so it cannot be sent again.', 409, 'already_reversed')
        if not receipt.get('owner_id'):
            raise IncomeError('This payment has no payer on file to send the receipt to.', 409, 'no_payer')
        return self._notify_paid({'payer': receipt['owner_id'], 'title': receipt['item']['name']}, receipt, notice=False)

    # ------------------------------------------------------------------ reversing (super administrators)
    def reverse(self, entry_id: str, reason: Any, admin_id: str, before_commit: Optional[Callable[[], None]] = None) -> Dict[str, Any]:
        """Reverse a confirmed payment with a linked refund. `before_commit` runs after every check has passed and before anything is written:
        the route puts the authenticator code there, so a code is only spent on a reversal that will really happen."""
        reason = _clean(reason, 300)
        if len(reason) < 8:
            raise IncomeError('Give the reason for reversing this payment (at least 8 characters). It stays in the record.')
        rows = self.client.table('income_ledger').select('*').eq('entry_id', str(entry_id)).limit(1).execute().data or []
        if not rows or rows[0].get('kind') != 'sale':
            raise IncomeError('Only a confirmed payment can be reversed.', 404, 'not_found')
        sale = rows[0]
        number = sale.get('receipt_no') or receipts.payment_number(sale['source'], sale.get('source_ref') or '', _parse_moment(sale.get('received_at')))
        linked = self.client.table('income_ledger').select('entry_id').eq('kind', 'refund').eq('receipt_no', number).limit(1).execute().data or []
        if linked:
            raise IncomeError('This payment was already reversed.', 409, 'already_reversed')
        share = self._seller_share(sale)
        if share:
            from app.utils.seller_auctions import SellerDesk
            payout = SellerDesk(self.db).payout_for(sale.get('source_ref'))
            if payout and payout.get('status') == 'paid':
                raise IncomeError(f"The seller was already paid for this sale (receipt {payout.get('receipt_no')}). Recover the money from the seller first, "
                                  'then record the refund as a manual adjustment.', 409, 'seller_paid')
        if before_commit:
            before_commit()
        now = datetime.now(timezone.utc)
        row = {
            'source': sale['source'], 'kind': 'refund', 'source_ref': sale.get('source_ref'), 'description': f"Reversal of {number}: {sale.get('description') or ''}"[:255],
            'amount': str(-Decimal(str(sale['amount']))), 'payer_account_id': sale.get('payer_account_id'), 'method': sale.get('method') or 'cash', 'receipt_no': number,
            'notes': reason, 'recorded_by': str(admin_id), 'received_at': now.isoformat(),
        }
        rows = [row]
        if share:
            rows.append({**row, 'kind': 'payout', 'amount': str(-Decimal(str(share['amount']))), 'payer_account_id': share.get('payer_account_id'),
                         'receipt_no': None, 'description': f"Seller's share cancelled ({number} reversed)"[:255]})
        try:
            written = self.client.table('income_ledger').insert(rows if len(rows) > 1 else row).execute().data or rows
            entry = next((r for r in written if r.get('kind') == 'refund'), written[0])
        except Exception as error:
            if _missing_schema(error):
                raise IncomeUnavailable('Income tracking is not set up yet.') from error
            raise
        if share:
            from app.utils.seller_auctions import SellerDesk
            SellerDesk(self.db).cancel_payout(sale.get('source_ref'), reason)
        if sale.get('payer_account_id'):
            try:
                self.db.create_user_notification(
                    str(sale['payer_account_id']), 'Payment receipt reversed', f"The payment receipt {number} was reversed by the office. Contact the Lost and Found Office if you have questions.",
                    notification_type='receipt', link_label='View receipts', link_page='receipts',
                )
            except Exception as error:
                logger.warning('Reversal notice failed: %s', error)
        return {'entry': entry, 'receipt_no': number}

    def _seller_share(self, sale: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """The seller's share written with this sale, if it was a seller's auction and the share was not cancelled already."""
        if sale.get('source') != 'auction' or not sale.get('source_ref'):
            return None
        try:
            rows = self.client.table('income_ledger').select('entry_id,amount,payer_account_id').eq('source', 'auction').eq('kind', 'payout').eq('source_ref', sale['source_ref']).execute().data or []
        except Exception:
            return None
        owed = [r for r in rows if Decimal(str(r.get('amount') or 0)) < 0]
        if not owed or any(Decimal(str(r.get('amount') or 0)) > 0 for r in rows):
            return None
        return owed[0]

    # ------------------------------------------------------------------ the log
    def activity(self, limit: Any = 100) -> List[Dict[str, Any]]:
        """Every income action by an administrator (confirmations, reversals, manual entries, exports), newest first."""
        try:
            limit = max(1, min(int(limit), 300))
        except (TypeError, ValueError):
            limit = 100
        rows = self.client.table('user_activity_logs').select('log_id,user_name,action,target_name,target_id,result,created_at').eq('module_name', 'Income').order('created_at', desc=True).limit(limit).execute().data or []
        return [{k: r.get(k) for k in ('log_id', 'user_name', 'action', 'target_name', 'target_id', 'result', 'created_at')} for r in rows]

    # ------------------------------------------------------------------ payment proofs (the payer's GCash, Maya or bank receipt)
    def _store_image(self, ref: str, data: bytes) -> str:
        """Validate and upload a proof image to the private bucket. Returns its storage path (never sent to a browser)."""
        from app.utils.smart_tags import MAX_PHOTO_BYTES, sniff_image
        if not data:
            raise IncomeError('Choose the payment receipt image first.', 400, 'proof_required')
        if len(data) > MAX_PHOTO_BYTES:
            raise IncomeError('That image is larger than 5 MB. Use a smaller screenshot.', 400, 'proof_too_large')
        kind = sniff_image(data)
        if not kind:
            raise IncomeError('The payment receipt must be a JPG, PNG or WEBP image.', 400, 'proof_invalid')
        path = f"{str(ref)[:40]}/{uuid.uuid4().hex}.{kind[0]}"
        try:
            self.client.storage.from_(PROOF_BUCKET).upload(path, data, {'content-type': kind[1], 'upsert': 'false'})
        except Exception as error:
            text = str(error).lower()
            logger.warning('Payment proof upload failed: %s', error)
            if 'bucket' in text and ('not found' in text or 'does not exist' in text):
                raise IncomeUnavailable(PROOF_SETUP) from error
            raise IncomeError('The image could not be saved. Check the connection and try again.', 502, 'proof_upload_failed') from error
        return path

    def _remove_image(self, path: Optional[str]) -> None:
        if not path:
            return
        try:
            self.client.storage.from_(PROOF_BUCKET).remove([path])
        except Exception as error:
            logger.warning('Payment proof cleanup failed: %s', error)

    def signed_url(self, path: Optional[str]) -> Optional[str]:
        """A link that works for ten minutes. The raw storage path never leaves the server."""
        if not path:
            return None
        try:
            result = self.client.storage.from_(PROOF_BUCKET).create_signed_url(path, PROOF_URL_SECONDS)
            if isinstance(result, dict):
                return result.get('signedURL') or result.get('signedUrl') or result.get('signed_url')
        except Exception as error:
            logger.warning('Payment proof link failed: %s', error)
        return None

    def _proof_row(self, proof_id: Any) -> Optional[Dict[str, Any]]:
        try:
            rows = self.client.table('payment_proofs').select('*').eq('proof_id', str(proof_id)).limit(1).execute().data or []
        except Exception as error:
            if 'payment_proofs' in str(error):
                raise IncomeUnavailable(PROOF_SETUP) from error
            raise
        return rows[0] if rows else None

    def _proofs(self, source: str, refs: List[str], statuses: tuple = ('pending',)) -> Dict[str, Dict[str, Any]]:
        """The newest proof (with one of these statuses) for each item. Empty when the proofs table does not exist yet."""
        if not refs:
            return {}
        try:
            rows = self.client.table('payment_proofs').select('*').eq('source', source).in_('source_ref', refs).in_('status', list(statuses)).order('created_at', desc=True).limit(MAX_ROWS).execute().data or []
        except Exception as error:
            logger.info('Payment proofs unavailable (run 20261025): %s', str(error)[:120])
            return {}
        latest: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            latest.setdefault(str(row['source_ref']), row)
        return latest

    @staticmethod
    def _proof_view(proof: Dict[str, Any]) -> Dict[str, Any]:
        return {'proof_id': proof.get('proof_id'), 'method': proof.get('method'), 'reference': proof.get('reference') or '', 'note': proof.get('note') or '',
                'status': proof.get('status'), 'created_at': proof.get('created_at'), 'review_note': proof.get('review_note') or ''}

    def _close_proofs(self, source: str, ref: str, accepted: Optional[Dict[str, Any]], admin_id: str) -> None:
        """After a confirmation: the proof used is accepted, any other waiting proof for the item is closed."""
        now = datetime.now(timezone.utc).isoformat()
        try:
            if accepted:
                self.client.table('payment_proofs').update({'status': 'accepted', 'reviewed_by': str(admin_id), 'reviewed_at': now}).eq('proof_id', str(accepted['proof_id'])).execute()
            self.client.table('payment_proofs').update({'status': 'replaced', 'reviewed_at': now}).eq('source', source).eq('source_ref', ref).eq('status', 'pending').execute()
        except Exception as error:
            logger.info('Payment proofs not closed: %s', str(error)[:120])

    def submit_proof(self, payer_id: str, source: str, source_ref: str, method: Any, reference: Any, note: Any, data: bytes) -> Dict[str, Any]:
        """The payer sends the receipt of a GCash, Maya or bank payment for their own auction win or Smart Tag. An administrator reviews it."""
        if source not in PAYABLE:
            raise IncomeError('Choose an auction or a Smart Tag.')
        method = str(method or '').strip().lower()
        if method not in PROOF_METHODS:
            raise IncomeError('Choose GCash, Maya, bank transfer or other. Cash is paid at the office.')
        reference = _clean(reference, 64)
        if method in NEEDS_REFERENCE and len(reference) < 4:
            raise IncomeError('Enter the reference number shown on your payment receipt (at least 4 characters).')
        record = self._record(source, str(source_ref or '').strip())
        if str(record['payer']) != str(payer_id):
            raise IncomeError('This payment is not yours.', 403, 'not_payer')
        if self._sales(source, [record['ref']]).get(record['ref']):
            raise IncomeError('This payment was already confirmed. Open your receipts to see it.', 409, 'already_confirmed')
        path = self._store_image(record['ref'], data)
        row = {'source': source, 'source_ref': record['ref'][:64], 'payer_account_id': str(payer_id), 'method': method, 'reference': reference or None,
               'note': _clean(note, 300) or None, 'image_path': path, 'status': 'pending'}
        try:
            self.client.table('payment_proofs').update({'status': 'replaced', 'reviewed_at': datetime.now(timezone.utc).isoformat()}).eq('source', source).eq('source_ref', record['ref']).eq('status', 'pending').execute()
            proof = (self.client.table('payment_proofs').insert(row).execute().data or [row])[0]
        except Exception as error:
            self._remove_image(path)
            if 'payment_proofs' in str(error):
                raise IncomeUnavailable(PROOF_SETUP) from error
            raise
        return self._proof_view(proof)

    def reject_proof(self, proof_id: str, reason: Any, admin_id: str) -> Dict[str, Any]:
        """The proof is not acceptable (unreadable, wrong amount, wrong reference). The payer is told why and can send another."""
        reason = _clean(reason, 300)
        if len(reason) < 4:
            raise IncomeError('Tell the payer what is wrong with the receipt (at least 4 characters).')
        proof = self._proof_row(proof_id)
        if not proof or proof.get('status') != 'pending':
            raise IncomeError('This proof is no longer waiting for review.', 409, 'proof_gone')
        self.client.table('payment_proofs').update({'status': 'rejected', 'reviewed_by': str(admin_id), 'reviewed_at': datetime.now(timezone.utc).isoformat(), 'review_note': reason}).eq('proof_id', str(proof_id)).eq('status', 'pending').execute()
        if proof.get('payer_account_id'):
            try:
                self.db.create_user_notification(
                    str(proof['payer_account_id']), 'Payment receipt not accepted', f'The office could not accept the payment receipt you sent: {reason} You can send another one.',
                    notification_type='receipt', link_label='Send a new receipt', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Proof rejection notice failed: %s', error)
        return {'proof_id': proof_id, 'status': 'rejected'}

    def proof_url(self, proof_id: str) -> Optional[str]:
        proof = self._proof_row(proof_id)
        return self.signed_url(proof.get('image_path')) if proof else None

    def entry_proof_url(self, entry_id: str) -> Optional[str]:
        rows = self.client.table('income_ledger').select('proof_path').eq('entry_id', str(entry_id)).limit(1).execute().data or []
        return self.signed_url(rows[0].get('proof_path')) if rows else None

    # ------------------------------------------------------------------ what the payer sees
    def instructions(self) -> str:
        from app.utils import system_control as control
        return str((control.load_settings(self.db, force=True).get('payment_instructions') or {}).get('text') or '')

    def set_instructions(self, text: Any, admin_id: str) -> str:
        from app.utils import system_control as control
        cleaned = '\n'.join(' '.join(line.split()) for line in str(text or '').splitlines())[:800].strip()
        control.save_setting(self.db, 'payment_instructions', {'text': cleaned}, admin_id)
        return cleaned

    def my_payments(self, account_id: str) -> Dict[str, Any]:
        """The payer's own auction wins and registered Smart Tags that cost money: what is owed, the proof they sent, and the receipt once paid."""
        mine = [i for i in self.awaiting()['items'] if str(i['payer_account_id']) == str(account_id)]
        result = []
        for item in mine:
            latest = self._proofs(item['source'], [item['source_ref']], statuses=('pending', 'rejected')).get(item['source_ref'])
            result.append({'source': item['source'], 'source_ref': item['source_ref'], 'title': item['title'], 'amount': item['amount'], 'state': 'awaiting', 'released': item['released'],
                           'proof': self._proof_view(latest) if latest else None, 'receipt_no': None})
        return {'items': result, 'instructions': self.instructions()}
