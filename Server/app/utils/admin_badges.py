"""Numbers for the badges on the admin menu: how many things on each page are waiting for an administrator's decision.

Only work that needs an approval or a verification is counted, so a badge means "someone is waiting for you here":
  claims      claims waiting for review
  users       accounts whose ID document waits for verification
  smart-tags  Smart Tags registered by their owner and waiting for staff approval
  auctions    auctions whose timer ended with bids and wait for the administrator to confirm the winner
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


def pending_counts(client) -> Dict[str, int]:
    claims = client.table('claims').select('claim_id', count='exact').in_('status', ['pending', 'under_review', 'in_review', 'review']).limit(1)
    users = client.table('user_profiles').select('account_id', count='exact').eq('verification_status', 'pending').not_.is_('verification_document_url', 'null').limit(1)
    tags = client.table('smart_tags').select('tag_id', count='exact').eq('status', 'pending_verification').limit(1)
    auctions = client.table('auctions').select('auction_id', count='exact').eq('status', 'awaiting_admin').limit(1)
    return {'claims': _count(claims), 'users': _count(users), 'smart-tags': _count(tags), 'auctions': _count(auctions)}


def nav_badges(client) -> Dict[str, Any]:
    counts = pending_counts(client)
    return {'badges': counts, 'total': sum(counts.values())}
