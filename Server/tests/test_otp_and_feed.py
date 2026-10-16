"""Anti-abuse for one-time codes (cooldown, daily limit, disposable emails, guess lockout, resend) and the home feed (posts, comments, reactions)."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from test_report_lifecycle import ADMIN, FINDER, OWNER, staff_patches  # noqa: E402
from Admin.Backend.report_comments import routes as moderation_routes  # noqa: E402
from Users.Backend.feed import routes as feed_routes  # noqa: E402
from Users.Backend.home import routes as home_routes  # noqa: E402
from app.utils import otp_guard, rate_limit, system_control  # noqa: E402
from app.utils.otp_guard import OtpBlocked  # noqa: E402
from app.utils.report_social import ReportSocial, SocialError, clean_comment, display_name  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402

NOW = datetime.now(timezone.utc)
PASSWORD = 'Str0ng!Password-1234'


def real_db(store, **client_kwargs):
    db = SupabaseDB.__new__(SupabaseDB)
    db.client = MemClient(store, **client_kwargs)
    return db


# ------------------------------------------------------------------------------------------------------------ one-time codes
class GuardRuleTests(unittest.TestCase):
    def test_disposable_domains_and_their_subdomains(self):
        for email in ('a@mailinator.com', 'a@MAILINATOR.com', 'a@x.mailinator.com', 'a@10minutemail.com', 'a@yopmail.com', 'a@temp-mail.org'):
            self.assertTrue(otp_guard.is_disposable(email), email)
        for email in ('a@umak.edu.ph', 'a@gmail.com', 'a@notmailinator.com', 'a@mailinator.com.ph', 'nodomain', ''):
            self.assertFalse(otp_guard.is_disposable(email), email)

    def rows(self, *seconds_ago):
        return MemClient({'otp_tokens': [{'id': str(i), 'email': 'a@umak.edu.ph', 'created_at': (NOW - timedelta(seconds=s)).isoformat()} for i, s in enumerate(seconds_ago)]})

    def test_the_cooldown_counts_from_the_newest_code_and_says_how_long_to_wait(self):
        with self.assertRaises(OtpBlocked) as raised:
            otp_guard.check_issue(self.rows(20), 'a@umak.edu.ph', NOW)
        self.assertEqual((raised.exception.code, raised.exception.retry_after), ('cooldown', 40))
        otp_guard.check_issue(self.rows(61), 'a@umak.edu.ph', NOW)

    def test_the_daily_limit_is_five_codes_in_24_hours_and_says_when_it_reopens(self):
        five = self.rows(70, 3600, 7200, 10000, 80000)
        with self.assertRaises(OtpBlocked) as raised:
            otp_guard.check_issue(five, 'a@umak.edu.ph', NOW)
        self.assertEqual(raised.exception.code, 'daily_limit')
        self.assertAlmostEqual(raised.exception.retry_after, 86400 - 80000, delta=5)
        otp_guard.check_issue(self.rows(70, 3600, 7200, 10000, 90000), 'a@umak.edu.ph', NOW)   # the fifth is older than a day: it no longer counts

    def test_a_broken_history_falls_back_to_the_in_memory_limits(self):
        rate_limit.reset()
        broken = MagicMock()
        broken.table.side_effect = RuntimeError('database down')
        otp_guard.check_issue(broken, 'b@umak.edu.ph', NOW)
        with self.assertRaises(OtpBlocked):
            otp_guard.check_issue(broken, 'b@umak.edu.ph', NOW)

    def test_the_wrong_guess_counter_kills_the_code_on_the_fifth(self):
        client = MemClient({'otp_tokens': [{'id': 'x', 'email': 'a@umak.edu.ph', 'otp_code': '1', 'is_used': False, 'attempts': 0}]})
        left = []
        for _ in range(4):
            record = client.store['otp_tokens'][0]
            left.append(otp_guard.register_failure(client, dict(record), 'a@umak.edu.ph', 'registration'))
        self.assertEqual(left, [4, 3, 2, 1])
        with self.assertRaises(OtpBlocked) as raised:
            otp_guard.register_failure(client, dict(client.store['otp_tokens'][0]), 'a@umak.edu.ph', 'registration')
        self.assertEqual(raised.exception.code, 'otp_locked')
        self.assertTrue(client.store['otp_tokens'][0]['is_used'])


class OtpRouteTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.store = {'otp_tokens': [], 'user_profiles': []}
        self.db = real_db(self.store)
        self.sent = []
        self.email = MagicMock()
        self.email.send_otp_email.side_effect = lambda to_email, otp_code, otp_type: self.sent.append((to_email, otp_code, otp_type)) or True

    def post(self, path, body, ip='10.0.0.1', db=None):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x', OTP_EXPIRATION_MINUTES=10)
        app.register_blueprint(home_routes.home_bp, url_prefix='/api')
        with patch.object(home_routes, 'get_db', return_value=db or self.db), patch.object(home_routes, 'EmailService', return_value=self.email):
            return app.test_client().post(f'/api{path}', json=body, environ_base={'REMOTE_ADDR': ip})

    def register(self, email='new.k12345678@umak.edu.ph', **kwargs):
        return self.post('/auth/register', {'fname': 'Ana', 'lname': 'Cruz', 'email': email, 'campus_id': 'K12345678', 'password': PASSWORD}, **kwargs)

    def age_codes(self, seconds):
        for row in self.store['otp_tokens']:
            row['created_at'] = (datetime.fromisoformat(row['created_at']) - timedelta(seconds=seconds)).isoformat()

    def test_a_code_is_sent_and_the_next_request_must_wait_a_minute(self):
        first = self.register()
        self.assertEqual((first.status_code, first.get_json()['cooldown']), (200, 60))
        self.assertEqual(len(self.sent), 1)
        second = self.register()
        body = second.get_json()
        self.assertEqual((second.status_code, body['code']), (429, 'cooldown'))
        self.assertTrue(0 < body['retry_after'] <= 60)
        self.assertEqual(second.headers['Retry-After'], str(body['retry_after']))
        self.assertEqual(len(self.sent), 1)

    def test_after_the_cooldown_a_new_code_is_allowed_and_the_old_one_stops_working(self):
        self.register()
        self.age_codes(61)
        self.assertEqual(self.register().status_code, 200)
        old, new = self.store['otp_tokens']
        self.assertTrue(old['is_used'])
        self.assertFalse(new['is_used'])

    def test_the_sixth_code_in_a_day_is_refused(self):
        for _ in range(5):
            self.assertEqual(self.register().status_code, 200)
            self.age_codes(61)
        response = self.register()
        self.assertEqual((response.status_code, response.get_json()['code']), (429, 'daily_limit'))
        self.assertEqual(len(self.sent), 5)

    def test_disposable_emails_cannot_register_and_nothing_is_stored(self):
        for email in ('x@mailinator.com', 'x@a.guerrillamail.com'):
            response = self.register(email)
            self.assertEqual((response.status_code, response.get_json()['code']), (400, 'disposable_email'))
        self.assertEqual((self.store['otp_tokens'], self.sent), ([], []))

    def test_an_existing_account_gets_no_code(self):
        self.store['user_profiles'].append({'account_id': 'u1', 'email': 'new.k12345678@umak.edu.ph'})
        self.assertEqual(self.register().status_code, 409)
        self.assertEqual(self.sent, [])

    def test_one_address_cannot_ask_for_codes_for_many_emails(self):
        codes = [self.register(f'person{i}.k1234567{i % 10}@umak.edu.ph', ip='10.9.9.9').status_code for i in range(14)]
        self.assertEqual(codes[:12], [200] * 12)
        self.assertEqual(codes[12:], [429, 429])

    def test_a_code_that_could_not_be_emailed_is_removed_and_does_not_start_the_cooldown(self):
        self.email.send_otp_email.side_effect = lambda **kwargs: False
        self.assertEqual(self.register().status_code, 500)
        self.assertEqual(self.store['otp_tokens'], [])
        self.email.send_otp_email.side_effect = lambda to_email, otp_code, otp_type: self.sent.append((to_email, otp_code, otp_type)) or True
        self.assertEqual(self.register().status_code, 200)

    def test_resend_sends_a_fresh_code_with_the_same_rules(self):
        self.register()
        again = self.post('/auth/resend-otp', {'email': 'new.k12345678@umak.edu.ph', 'type': 'registration'})
        self.assertEqual((again.status_code, again.get_json()['code']), (429, 'cooldown'))
        self.age_codes(61)
        done = self.post('/auth/resend-otp', {'email': 'new.k12345678@umak.edu.ph', 'type': 'registration'})
        self.assertEqual((done.status_code, done.get_json()['cooldown']), (200, 60))
        self.assertEqual(len(self.sent), 2)
        self.assertEqual([row['is_used'] for row in self.store['otp_tokens']], [True, False])

    def test_resend_refuses_disposable_registered_and_unknown_types(self):
        self.assertEqual(self.post('/auth/resend-otp', {'email': 'x@mailinator.com'}).get_json()['code'], 'disposable_email')
        self.store['user_profiles'].append({'account_id': 'u1', 'email': 'taken@umak.edu.ph'})
        self.assertEqual(self.post('/auth/resend-otp', {'email': 'taken@umak.edu.ph'}).status_code, 409)
        self.assertEqual(self.post('/auth/resend-otp', {'email': 'a@umak.edu.ph', 'type': 'login'}).status_code, 400)
        self.assertEqual(self.post('/auth/resend-otp', {}).status_code, 400)

    def test_password_reset_answers_the_same_for_known_and_unknown_emails(self):
        self.store['user_profiles'].append({'account_id': 'u1', 'email': 'known@umak.edu.ph', 'fname': 'K'})
        known = self.post('/auth/forgot-password', {'email': 'known@umak.edu.ph'})
        unknown = self.post('/auth/forgot-password', {'email': 'ghost@umak.edu.ph'})
        self.assertEqual((known.status_code, unknown.status_code), (200, 200))
        self.assertEqual(known.get_json(), unknown.get_json())
        self.assertEqual([item[0] for item in self.sent], ['known@umak.edu.ph'])
        # the cooldown applies to both in the same way, so it cannot be used to find out which emails have accounts
        self.assertEqual(self.post('/auth/forgot-password', {'email': 'known@umak.edu.ph'}).status_code, 429)
        self.assertEqual(self.post('/auth/forgot-password', {'email': 'ghost@umak.edu.ph'}).status_code, 429)
        self.assertEqual(self.post('/auth/resend-otp', {'email': 'ghost@umak.edu.ph', 'type': 'password_reset'}).status_code, 429)

    def test_password_reset_stops_sending_after_the_daily_limit_without_saying_so(self):
        self.store['user_profiles'].append({'account_id': 'u1', 'email': 'known@umak.edu.ph', 'fname': 'K'})
        for _ in range(5):
            self.store['otp_tokens'].append({'id': str(len(self.store['otp_tokens'])), 'email': 'known@umak.edu.ph', 'otp_type': 'password_reset', 'is_used': True,
                                             'created_at': (NOW - timedelta(hours=3)).isoformat()})
        response = self.post('/auth/forgot-password', {'email': 'known@umak.edu.ph'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sent, [])

    def verify(self, code, **extra):
        return self.post('/auth/verify-otp', {'email': 'new.k12345678@umak.edu.ph', 'otp_code': code, 'fname': 'Ana', 'lname': 'Cruz', 'campus_id': 'K12345678', 'password': PASSWORD, **extra})

    def test_five_wrong_codes_lock_the_code_out(self):
        self.register()
        real = self.sent[0][1]
        wrong = '000000' if real != '000000' else '111111'
        results = [self.verify(wrong) for _ in range(5)]
        self.assertEqual([r.status_code for r in results], [400, 400, 400, 400, 429])
        self.assertEqual([r.get_json().get('attempts_left') for r in results[:4]], [4, 3, 2, 1])
        self.assertEqual(results[4].get_json()['code'], 'otp_locked')
        after = self.verify(real)
        self.assertEqual(after.status_code, 400)       # even the right code no longer works: ask for a new one
        self.assertEqual(self.store['user_profiles'], [])
        self.age_codes(61)
        self.assertEqual(self.post('/auth/resend-otp', {'email': 'new.k12345678@umak.edu.ph'}).status_code, 200)

    def test_without_the_attempts_column_the_lockout_still_works(self):
        db = real_db(self.store, missing_columns={'otp_tokens': ('attempts',)})
        self.assertEqual(self.post('/auth/register', {'fname': 'Ana', 'lname': 'Cruz', 'email': 'new.k12345678@umak.edu.ph', 'campus_id': 'K12345678', 'password': PASSWORD}, db=db).status_code, 200)
        real = self.sent[0][1]
        wrong = '000000' if real != '000000' else '111111'
        codes = [self.post('/auth/verify-otp', {'email': 'new.k12345678@umak.edu.ph', 'otp_code': wrong, 'fname': 'A', 'lname': 'C', 'campus_id': 'K12345678', 'password': PASSWORD}, db=db).status_code for _ in range(5)]
        self.assertEqual(codes, [400, 400, 400, 400, 429])

    def test_the_right_code_still_registers(self):
        self.register()
        real = self.sent[0][1]
        with patch.object(self.db, 'create_user_profile', return_value={'account_id': 'u1'}), patch.object(self.db, 'get_user_by_campus_id', return_value=None):
            response = self.verify(real)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(self.store['otp_tokens'][0]['is_used'])

    def test_password_reset_guesses_are_limited_the_same_way(self):
        self.store['user_profiles'].append({'account_id': 'u1', 'email': 'known@umak.edu.ph', 'fname': 'K'})
        self.post('/auth/forgot-password', {'email': 'known@umak.edu.ph'})
        real = self.sent[0][1]
        wrong = '000000' if real != '000000' else '111111'
        codes = [self.post('/auth/reset-password', {'email': 'known@umak.edu.ph', 'otp_code': wrong, 'new_password': PASSWORD}).status_code for _ in range(5)]
        self.assertEqual(codes, [400, 400, 400, 400, 429])
        self.assertEqual(self.post('/auth/reset-password', {'email': 'known@umak.edu.ph', 'otp_code': real, 'new_password': PASSWORD}).status_code, 400)


# ------------------------------------------------------------------------------------------------------------ the feed
def feed_store():
    def found(i, ref, status='unclaimed', hours=1):
        return {'item_id': f'F{i}', 'fpost_id': ref, 'item_name': f'Found {i}', 'category': 'Electronics', 'description': 'd', 'location': 'Library', 'found_date': '2026-10-01',
                'image_url': '', 'status': status, 'created_at': (NOW - timedelta(hours=hours)).isoformat(), 'account_id': FINDER, 'reporter_account_id': FINDER,
                'reporter_email': 'finder@umak.edu.ph', 'reporter_campus_id': 'K1'}
    return {
        'found_items': [found(1, 'FP1001', hours=3), found(2, 'FP1002', status='returned', hours=2), found(3, 'FP1003', hours=5)],
        'missing_items': [{'item_id': 'M1', 'mpost_id': 'MP1001', 'item_name': 'Black wallet', 'category': 'Personal Effects', 'description': 'd', 'last_location': 'Gym', 'last_seen_date': '2026-10-02',
                           'image_url': '', 'status': 'missing', 'created_at': (NOW - timedelta(hours=1)).isoformat(), 'account_id': OWNER, 'reporter_account_id': OWNER}],
        'user_profiles': [{'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'campus_id': 'K2'},
                          {'account_id': FINDER, 'fname': 'Fina', 'lname': 'Reyes', 'email': 'fina@umak.edu.ph', 'campus_id': 'K3'}],
        'report_comments': [], 'report_reactions': [],
    }


def social_for(store, **client_kwargs):
    db = MagicMock()
    db.client = MemClient(store, **client_kwargs)
    return ReportSocial(db), db


class FeedTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.store = feed_store()
        self.social, self.db = social_for(self.store)

    def test_only_open_reports_appear_newest_first_and_nothing_private_is_exposed(self):
        posts = self.social.feed(OWNER)['posts']
        self.assertEqual([p['reference'] for p in posts], ['MP1001', 'FP1001', 'FP1003'])
        text = str(posts)
        for private in ('finder@umak.edu.ph', 'fina@umak.edu.ph', 'maria@umak.edu.ph', 'K1', 'reporter', FINDER, OWNER, 'item_id', 'F1'):
            self.assertNotIn(private, text, private)
        self.assertEqual(set(posts[0]), {'kind', 'reference', 'item_name', 'category', 'description', 'location', 'date', 'image_url', 'status', 'created_at', 'comment_count', 'helpful_count', 'reacted', 'comments'})

    def test_the_first_page_brings_urgent_stories_and_the_campus_numbers(self):
        def found(i, ref, category, name, days):
            return {'item_id': f'S{i}', 'fpost_id': ref, 'item_name': name, 'category': category, 'description': '', 'location': 'Gate', 'found_date': '2026-10-01', 'image_url': '',
                    'status': 'unclaimed', 'created_at': (NOW - timedelta(days=days)).isoformat()}
        for base in self.store['found_items']:
            base['category'] = 'Clothing'
        self.store['found_items'] += [found(1, 'FP2001', 'Documents & Cards', 'Student ID', 1), found(2, 'FP2002', 'Clothing', 'Blue jacket', 1), found(3, 'FP2003', 'Electronics', 'Phone', 20)]
        self.store['missing_items'][0].update(item_name='Black wallet', category='Personal Effects')
        page = self.social.feed(OWNER)
        self.assertEqual([s['reference'] for s in page['stories']], ['MP1001', 'FP2001'])      # urgent, this week, newest first; the jacket and the old phone are not
        self.assertEqual(set(page['stories'][0]), {'kind', 'reference', 'item_name', 'category', 'description', 'location', 'date', 'image_url', 'status', 'created_at'})
        self.assertEqual(page['counts'], {'found': 5, 'missing': 1, 'found_this_week': 4})
        later = self.social.feed(OWNER, 'all', 20, page['posts'][0]['created_at'])
        self.assertNotIn('stories', later)
        self.assertNotIn('counts', later)

    def test_urgent_words_match_whole_words_only(self):
        self.assertTrue(ReportSocial.is_urgent('Others', 'Set of keys'))
        self.assertTrue(ReportSocial.is_urgent('Clothing', 'UMak ID lace'))
        self.assertFalse(ReportSocial.is_urgent('Clothing', 'Bidet'))
        self.assertFalse(ReportSocial.is_urgent('Bags & Luggage', 'Black bag'))

    def test_filter_by_kind_and_pages(self):
        self.assertEqual([p['kind'] for p in self.social.feed(OWNER, 'found')['posts']], ['found', 'found'])
        self.assertEqual([p['reference'] for p in self.social.feed(OWNER, 'missing')['posts']], ['MP1001'])
        with self.assertRaises(SocialError):
            self.social.feed(OWNER, 'banana')
        first = self.social.feed(OWNER, 'all', 2)
        self.assertEqual(([p['reference'] for p in first['posts']], first['has_more']), (['MP1001', 'FP1001'], True))
        second = self.social.feed(OWNER, 'all', 2, first['next_before'])
        self.assertEqual(([p['reference'] for p in second['posts']], second['has_more'], second['next_before']), (['FP1003'], False, None))

    def test_a_comment_is_stored_counted_named_and_told_to_the_owner(self):
        result = self.social.add_comment('missing', 'mp1001', FINDER, '  I think I saw it at the gym entrance!  ')
        self.assertEqual((result['comment']['author'], result['comment']['body'], result['comment']['is_mine'], result['comment_count']), ('Fina R.', 'I think I saw it at the gym entrance!', True, 1))
        notice = self.db.create_user_notification.call_args
        self.assertEqual((notice.args[0], notice.kwargs['notification_type']), (OWNER, 'report_comment'))
        post = next(p for p in self.social.feed(OWNER)['posts'] if p['reference'] == 'MP1001')
        self.assertEqual((post['comment_count'], [c['author'] for c in post['comments']], post['comments'][0]['is_mine']), (1, ['Fina R.'], False))

    def test_commenting_on_your_own_report_tells_nobody(self):
        self.social.add_comment('missing', 'MP1001', OWNER, 'Update: found it, thanks everyone')
        self.db.create_user_notification.assert_not_called()

    def test_notices_to_the_owner_are_limited(self):
        for i in range(5):
            self.social.add_comment('found', 'FP1001', OWNER if False else FINDER, f'comment number {i}')
        self.assertLessEqual(self.db.create_user_notification.call_count, 3)

    def test_the_rules_for_what_may_be_posted(self):
        for body, code in (('f' + 'u' + 'ck this', 'profanity'), ('call me 0917 123 4567', 'contact_details'), ('mail me at a.b@gmail.com', 'contact_details'), ('', None), ('   ', None), ('x' * 501, None)):
            with self.assertRaises(SocialError) as raised:
                self.social.add_comment('found', 'FP1001', OWNER, body)
            if code:
                self.assertEqual((raised.exception.code, raised.exception.status), (code, 422))
        self.assertEqual(self.store['report_comments'], [])
        self.assertEqual(clean_comment('Seen <b>near</b> Gate 2'), 'Seen bnear/b Gate 2')   # angle brackets are removed, so no markup survives
        self.assertNotIn('<', clean_comment('a <script> b'))

    def test_the_same_comment_twice_in_a_minute_is_refused(self):
        self.social.add_comment('found', 'FP1001', OWNER, 'Is this still available?')
        with self.assertRaises(SocialError) as raised:
            self.social.add_comment('found', 'FP1001', OWNER, 'is this still available?')
        self.assertEqual(raised.exception.code, 'duplicate')

    def test_closed_unknown_and_missing_tables(self):
        with self.assertRaises(SocialError) as closed:
            self.social.add_comment('found', 'FP1002', OWNER, 'hello there')
        self.assertEqual(closed.exception.code, 'report_closed')
        with self.assertRaises(SocialError) as unknown:
            self.social.add_comment('found', 'FP9999', OWNER, 'hello there')
        self.assertEqual(unknown.exception.status, 404)
        broken = feed_store()
        broken.pop('report_comments')
        social, _ = social_for(broken, missing_columns={'report_comments': ('comment_id', 'body', 'is_hidden', 'found_item_id', 'missing_item_id', 'account_id', 'created_at')})
        with self.assertRaises(SocialError) as setup:
            social.add_comment('found', 'FP1001', OWNER, 'hello there')
        self.assertEqual((setup.exception.status, setup.exception.code), (503, 'setup_required'))

    def test_the_feed_still_loads_before_the_comment_tables_exist(self):
        class NoTables(MemClient):
            def table(self, name):
                if name in ('report_comments', 'report_reactions'):
                    raise RuntimeError(f'relation "public.{name}" does not exist (42P01)')
                return super().table(name)
        db = MagicMock()
        db.client = NoTables(self.store)
        posts = ReportSocial(db).feed(OWNER)['posts']
        self.assertEqual(len(posts), 3)
        self.assertEqual((posts[0]['comment_count'], posts[0]['helpful_count']), (0, 0))

    def test_hidden_comments_are_never_shown_or_counted(self):
        self.social.add_comment('found', 'FP1001', OWNER, 'a fine comment')
        self.social.add_comment('found', 'FP1001', FINDER, 'another comment')
        hidden = self.store['report_comments'][0]['comment_id']
        self.assertTrue(self.social.hide_comment(hidden, ADMIN, True))
        thread = self.social.comments('found', 'FP1001', OWNER)['comments']
        self.assertEqual([c['body'] for c in thread], ['another comment'])
        self.assertEqual(next(p for p in self.social.feed(OWNER)['posts'] if p['reference'] == 'FP1001')['comment_count'], 1)
        self.assertTrue(self.social.hide_comment(hidden, ADMIN, False))
        self.assertEqual(len(self.social.comments('found', 'FP1001', OWNER)['comments']), 2)
        self.assertFalse(self.social.hide_comment('nope', ADMIN))

    def test_only_the_author_can_delete_a_comment(self):
        comment_id = self.social.add_comment('found', 'FP1001', OWNER, 'my comment')['comment']['id']
        self.assertFalse(self.social.delete_comment(comment_id, FINDER))
        self.assertEqual(len(self.store['report_comments']), 1)
        self.assertTrue(self.social.delete_comment(comment_id, OWNER))
        self.assertEqual(self.store['report_comments'], [])

    def test_the_thread_is_oldest_first_and_capped(self):
        for i in range(3):
            self.social.add_comment('found', 'FP1001', OWNER, f'comment {i}')
            self.store['report_comments'][-1]['created_at'] = (NOW - timedelta(minutes=10 - i)).isoformat()
        self.assertEqual([c['body'] for c in self.social.comments('found', 'FP1001', OWNER)['comments']], ['comment 0', 'comment 1', 'comment 2'])
        preview = next(p for p in self.social.feed(OWNER)['posts'] if p['reference'] == 'FP1001')['comments']
        self.assertEqual([c['body'] for c in preview], ['comment 1', 'comment 2'])   # the last two, oldest first

    def test_helpful_reactions_toggle_and_never_double_count(self):
        on = self.social.set_reaction('found', 'FP1001', OWNER, True)
        self.assertEqual((on['helpful_count'], on['reacted']), (1, True))
        again = self.social.set_reaction('found', 'FP1001', OWNER, True)
        self.assertEqual(again['helpful_count'], 1)
        self.social.set_reaction('found', 'FP1001', FINDER, True)
        post = next(p for p in self.social.feed(OWNER)['posts'] if p['reference'] == 'FP1001')
        self.assertEqual((post['helpful_count'], post['reacted']), (2, True))
        off = self.social.set_reaction('found', 'FP1001', OWNER, False)
        self.assertEqual((off['helpful_count'], off['reacted']), (1, False))
        self.assertEqual(self.social.set_reaction('found', 'FP1001', OWNER, False)['helpful_count'], 1)

    def test_a_closed_report_takes_no_new_reaction_but_lets_you_take_yours_back(self):
        with self.assertRaises(SocialError):
            self.social.set_reaction('found', 'FP1002', OWNER, True)
        self.assertEqual(self.social.set_reaction('found', 'FP1002', OWNER, False)['helpful_count'], 0)

    def test_names(self):
        self.assertEqual(display_name({'fname': 'Maria Clara', 'lname': 'santos'}), 'Maria S.')
        self.assertEqual(display_name({'fname': 'Cher', 'lname': ''}), 'Cher')
        self.assertEqual(display_name(None), 'Former user')


class FeedRouteTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.store = feed_store()
        self.social, self.db = social_for(self.store)

    def call(self, method, path, body=None, account=OWNER, auth_error=False):
        app = Flask(__name__)
        app.register_blueprint(feed_routes.feed_bp, url_prefix='/api/feed')
        auth = patch.object(feed_routes, '_authenticated_account_id', side_effect=ValueError('Missing token')) if auth_error else patch.object(feed_routes, '_authenticated_account_id', return_value=account)
        with auth, patch.object(feed_routes, '_social', return_value=self.social):
            return getattr(app.test_client(), method)(f'/api/feed{path}', json=body)

    def test_the_feed_comments_and_reactions_work_end_to_end(self):
        self.assertEqual(len(self.call('get', '?limit=2').get_json()['posts']), 2)
        posted = self.call('post', '/found/FP1001/comments', {'body': 'Is it still here?'}, FINDER)
        self.assertEqual((posted.status_code, posted.get_json()['comment_count']), (201, 1))
        self.assertEqual(len(self.call('get', '/found/FP1001/comments').get_json()['comments']), 1)
        self.assertEqual(self.call('put', '/found/FP1001/reaction').get_json()['helpful_count'], 1)
        self.assertEqual(self.call('delete', '/found/FP1001/reaction').get_json()['helpful_count'], 0)
        comment_id = posted.get_json()['comment']['id']
        self.assertEqual(self.call('delete', f'/comments/{comment_id}', account=OWNER).status_code, 404)
        self.assertEqual(self.call('delete', f'/comments/{comment_id}', account=FINDER).status_code, 200)

    def test_it_needs_a_signed_in_user(self):
        for method, path in (('get', ''), ('post', '/found/FP1001/comments'), ('put', '/found/FP1001/reaction')):
            self.assertEqual(self.call(method, path, {'body': 'x'}, auth_error=True).status_code, 401, path)

    def test_comments_are_rate_limited_with_a_wait_time(self):
        codes = [self.call('post', '/found/FP1001/comments', {'body': f'a different comment {i}'}).status_code for i in range(7)]
        self.assertEqual(codes[:5], [201] * 5)
        self.assertEqual(codes[5:], [429, 429])
        limited = self.call('post', '/found/FP1001/comments', {'body': 'one more thing to say'})
        self.assertTrue(limited.get_json()['retry_after'] > 0)
        self.assertIn('Retry-After', limited.headers)

    def test_rules_are_answered_with_their_status(self):
        self.assertEqual(self.call('post', '/found/FP1001/comments', {'body': 'text me 09171234567'}).status_code, 422)
        self.assertEqual(self.call('post', '/found/FP1002/comments', {'body': 'is it closed'}).status_code, 409)
        self.assertEqual(self.call('post', '/found/FP7777/comments', {'body': 'is it here'}).status_code, 404)
        self.assertEqual(self.call('get', '/banana/FP1001/comments').status_code, 400)

    def test_unverified_people_cannot_comment_or_react_but_can_read(self):
        gated = {action for _, _, action in system_control.VERIFICATION_GATED}
        self.assertIn('comment on a report', gated)
        self.assertIn('react to a report', gated)
        patterns = {(method, action): pattern for method, pattern, action in system_control.VERIFICATION_GATED}
        self.assertTrue(patterns[('POST', 'comment on a report')].match('/api/feed/found/FP1001/comments'))
        self.assertTrue(patterns[('PUT', 'react to a report')].match('/api/feed/missing/MP1001/reaction'))
        self.assertFalse(any(p.match('/api/feed') for p in patterns.values()))


class ModerationRouteTests(unittest.TestCase):
    def test_an_administrator_can_hide_and_restore_a_comment_and_a_user_cannot(self):
        store = feed_store()
        social, db = social_for(store)
        comment_id = social.add_comment('found', 'FP1001', OWNER, 'a comment to moderate')['comment']['id']
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(moderation_routes.report_comments_bp, url_prefix='/api/admin')

        def hide(level, hidden=True, target=comment_id):
            patches = staff_patches(level, ADMIN) + (patch.object(moderation_routes, 'get_db', return_value=db), patch.object(moderation_routes, '_log_admin_action'))
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                return app.test_client().patch(f'/api/admin/report-comments/{target}', json={'hidden': hidden})
        self.assertEqual(hide('user').status_code, 403)
        self.assertEqual(hide('admin').status_code, 200)
        self.assertTrue(store['report_comments'][0]['is_hidden'])
        self.assertEqual(social.comments('found', 'FP1001', OWNER)['comments'], [])
        self.assertEqual(hide('admin', False).status_code, 200)
        self.assertEqual(hide('admin', True, 'missing').status_code, 404)


if __name__ == '__main__':
    unittest.main()
