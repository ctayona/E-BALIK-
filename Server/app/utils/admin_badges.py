"""Numbers for the badges on the admin menu: how many things on each page are waiting for an administrator's decision.

Only work that needs an approval or a verification is counted, so a badge means "someone is waiting for you here":
  claims      claims waiting for review
  users       accounts whose ID document waits for verification
  smart-tags  Smart Tags registered by their owner and waiting for staff approval
  auctions    auctions whose timer ended with bids and wait for the administrator to confirm the winner
  income      payment receipts (GCash, Maya, bank) that payers sent and nobody has checked yet
Each count is independent: if a table or column is missing (a migration has not been run) that badge is simply 0.
"""
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _count(query) -> int:
    try:
        return int(query.execute().count or 0)
    except Exception as error:
        logger.info('Menu badge unavailable: %s', error)
        return 0


def _ready_payouts(client) -> int:
    """Sellers whose buyer collected the item and whose hold period is over: money the office should send now. 0 before seller auctions exist."""
    try:
        from datetime import datetime, timedelta, timezone
        from app.utils.seller_auctions import DEFAULT_TERMS, SETTINGS_KEY
        held = client.table('seller_payouts').select('auction_id').eq('status', 'holding').limit(500).execute().data or []
        ids = [str(r['auction_id']) for r in held if r.get('auction_id')]
        if not ids:
            return 0
        stored = (client.table('system_settings').select('setting_value').eq('setting_key', SETTINGS_KEY).limit(1).execute().data or [{}])[0].get('setting_value') or {}
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(stored.get('hold_days', DEFAULT_TERMS['hold_days'])))).isoformat()
        rows = client.table('auctions').select('auction_id').in_('auction_id', ids).eq('fulfillment_status', 'collected').lte('fulfillment_updated_at', cutoff).execute().data or []
        return len(rows)
    except Exception as error:
        logger.info('Menu badge without seller payouts: %s', error)
        return 0


def pending_counts(client) -> Dict[str, int]:
    claims = client.table('claims').select('claim_id', count='exact').in_('status', ['pending', 'under_review', 'in_review', 'review']).limit(1)
    users = client.table('user_profiles').select('account_id', count='exact').eq('verification_status', 'pending').not_.is_('verification_document_url', 'null').limit(1)
    tags = client.table('smart_tags').select('tag_id', count='exact').eq('status', 'pending_verification').limit(1)
    auctions = client.table('auctions').select('auction_id', count='exact').eq('status', 'awaiting_admin').limit(1)
    proofs = client.table('payment_proofs').select('proof_id', count='exact').eq('status', 'pending').limit(1)
    listings = client.table('auction_submissions').select('submission_id', count='exact').eq('status', 'pending').limit(1)   # seller items to review
    return {'claims': _count(claims), 'users': _count(users), 'smart-tags': _count(tags), 'auctions': _count(auctions) + _count(listings), 'income': _count(proofs) + _ready_payouts(client)}


def nav_badges(client) -> Dict[str, Any]:
    counts = pending_counts(client)
    return {'badges': counts, 'total': sum(counts.values())}
