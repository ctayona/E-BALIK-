"""Payment confirmation: money becomes income only when an administrator confirms it was received.

Before this, an auction collected or a Smart Tag approved was counted as income automatically. Now those events only put the sale in a
queue ("awaiting payment confirmation"). The queue is DERIVED from the auctions and Smart Tags themselves, so it can never disagree with
them. An administrator opens an item, says how it was paid (and the GCash, Maya or bank reference), and confirms. That single action:
  * writes ONE sale into the income ledger, at the amount the SERVER reads from the auction or tag (the browser only echoes it back,
    so a stale screen cannot confirm the wrong amount);
  * issues a payment receipt (PR-<date>-AU-<auction> / PR-<date>-TG-<tag>) with a verification code, in the payer's My receipts, by
    in-app notice and by email;
  * is written to the activity log.
A wrong confirmation is not edited: a super administrator REVERSES it, which adds a refund row linked to the receipt (the receipt then
verifies as reversed). Auctions can still be handed over before payment is confirmed, so the desk is never blocked; those items are
flagged "released, payment not confirmed" until someone confirms them.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.utils import receipts
from app.utils.income import MAX_ROWS, METHODS, IncomeError, IncomeService, IncomeUnavailable, _missing_schema, _parse_moment, money

logger = logging.getLogger(__name__)

PAYABLE = ('auction', 'smart_tag')
NEEDS_REFERENCE = ('gcash', 'maya', 'bank')
SETUP_MESSAGE = 'Payment confirmation is not set up yet. Run Server/manual_migrations/20261024_payment_confirmation.sql in Supabase.'


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
            rows = self.client.table('auctions').select('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status').eq('auction_id', ref).limit(1).execute().data or []
            if not rows:
                raise IncomeError('This auction was not found.', 404, 'not_found')
            row = rows[0]
            amount = Decimal(str(row.get('winning_amount') or 0))
            if amount <= 0:
                raise IncomeError('This auction has no winning amount to confirm.', 409, 'nothing_owed')
            if not row.get('winner_account_id') or row.get('fulfillment_status') not in ('awaiting_pickup', 'collected'):
                raise IncomeError('There is no winner payment to confirm for this auction (it has no winner, or it was forfeited).', 409, 'nothing_owed')
            return {'source': 'auction', 'ref': str(row['auction_id']), 'title': row.get('title') or 'Auction item', 'description': f"Auction: {row.get('title') or 'item'}",
                    'payer': row.get('winner_account_id'), 'amount': amount, 'released': row.get('fulfillment_status') == 'collected', 'item_reference': row.get('item_reference') or ''}
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
            auctions = self.client.table('auctions').select('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status,fulfillment_updated_at,ended_at') \
                .eq('status', 'ended').in_('fulfillment_status', ['awaiting_pickup', 'collected']).not_.is_('winner_account_id', 'null').limit(MAX_ROWS).execute().data or []
        except Exception as error:
            logger.info('Auction payments unavailable: %s', str(error)[:120])
            auctions = []
        auctions = [a for a in auctions if Decimal(str(a.get('winning_amount') or 0)) > 0]
        paid = self._sales('auction', [str(a['auction_id']) for a in auctions])
        for a in auctions:
            if str(a['auction_id']) in paid:
                continue
            released = a.get('fulfillment_status') == 'collected'
            items.append({'source': 'auction', 'source_ref': str(a['auction_id']), 'title': a.get('title') or 'Auction item', 'reference': a.get('item_reference') or '',
                          'payer_account_id': a.get('winner_account_id'), 'amount': float(Decimal(str(a['winning_amount']))), 'released': released,
                          'state': 'released' if released else 'awaiting_pickup', 'since': a.get('fulfillment_updated_at') or a.get('ended_at')})
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
        items.sort(key=lambda i: (not i['released'], str(i.get('since') or '')))     # released-but-unpaid first, then oldest
        total = sum(Decimal(str(i['amount'])) for i in items)
        unpaid_released = [i for i in items if i['released']]
        return {'items': items, 'totals': {
            'count': len(items), 'amount': float(total),
            'auction': float(sum(Decimal(str(i['amount'])) for i in items if i['source'] == 'auction')), 'auction_count': sum(1 for i in items if i['source'] == 'auction'),
            'smart_tag': float(sum(Decimal(str(i['amount'])) for i in items if i['source'] == 'smart_tag')), 'smart_tag_count': sum(1 for i in items if i['source'] == 'smart_tag'),
            'released_unpaid': float(sum(Decimal(str(i['amount'])) for i in unpaid_released)), 'released_unpaid_count': len(unpaid_released),
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
        return {'state': 'awaiting', 'amount': float(record['amount']), 'title': record['title'], 'payer_name': name, 'released': record['released']}

    # ------------------------------------------------------------------ confirming
    def confirm(self, source: str, source_ref: str, method: Any, reference: Any, notes: Any, expected_amount: Any, admin_id: str) -> Dict[str, Any]:
        if source not in PAYABLE:
            raise IncomeError('Choose an auction or a Smart Tag.')
        method = str(method or '').strip().lower()
        if method not in METHODS:
            raise IncomeError('Choose how the money was paid.')
        reference = _clean(reference, 64)
        if method in NEEDS_REFERENCE and len(reference) < 4:
            raise IncomeError('Enter the payment reference number (at least 4 characters) for GCash, Maya or bank payments.')
        ref = str(source_ref or '').strip()
        record = self._record(source, ref)
        if expected_amount in (None, ''):
            raise IncomeError('Confirm the amount you received.')
        if money(expected_amount) != record['amount']:
            raise IncomeError(f"The amount owed is now ₱{record['amount']:,.2f}, not what your screen showed. Reload and check again.", 409, 'amount_changed')
        existing = self._sales(source, [record['ref']]).get(record['ref'])
        if existing:
            raise IncomeError(f"This payment was already confirmed (receipt {existing.get('receipt_no') or 'on file'}).", 409, 'already_confirmed')
        now = datetime.now(timezone.utc)
        row = {
            'source': source, 'kind': 'sale', 'source_ref': record['ref'][:64], 'description': record['description'][:255], 'amount': str(record['amount']),
            'payer_account_id': str(record['payer']) if record['payer'] else None, 'method': method, 'payment_reference': reference or None,
            'receipt_no': receipts.payment_number(source, record['ref'], now), 'notes': _clean(notes, 300) or None,
            'recorded_by': str(admin_id), 'received_at': now.isoformat(),
        }
        try:
            entry = (self.client.table('income_ledger').insert(row).execute().data or [row])[0]
        except Exception as error:
            text = str(error).lower()
            if 'duplicate' in text or '23505' in text:
                raise IncomeError('This payment was already confirmed.', 409, 'already_confirmed') from error
            if 'payment_reference' in text:
                raise IncomeUnavailable(SETUP_MESSAGE) from error
            if _missing_schema(error):
                raise IncomeUnavailable('Income tracking is not set up yet. Run Server/manual_migrations/20261022_income_ledger.sql in Supabase.') from error
            raise
        if source == 'smart_tag':
            try:
                self.client.table('smart_tags').update({'paid_at': now.isoformat()}).eq('tag_id', record['ref']).is_('paid_at', 'null').execute()
            except Exception as error:
                logger.warning('Smart Tag %s paid_at not saved: %s', record['ref'], error)
        receipt = receipts.receipt_for_payment(self.db, entry['entry_id'])
        self._notify_paid(record, receipt)
        return {'entry': entry, 'receipt': receipt}

    def _notify_paid(self, record: Dict[str, Any], receipt: Optional[Dict[str, Any]]) -> None:
        """Tell the payer: an in-app notice and an email with the receipt number and code. Never fails the confirmation."""
        if not receipt or not record.get('payer'):
            return
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
                send_notice_email_best_effort(
                    profile['email'], f"Payment receipt {receipt['receipt_no']}", title='Payment received', preheader=f"Receipt {receipt['receipt_no']}",
                    greeting=f"Hello {str(profile.get('fname') or '').strip() or 'there'},",
                    paragraphs=[f"The Lost and Found Office confirmed your payment of PHP {Decimal(str(receipt['amount'])):,.2f} for \"{record['title']}\". Keep this receipt number and code: anyone can use them to check the receipt is genuine."],
                    highlight=('RECEIPT NUMBER', receipt['receipt_no']), highlight_note=f"Verification code {receipt['code']}",
                    details={'Item': record['title'], 'Amount': f"PHP {Decimal(str(receipt['amount'])):,.2f}", 'Paid by': METHODS.get(receipt.get('method'), receipt.get('method'))},
                    cta=('View my receipts', site_url()),
                )
        except Exception as error:
            logger.warning('Payment receipt email failed: %s', error)

    # ------------------------------------------------------------------ reversing (super administrators)
    def reverse(self, entry_id: str, reason: Any, admin_id: str) -> Dict[str, Any]:
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
        now = datetime.now(timezone.utc)
        row = {
            'source': sale['source'], 'kind': 'refund', 'source_ref': sale.get('source_ref'), 'description': f"Reversal of {number}: {sale.get('description') or ''}"[:255],
            'amount': str(-Decimal(str(sale['amount']))), 'payer_account_id': sale.get('payer_account_id'), 'method': sale.get('method') or 'cash', 'receipt_no': number,
            'notes': reason, 'recorded_by': str(admin_id), 'received_at': now.isoformat(),
        }
        try:
            entry = (self.client.table('income_ledger').insert(row).execute().data or [row])[0]
        except Exception as error:
            if _missing_schema(error):
                raise IncomeUnavailable('Income tracking is not set up yet.') from error
            raise
        if sale.get('payer_account_id'):
            try:
                self.db.create_user_notification(
                    str(sale['payer_account_id']), 'Payment receipt reversed', f"The payment receipt {number} was reversed by the office. Contact the Lost and Found Office if you have questions.",
                    notification_type='receipt', link_label='View receipts', link_page='receipts',
                )
            except Exception as error:
                logger.warning('Reversal notice failed: %s', error)
        return {'entry': entry, 'receipt_no': number}

    # ------------------------------------------------------------------ the log
    def activity(self, limit: Any = 100) -> List[Dict[str, Any]]:
        """Every income action by an administrator (confirmations, reversals, manual entries, exports), newest first."""
        try:
            limit = max(1, min(int(limit), 300))
        except (TypeError, ValueError):
            limit = 100
        rows = self.client.table('user_activity_logs').select('log_id,user_name,action,target_name,target_id,result,created_at').eq('module_name', 'Income').order('created_at', desc=True).limit(limit).execute().data or []
        return [{k: r.get(k) for k in ('log_id', 'user_name', 'action', 'target_name', 'target_id', 'result', 'created_at')} for r in rows]
