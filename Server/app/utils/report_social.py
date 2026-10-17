"""The user home feed: open missing and found reports as posts, with short comments and "helpful" reactions.

Posts carry only the fields already shown on the public lists (no reporter name, email, campus ID or contact details). A commenter appears as
"First name + last initial" ("Maria S."). Comments are plain text of up to 500 characters; foul language, email addresses and phone numbers
are refused (contact goes through a claim or a Smart Tag, not a public thread). Rate limits live in the routes; the rules that need the
database (an open report, a duplicate, ownership) live here.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from app.utils.profanity import PROFANITY_MESSAGE, find_profanity
from app.utils.text_guard import strip_markup, text_problem

logger = logging.getLogger(__name__)

MAX_BODY = 500
DUPLICATE_WINDOW_SECONDS = 60
FEED_PAGE = 20
FEED_MAX_PAGE = 40
PREVIEW_COMMENTS = 2
THREAD_LIMIT = 100
COUNT_SCAN_LIMIT = 1500

# kind -> (table, public reference column, foreign key on comments and reactions, status of an open report, columns shown on the post)
KINDS = {
    'found': ('found_items', 'fpost_id', 'found_item_id', 'unclaimed', 'item_id,fpost_id,item_name,category,description,location,found_date,image_url,status,created_at'),
    'missing': ('missing_items', 'mpost_id', 'missing_item_id', 'missing', 'item_id,mpost_id,item_name,category,description,last_location,last_seen_date,image_url,status,created_at'),
}
# "Urgent" reports (the stories bar): things people need back quickly, posted in the last week.
URGENT_DAYS = 7
STORY_LIMIT = 12
URGENT_CATEGORIES = ('documents & cards', 'electronics', 'keys', 'valuables')
_URGENT_WORDS = re.compile(r"wallet|purse|\bid\b|passport|atm|license|licence|phone|laptop|tablet|\bkeys?\b|medicine|inhaler|eyeglass|glasses|calculator", re.I)
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
_PHONE = re.compile(r'(?:\+?\d[\s().-]?){9,}')

class SocialError(Exception):
    """A rule failure with an HTTP status the route can return as is."""

    def __init__(self, message: str, status: int = 400, code: str = 'social_error'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def clean_comment(raw: Any) -> str:
    """The comment as it will be stored, or a SocialError saying what to change."""
    text = strip_markup(raw)
    if not text:
        raise SocialError('Write a comment first.')
    if len(text) > MAX_BODY:
        raise SocialError(f'Comments can be up to {MAX_BODY} characters.')
    if find_profanity(text):
        raise SocialError(PROFANITY_MESSAGE, 422, 'profanity')
    if _EMAIL.search(text) or _PHONE.search(text):
        raise SocialError('Please keep phone numbers and email addresses out of comments. To reach the owner, file a claim or scan their Smart Tag.', 422, 'contact_details')
    problem = text_problem(text, 'comment')
    if problem:
        raise SocialError(problem, 422, 'invalid_text')
    return text


def display_name(profile: Optional[Dict[str, Any]]) -> str:
    """"Maria S.": a first name and the initial of the last name, never an email or campus ID."""
    if not profile:
        return 'Former user'
    first = str(profile.get('fname') or '').strip().split(' ')[0]
    last = str(profile.get('lname') or '').strip()
    return f"{first} {last[0].upper()}." if first and last else (first or 'E-Balik user')


class ReportSocial:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    # ------------------------------------------------------------------ plumbing
    @staticmethod
    def _missing_tables(error: Exception) -> bool:
        text = str(error).lower()
        return ('report_comments' in text or 'report_reactions' in text) and any(m in text for m in ('does not exist', 'schema cache', 'pgrst205', '42p01', 'could not find'))

    def _guard(self, error: Exception):
        if self._missing_tables(error):
            logger.warning('Comments are switched off until 20261021_report_comments_and_reactions.sql is run in Supabase.')
            raise SocialError('Comments and reactions are not available yet. Please try again later.', 503, 'setup_required')
        raise error

    @staticmethod
    def _kind(kind: str):
        spec = KINDS.get(str(kind or '').lower())
        if not spec:
            raise SocialError('Choose found or missing.', 400, 'bad_kind')
        return spec

    def _report(self, kind: str, reference: str, open_only: bool = True) -> Dict[str, Any]:
        table, ref_col, fk, open_status, _ = self._kind(kind)
        rows = self.client.table(table).select(f'item_id,{ref_col},item_name,status,account_id,reporter_account_id').eq(ref_col, str(reference or '').strip().upper()).limit(1).execute().data or []
        if not rows:
            raise SocialError('That report was not found.', 404, 'not_found')
        row = rows[0]
        if open_only and str(row.get('status') or '').lower() != open_status:
            raise SocialError('This report is closed, so it no longer takes comments or reactions.', 409, 'report_closed')
        return {'item_id': row['item_id'], 'reference': row[ref_col], 'name': row.get('item_name') or 'item', 'fk': fk,
                'owner': row.get('reporter_account_id') or row.get('account_id')}

    def post(self, kind: str, reference: str, viewer_id: Optional[str]) -> Dict[str, Any]:
        """One open report as a feed post (the target of a shared link). Closed or unknown reports are refused like the comment routes refuse them."""
        table, ref_col, fk, open_status, columns = self._kind(kind)
        rows = self.client.table(table).select(columns).eq(ref_col, str(reference or '').strip().upper()).limit(1).execute().data or []
        if not rows:
            raise SocialError('That report was not found.', 404, 'not_found')
        if str(rows[0].get('status') or '').lower() != open_status:
            raise SocialError('This report is closed, so it is no longer on the feed.', 409, 'report_closed')
        post = self._post(str(kind).lower(), rows[0])
        self._attach_social([post], viewer_id)
        post.pop('_item_id', None)
        return {'post': post}

    def _names(self, account_ids: Iterable[Any]) -> Dict[str, str]:
        wanted = sorted({str(i) for i in account_ids if i})
        if not wanted:
            return {}
        try:
            rows = self.client.table('user_profiles').select('account_id,fname,lname').in_('account_id', wanted).execute().data or []
        except Exception as error:
            logger.info('Commenter names unavailable: %s', str(error)[:120])
            return {}
        return {str(r['account_id']): display_name(r) for r in rows}

    def _comment_view(self, row: Dict[str, Any], names: Dict[str, str], viewer_id: Optional[str]) -> Dict[str, Any]:
        return {'id': str(row['comment_id']), 'author': names.get(str(row['account_id']), 'Former user'), 'body': row['body'], 'created_at': row['created_at'],
                'is_mine': bool(viewer_id) and str(row['account_id']) == str(viewer_id)}

    # ------------------------------------------------------------------ the feed
    def feed(self, viewer_id: str, kind: str = 'all', limit: int = FEED_PAGE, before: Optional[str] = None) -> Dict[str, Any]:
        """Open reports, newest first, with comment and reaction counts and the last two comments. `before` is the `created_at` of the last post
        already shown. Missing reports only appear while they are still missing, found reports while they are unclaimed."""
        limit = max(1, min(int(limit or FEED_PAGE), FEED_MAX_PAGE))
        if str(kind or 'all').lower() == 'all':
            kinds = list(KINDS)
        else:
            self._kind(kind)
            kinds = [str(kind).lower()]
        posts: List[Dict[str, Any]] = []
        for name in kinds:
            table, ref_col, fk, open_status, columns = KINDS[name]
            query = self.client.table(table).select(columns).eq('status', open_status)
            if before:
                query = query.lt('created_at', before)
            for row in query.order('created_at', desc=True).limit(limit + 1).execute().data or []:
                posts.append(self._post(name, row))
        posts.sort(key=lambda post: str(post['created_at'] or ''), reverse=True)
        more = len(posts) > limit
        posts = posts[:limit]
        self._attach_social(posts, viewer_id)
        for post in posts:
            post.pop('_item_id', None)
        page: Dict[str, Any] = {'posts': posts, 'has_more': more, 'next_before': posts[-1]['created_at'] if posts and more else None}
        if not before:   # the first page also brings the stories bar and the campus numbers, so the home page needs one request
            page['stories'] = self.stories()
            page['counts'] = self.counts()
        return page

    @staticmethod
    def is_urgent(category: Any, name: Any) -> bool:
        return str(category or '').strip().lower() in URGENT_CATEGORIES or bool(_URGENT_WORDS.search(str(name or '')))

    def stories(self) -> List[Dict[str, Any]]:
        """Open reports from the last week that people usually need back fast (IDs, cards, wallets, phones, keys...), newest first."""
        since = (_now() - timedelta(days=URGENT_DAYS)).isoformat()
        stories: List[Dict[str, Any]] = []
        for name, (table, ref_col, fk, open_status, columns) in KINDS.items():
            try:
                rows = self.client.table(table).select(columns).eq('status', open_status).gte('created_at', since).order('created_at', desc=True).limit(60).execute().data or []
            except Exception as error:
                logger.info('Stories unavailable: %s', str(error)[:120])
                continue
            for row in rows:
                if self.is_urgent(row.get('category'), row.get('item_name')):
                    post = self._post(name, row)
                    post.pop('_item_id', None)
                    stories.append({key: post[key] for key in ('kind', 'reference', 'item_name', 'category', 'description', 'location', 'date', 'image_url', 'status', 'created_at')})
        stories.sort(key=lambda story: str(story['created_at'] or ''), reverse=True)
        return stories[:STORY_LIMIT]

    def counts(self) -> Dict[str, int]:
        """How many reports are open, and how many found items arrived this week. Zeros when a count cannot be read."""
        week = (_now() - timedelta(days=URGENT_DAYS)).isoformat()
        result = {'found': 0, 'missing': 0, 'found_this_week': 0}
        try:
            result['found'] = int(self.client.table('found_items').select('item_id', count='exact').eq('status', 'unclaimed').limit(1).execute().count or 0)
            result['missing'] = int(self.client.table('missing_items').select('item_id', count='exact').eq('status', 'missing').limit(1).execute().count or 0)
            result['found_this_week'] = int(self.client.table('found_items').select('item_id', count='exact').eq('status', 'unclaimed').gte('created_at', week).limit(1).execute().count or 0)
        except Exception as error:
            logger.info('Campus counts unavailable: %s', str(error)[:120])
        return result

    @staticmethod
    def _post(kind: str, row: Dict[str, Any]) -> Dict[str, Any]:
        found = kind == 'found'
        return {
            '_item_id': row['item_id'], 'kind': kind, 'reference': row['fpost_id'] if found else row['mpost_id'], 'item_name': row.get('item_name') or 'Item',
            'category': row.get('category') or '', 'description': row.get('description') or '', 'location': (row.get('location') if found else row.get('last_location')) or '',
            'date': (row.get('found_date') if found else row.get('last_seen_date')) or '', 'image_url': row.get('image_url') or '', 'status': row.get('status'),
            'created_at': row.get('created_at'), 'comment_count': 0, 'helpful_count': 0, 'reacted': False, 'comments': [],
        }

    def _attach_social(self, posts: List[Dict[str, Any]], viewer_id: Optional[str]) -> None:
        """Fill in comment and reaction counts, the viewer's own reaction and the last comments. A database without the comment tables just shows zeros."""
        for kind in KINDS:
            subset = [p for p in posts if p['kind'] == kind]
            if not subset:
                continue
            fk = KINDS[kind][2]
            ids = [str(p['_item_id']) for p in subset]
            try:
                comments = self.client.table('report_comments').select(f'comment_id,{fk},account_id,body,created_at').in_(fk, ids).eq('is_hidden', False) \
                    .order('created_at', desc=True).limit(COUNT_SCAN_LIMIT).execute().data or []
                reactions = self.client.table('report_reactions').select(f'{fk},account_id').in_(fk, ids).eq('kind', 'helpful').limit(COUNT_SCAN_LIMIT * 3).execute().data or []
            except Exception as error:
                if not self._missing_tables(error):
                    logger.warning('Feed social data unavailable: %s', str(error)[:140])
                continue
            names = self._names(c['account_id'] for c in comments[:len(subset) * PREVIEW_COMMENTS * 4])
            for post in subset:
                key = str(post['_item_id'])
                mine = [c for c in comments if str(c.get(fk)) == key]
                post['comment_count'] = len(mine)
                post['comments'] = [self._comment_view(c, names, viewer_id) for c in reversed(mine[:PREVIEW_COMMENTS])]
                liked = [r for r in reactions if str(r.get(fk)) == key]
                post['helpful_count'] = len(liked)
                post['reacted'] = bool(viewer_id) and any(str(r['account_id']) == str(viewer_id) for r in liked)

    # ------------------------------------------------------------------ comments
    def comments(self, kind: str, reference: str, viewer_id: str, limit: int = THREAD_LIMIT) -> Dict[str, Any]:
        report = self._report(kind, reference, open_only=False)
        try:
            rows = self.client.table('report_comments').select('comment_id,account_id,body,created_at').eq(report['fk'], report['item_id']).eq('is_hidden', False) \
                .order('created_at', desc=True).limit(max(1, min(int(limit), THREAD_LIMIT))).execute().data or []
        except Exception as error:
            self._guard(error)
        names = self._names(r['account_id'] for r in rows)
        return {'comments': [self._comment_view(r, names, viewer_id) for r in reversed(rows)]}

    def add_comment(self, kind: str, reference: str, account_id: str, body: Any) -> Dict[str, Any]:
        text = clean_comment(body)
        report = self._report(kind, reference)
        try:
            recent = self.client.table('report_comments').select('body,created_at').eq(report['fk'], report['item_id']).eq('account_id', account_id) \
                .order('created_at', desc=True).limit(3).execute().data or []
            for row in recent:
                posted = _parse(row.get('created_at'))
                if posted and (_now() - posted).total_seconds() < DUPLICATE_WINDOW_SECONDS and str(row.get('body') or '').strip().lower() == text.lower():
                    raise SocialError('You already posted that comment.', 409, 'duplicate')
            created = self.client.table('report_comments').insert({report['fk']: report['item_id'], 'account_id': account_id, 'body': text}).execute().data or []
        except SocialError:
            raise
        except Exception as error:
            self._guard(error)
        row = created[0]
        names = self._names([account_id])
        self._notify_owner(report, account_id, names.get(str(account_id), 'Someone'), text)
        return {'comment': self._comment_view(row, names, account_id), **self._counts(report)}

    def delete_comment(self, comment_id: str, account_id: str) -> bool:
        """Remove your own comment. Anyone else's comment is left alone (the answer is the same: nothing was deleted)."""
        try:
            deleted = self.client.table('report_comments').delete().eq('comment_id', comment_id).eq('account_id', account_id).execute().data or []
        except Exception as error:
            self._guard(error)
        return bool(deleted)

    def hide_comment(self, comment_id: str, admin_id: str, hidden: bool = True) -> bool:
        """Moderation: hide (or restore) a comment. Hidden comments are kept but never shown."""
        try:
            update = {'is_hidden': bool(hidden), 'hidden_by': admin_id if hidden else None, 'hidden_at': _now().isoformat() if hidden else None}
            done = self.client.table('report_comments').update(update).eq('comment_id', comment_id).execute().data or []
        except Exception as error:
            self._guard(error)
        return bool(done)

    def _notify_owner(self, report: Dict[str, Any], commenter_id: str, commenter: str, text: str) -> None:
        """Tell the person who made the report. Best effort, at most 3 notices per report per hour, never for your own comment."""
        owner = report.get('owner')
        if not owner or str(owner) == str(commenter_id):
            return
        from app.utils import rate_limit
        if not rate_limit.allow(f"comment-note:{owner}:{report['reference']}", 3, 3600):
            return
        try:
            snippet = text if len(text) <= 80 else text[:77] + '...'
            self.db.create_user_notification(
                str(owner), 'New comment on your report', f'{commenter} commented on "{report["name"]}" ({report["reference"]}): {snippet}',
                notification_type='report_comment', link_label='View my reports', link_page='my-reports',
            )
        except Exception as error:
            logger.info('Comment notice was not sent: %s', str(error)[:120])

    # ------------------------------------------------------------------ reactions
    def _counts(self, report: Dict[str, Any], viewer_id: Optional[str] = None) -> Dict[str, Any]:
        try:
            comments = self.client.table('report_comments').select('comment_id', count='exact').eq(report['fk'], report['item_id']).eq('is_hidden', False).limit(1).execute()
            reactions = self.client.table('report_reactions').select('reaction_id', count='exact').eq(report['fk'], report['item_id']).eq('kind', 'helpful').limit(1).execute()
            liked = bool(viewer_id) and bool(self.client.table('report_reactions').select('reaction_id').eq(report['fk'], report['item_id'])
                                             .eq('account_id', viewer_id).eq('kind', 'helpful').limit(1).execute().data)
        except Exception as error:
            self._guard(error)
        return {'comment_count': int(comments.count or 0), 'helpful_count': int(reactions.count or 0), 'reacted': liked}

    def set_reaction(self, kind: str, reference: str, account_id: str, on: bool) -> Dict[str, Any]:
        """Mark a report helpful, or take it back. Doing the same thing twice changes nothing."""
        report = self._report(kind, reference, open_only=on)
        try:
            if on:
                already = self.client.table('report_reactions').select('reaction_id').eq(report['fk'], report['item_id']).eq('account_id', account_id).eq('kind', 'helpful').limit(1).execute().data
                if not already:
                    try:
                        self.client.table('report_reactions').insert({report['fk']: report['item_id'], 'account_id': account_id, 'kind': 'helpful'}).execute()
                    except Exception as error:   # two taps at once: the unique index keeps one
                        if 'duplicate' not in str(error).lower() and '23505' not in str(error):
                            raise
            else:
                self.client.table('report_reactions').delete().eq(report['fk'], report['item_id']).eq('account_id', account_id).eq('kind', 'helpful').execute()
        except Exception as error:
            self._guard(error)
        counts = self._counts(report, account_id)
        counts['reacted'] = on
        return counts
