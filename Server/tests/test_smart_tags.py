import itertools
import io
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import rate_limit
from app.utils import smart_tags as tags
from app.utils.smart_tags import SmartTagService, TagError, TagsUnavailable
from Admin.Backend.smart_tags import routes as admin_routes
from Users.Backend.smart_tags import routes as user_routes

OWNER, OTHER, ADMIN = 'owner-1', 'other-2', 'admin-3'
TAG = 'ABCDEFGHJK23'
PHONE = '0917 123 4567'


class MemTable:
    """Just enough of the Supabase query builder to run the service against real rows."""

    def __init__(self, store, name):
        self.store, self.name = store, name
        self.op, self.payload, self.filters, self.order_key, self.max_rows, self.want_count, self.offset = 'select', None, [], None, None, False, 0

    def select(self, *_args, count=None, **_kw):
        self.want_count = bool(count)
        return self

    def insert(self, payload):
        self.op, self.payload = 'insert', payload
        return self

    def update(self, payload):
        self.op, self.payload = 'update', payload
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: r.get(key) == value)
        return self

    def is_(self, key, value):
        self.filters.append(lambda r: (r.get(key) is None) if value == 'null' else r.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def order(self, key, desc=False):
        self.order_key = (key, desc)
        return self

    def limit(self, n):
        self.max_rows = n
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) < str(value))
        return self

    def range(self, start, end):
        self.offset, self.max_rows = start, end - start + 1
        return self

    def execute(self):
        rows = self.store.setdefault(self.name, [])
        if self.op == 'insert':
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            for row in new:
                if any(r.get('tag_id') == row.get('tag_id') for r in rows):
                    raise Exception('duplicate key value violates unique constraint (23505)')
                rows.append({'is_disabled': False, 'show_name': False, 'show_email': False, 'show_phone': False, 'found_notice_count': 0, **row})
            return SimpleNamespace(data=new, count=len(new))
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == 'update':
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in matched], count=len(matched))
        if self.order_key:
            key, desc = self.order_key
            matched = sorted(matched, key=lambda r: (r.get(key) is None, str(r.get(key))), reverse=desc)
        total = len(matched)
        if self.max_rows is not None:
            matched = matched[self.offset: self.offset + self.max_rows]
        return SimpleNamespace(data=[dict(r) for r in matched], count=total if self.want_count else None)


class MemBucket:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def upload(self, path, data, options=None):
        if self.store.get('storage_fail'):
            raise RuntimeError('storage down')
        self.store.setdefault('objects', {})[(self.name, path)] = (data, options)

    def remove(self, paths):
        for path in paths:
            self.store.setdefault('objects', {}).pop((self.name, path), None)

    def create_signed_url(self, path, seconds):
        return {'signedURL': f'https://files.test/{self.name}/{path}?token=t&exp={seconds}'}


class MemStorage:
    def __init__(self, store):
        self.store = store

    def from_(self, name):
        return MemBucket(self.store, name)


class MemClient:
    def __init__(self, store):
        self.store = store
        self.storage = MemStorage(store)

    def table(self, name):
        return MemTable(self.store, name)


# A real (tiny) JPEG header followed by filler: enough for the byte sniffing the service does.
PHOTO = {'data': bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b'0' * 64, 'mimetype': 'image/jpeg'}


PROFILES = {
    OWNER: {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'campus_id': 'K1'},
    OTHER: {'account_id': OTHER, 'fname': 'Ben', 'lname': 'Lim', 'email': 'ben@umak.edu.ph', 'campus_id': 'K2'},
}


def make_service(rows=None, auto_photo=True):
    store = {'smart_tags': [dict(r) for r in (rows or [])], 'user_profiles': [dict(p) for p in PROFILES.values()]}
    db = MagicMock()
    db.client = MemClient(store)
    db.get_user_by_account_id.side_effect = lambda account_id: PROFILES.get(str(account_id))
    db._decrypt_profile_sensitive_fields = lambda user: None
    service = SmartTagService(db)
    if auto_photo:
        # Registration needs a live photo; tests that are not about the photo get a valid one automatically.
        original = service.claim
        service.claim = lambda tag, account, payload, photo=PHOTO: original(tag, account, payload, photo)
    return service, db, store


def tag_row(**extra):
    row = {'tag_id': TAG, 'status': 'active', 'owner_account_id': OWNER, 'item_name': 'Black Dell laptop', 'item_description': 'Has a UMak sticker',
           'show_name': False, 'show_email': False, 'show_phone': False, 'contact_phone': PHONE, 'is_disabled': False,
           'created_at': '2026-10-01T00:00:00+00:00', 'claimed_at': '2026-10-02T00:00:00+00:00'}
    row.update(extra)
    return row


CLAIM = {'item_name': 'My black Dell laptop', 'item_description': 'Sticker on the lid', 'show_name': True, 'show_email': True, 'show_phone': False, 'contact_phone': '', 'dpa_consent': True}


class TagIdTests(unittest.TestCase):
    def test_ids_are_twelve_characters_from_the_unambiguous_alphabet(self):
        for _ in range(500):
            value = tags.generate_tag_id()
            self.assertEqual(len(value), 12)
            self.assertTrue(set(value) <= set(tags.ALPHABET), value)
        self.assertFalse(set('01OI') & set(tags.ALPHABET))

    def test_ids_do_not_repeat(self):
        self.assertEqual(len({tags.generate_tag_id() for _ in range(20000)}), 20000)

    def test_ids_come_from_the_secure_random_source(self):
        import inspect
        source = inspect.getsource(tags.generate_tag_id)
        self.assertIn('secrets.choice', source)
        self.assertNotIn('random.', source)

    def test_normalize_accepts_scanned_codes_and_rejects_everything_else(self):
        self.assertEqual(tags.normalize_tag_id(' abcdefghjk23 '), TAG)
        for bad in ('', None, 'SHORT', 'ABCDEFGHJK234567', '../../etc/passwd', 'ABCDEFGH<>23', 'ABCDEFGH JK23', 'ABCDEFGHJK2;', 12345):
            self.assertIsNone(tags.normalize_tag_id(bad), bad)

    def test_text_cleaning_removes_markup_and_control_characters(self):
        cleaned = tags.clean_text('<script>alert(1)</script>Hi\x00\x07 <img src=x onerror=alert(1)>', 100)
        self.assertNotIn('<', cleaned)
        self.assertNotIn('>', cleaned)
        self.assertNotIn('\x00', cleaned)
        self.assertEqual(tags.clean_text('x' * 500, 50), 'x' * 50)
        self.assertEqual(tags.clean_text('a\n\n\n\n\nb', 20, multiline=True), 'a\n\nb')

    def test_phone_numbers_are_validated(self):
        self.assertEqual(tags.clean_phone('+63 917 123 4567'), '+63 917 123 4567')
        self.assertEqual(tags.clean_phone(''), '')
        for bad in ('abc', '12', '<script>', '0917;DROP'):
            with self.assertRaises(TagError):
                tags.clean_phone(bad)

    def test_the_qr_address_is_checked_before_anything_is_printed(self):
        cases = [
            ({}, False), ({'PUBLIC_SITE_URL': 'http://localhost:5173'}, False), ({'PUBLIC_SITE_URL': 'https://127.0.0.1'}, False),
            ({'PUBLIC_SITE_URL': 'http://ebalik.vercel.app'}, False), ({'PUBLIC_SITE_URL': 'https://ebalik.vercel.app/'}, True),
        ]
        for env, expected in cases:
            with patch.dict('os.environ', env, clear=False):
                if not env:
                    import os
                    os.environ.pop('PUBLIC_SITE_URL', None)
                check = tags.url_check()
            self.assertEqual(check['ok'], expected, (env, check))
            self.assertEqual(bool(check['reason']), not expected)
        with patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.vercel.app/'}):
            self.assertEqual(tags.tag_url(TAG), f'https://ebalik.vercel.app/tag/{TAG}')

    def test_qr_image_is_a_png(self):
        data = tags.qr_png(TAG)
        self.assertTrue(data.startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertGreater(len(data), 500)


class PublicViewTests(unittest.TestCase):
    def test_a_blank_tag_reveals_nothing_else(self):
        service, _, _ = make_service([{'tag_id': TAG, 'status': 'blank', 'batch_label': 'secret batch', 'created_by': ADMIN}])
        self.assertEqual(service.public_view(TAG), {'tag_id': TAG, 'status': 'blank'})

    def test_a_disabled_tag_shows_no_item_or_owner(self):
        service, _, _ = make_service([tag_row(is_disabled=True, show_name=True, show_email=True, disabled_reason='abuse')])
        self.assertEqual(service.public_view(TAG), {'tag_id': TAG, 'status': 'disabled'})

    def test_an_unknown_or_malformed_code_is_a_404(self):
        service, _, _ = make_service([tag_row()])
        for code in ('ZZZZZZZZZZ22', 'nope', '<script>'):
            with self.assertRaises(TagError) as caught:
                service.public_view(code)
            self.assertEqual(caught.exception.status, 404)

    def test_contact_details_follow_each_privacy_toggle(self):
        for show_name, show_email, show_phone in itertools.product((False, True), repeat=3):
            service, _, _ = make_service([tag_row(show_name=show_name, show_email=show_email, show_phone=show_phone)])
            view = service.public_view(TAG)
            self.assertEqual(set(view['contact']), {k for k, on in (('name', show_name), ('email', show_email), ('phone', show_phone)) if on})
            text = str(view)
            self.assertEqual('Maria Santos' in text, show_name)
            self.assertEqual('maria@umak.edu.ph' in text, show_email)
            self.assertEqual(PHONE in text, show_phone)

    def test_the_answer_uses_only_allow_listed_fields(self):
        service, _, _ = make_service([tag_row(show_name=True, show_email=True, show_phone=True)])
        view = service.public_view(TAG)
        self.assertEqual(set(view), {'tag_id', 'status', 'item_name', 'item_description', 'photo_url', 'contact', 'is_owner'})
        for secret in ('owner-1', 'K1', 'created_at', 'claimed_at', 'batch', 'disabled', 'owner_account_id', 'contact_phone'):
            self.assertNotIn(secret, str(view))

    def test_lost_and_active_are_reported_and_the_owner_is_recognised(self):
        service, _, _ = make_service([tag_row(status='lost')])
        self.assertEqual(service.public_view(TAG)['status'], 'lost')
        self.assertFalse(service.public_view(TAG)['is_owner'])
        self.assertFalse(service.public_view(TAG, OTHER)['is_owner'])
        self.assertTrue(service.public_view(TAG, OWNER)['is_owner'])

    def test_a_tag_whose_owner_account_is_gone_is_inactive(self):
        service, _, _ = make_service([tag_row(owner_account_id=None)])
        self.assertEqual(service.public_view(TAG), {'tag_id': TAG, 'status': 'inactive'})

    def test_a_missing_table_is_reported_as_setup_required(self):
        db = MagicMock()
        db.client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = Exception('Could not find the table public.smart_tags in the schema cache')
        with self.assertRaises(TagsUnavailable):
            SmartTagService(db).public_view(TAG)


class ClaimTests(unittest.TestCase):
    def blank(self, **extra):
        return {'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False, **extra}

    def test_claiming_a_blank_tag_makes_it_active_and_owned(self):
        service, db, store = make_service([self.blank()])
        view = service.claim(TAG.lower(), OWNER, CLAIM)
        self.assertEqual((view['status'], view['item_name'], view['show_email'], view['show_phone']), ('active', 'My black Dell laptop', True, False))
        self.assertEqual(store['smart_tags'][0]['owner_account_id'], OWNER)
        db.log_user_activity.assert_called_once()

    def test_a_second_claim_is_refused_and_does_not_change_the_owner(self):
        service, _, store = make_service([self.blank()])
        service.claim(TAG, OWNER, CLAIM)
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OTHER, {**CLAIM, 'item_name': 'Stolen'})
        self.assertEqual((caught.exception.status, caught.exception.extra['code']), (409, 'already_claimed'))
        self.assertEqual((store['smart_tags'][0]['owner_account_id'], store['smart_tags'][0]['item_name']), (OWNER, 'My black Dell laptop'))

    def test_a_disabled_blank_tag_cannot_be_claimed(self):
        service, _, _ = make_service([self.blank(is_disabled=True)])
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OWNER, CLAIM)
        self.assertEqual(caught.exception.status, 403)

    def test_an_unknown_tag_is_a_404(self):
        service, _, _ = make_service([self.blank()])
        with self.assertRaises(TagError) as caught:
            service.claim('ZZZZZZZZZZ22', OWNER, CLAIM)
        self.assertEqual(caught.exception.status, 404)

    def test_consent_and_a_name_are_required(self):
        service, _, _ = make_service([self.blank()])
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OWNER, {**CLAIM, 'dpa_consent': False})
        self.assertEqual(caught.exception.extra['code'], 'dpa_required')
        for name in ('', ' ', 'x', '<>'):
            with self.assertRaises(TagError):
                service.claim(TAG, OWNER, {**CLAIM, 'item_name': name})

    def test_showing_the_phone_needs_a_phone_number(self):
        service, _, _ = make_service([self.blank()])
        with self.assertRaises(TagError):
            service.claim(TAG, OWNER, {**CLAIM, 'show_phone': True, 'contact_phone': ''})
        view = service.claim(TAG, OWNER, {**CLAIM, 'show_phone': True, 'contact_phone': PHONE})
        self.assertTrue(view['show_phone'])

    def test_markup_in_the_item_name_is_stripped_before_saving(self):
        service, _, store = make_service([self.blank()])
        service.claim(TAG, OWNER, {**CLAIM, 'item_name': '<img src=x onerror=alert(1)>Laptop', 'item_description': '<script>x</script>desc'})
        saved = store['smart_tags'][0]
        self.assertNotIn('<', saved['item_name'] + saved['item_description'])

    def test_an_account_cannot_hold_more_than_the_limit(self):
        owned = [tag_row(tag_id=f'OWNEDTAG{i:04d}'[:12]) for i in range(tags.MAX_TAGS_PER_ACCOUNT)]
        service, _, _ = make_service(owned + [self.blank()])
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OWNER, CLAIM)
        self.assertEqual(caught.exception.status, 409)


class OwnerUpdateTests(unittest.TestCase):
    def test_the_owner_can_mark_the_tag_lost_and_found_again(self):
        service, db, _ = make_service([tag_row()])
        self.assertEqual(service.update(TAG, OWNER, {'status': 'lost'})['status'], 'lost')
        self.assertEqual(service.update(TAG, OWNER, {'status': 'active'})['status'], 'active')
        self.assertEqual(db.log_user_activity.call_count, 2)

    def test_only_active_and_lost_are_allowed(self):
        service, _, _ = make_service([tag_row()])
        for status in ('blank', 'disabled', 'hacked', ''):
            with self.assertRaises(TagError):
                service.update(TAG, OWNER, {'status': status})

    def test_someone_else_gets_the_same_404_as_a_missing_tag(self):
        service, _, store = make_service([tag_row()])
        with self.assertRaises(TagError) as caught:
            service.update(TAG, OTHER, {'item_name': 'Mine now'})
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(store['smart_tags'][0]['item_name'], 'Black Dell laptop')

    def test_a_disabled_tag_cannot_be_edited(self):
        service, _, _ = make_service([tag_row(is_disabled=True)])
        with self.assertRaises(TagError) as caught:
            service.update(TAG, OWNER, {'status': 'lost'})
        self.assertEqual(caught.exception.status, 403)

    def test_a_partial_update_keeps_the_other_fields(self):
        service, _, _ = make_service([tag_row(show_email=True)])
        view = service.update(TAG, OWNER, {'show_name': True})
        self.assertEqual((view['show_name'], view['show_email'], view['item_name']), (True, True, 'Black Dell laptop'))

    def test_the_phone_switch_needs_a_number_on_file(self):
        service, _, _ = make_service([tag_row(contact_phone=None)])
        with self.assertRaises(TagError):
            service.update(TAG, OWNER, {'show_phone': True})
        self.assertTrue(service.update(TAG, OWNER, {'show_phone': True, 'contact_phone': PHONE})['show_phone'])

    def test_my_tags_lists_only_my_tags_with_private_fields(self):
        service, _, _ = make_service([tag_row(), tag_row(tag_id='ZZZZZZZZZZ22', owner_account_id=OTHER)])
        mine = service.my_tags(OWNER)
        self.assertEqual([t['tag_id'] for t in mine], [TAG])
        self.assertEqual(mine[0]['contact_phone'], PHONE)
        self.assertTrue(mine[0]['url'].endswith(f'/tag/{TAG}'))


class FinderTests(unittest.TestCase):
    def test_the_owner_is_notified_in_the_app_and_by_email(self):
        service, db, store = make_service([tag_row()])
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as send:
            result = service.report_found(TAG, 'Found it near the library', '0918 000 1111')
        self.assertTrue(result['notified'])
        self.assertEqual(result['instructions'], tags.SURRENDER_INSTRUCTIONS)
        self.assertIn('OHSO guard post', ' '.join(result['instructions']))
        db.create_user_notification.assert_called_once()
        self.assertEqual(db.create_user_notification.call_args.args[0], OWNER)
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'smart_tag_found')
        self.assertEqual(send.call_args.kwargs['to_email'], 'maria@umak.edu.ph')
        self.assertEqual(send.call_args.kwargs['reference'], TAG)
        self.assertEqual(store['smart_tags'][0]['found_notice_count'], 1)

    def test_repeat_scans_inside_the_cooldown_do_not_spam_the_owner(self):
        service, db, store = make_service([tag_row()])
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as send:
            first = service.report_found(TAG, '', '')
            second = service.report_found(TAG, '', '')
        self.assertEqual((first['notified'], second['notified'], second['cooldown']), (True, False, True))
        self.assertEqual(db.create_user_notification.call_count, 1)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(second['instructions'], tags.SURRENDER_INSTRUCTIONS)  # a finder always gets the guidance
        store['smart_tags'][0]['last_found_notice_at'] = (datetime.now(timezone.utc) - timedelta(seconds=tags.FOUND_COOLDOWN_SECONDS + 5)).isoformat()
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True):
            self.assertTrue(service.report_found(TAG, '', '')['notified'])

    def test_markup_in_the_finder_message_is_removed(self):
        service, db, _ = make_service([tag_row()])
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as send:
            service.report_found(TAG, '<script>alert(1)</script> hello', '<b>me</b>')
        body = db.create_user_notification.call_args.args[2] + str(send.call_args.kwargs)
        self.assertNotIn('<', body)
        self.assertNotIn('>', body)

    def test_blank_disabled_and_unknown_tags_cannot_be_reported(self):
        for row in ({'tag_id': TAG, 'status': 'blank', 'owner_account_id': None}, tag_row(is_disabled=True)):
            service, db, _ = make_service([row])
            with self.assertRaises(TagError) as caught:
                service.report_found(TAG, '', '')
            self.assertEqual(caught.exception.status, 409)
            db.create_user_notification.assert_not_called()
        service, _, _ = make_service([tag_row()])
        with self.assertRaises(TagError) as caught:
            service.report_found('ZZZZZZZZZZ22', '', '')
        self.assertEqual(caught.exception.status, 404)

    def test_an_email_failure_does_not_stop_the_notification(self):
        service, db, _ = make_service([tag_row()])
        with patch('app.utils.email_service.send_reference_email_best_effort', side_effect=Exception('smtp down')):
            self.assertTrue(service.report_found(TAG, '', '')['notified'])
        db.create_user_notification.assert_called_once()


class AdminServiceTests(unittest.TestCase):
    def test_a_batch_creates_that_many_unique_blank_tags(self):
        service, _, store = make_service()
        batch = service.create_batch(50, 'Freshman pack', ADMIN)
        self.assertEqual((batch['count'], batch['batch_label'], len(set(batch['tag_ids']))), (50, 'Freshman pack', 50))
        self.assertTrue(all(r['status'] == 'blank' and r.get('owner_account_id') is None and r['created_by'] == ADMIN for r in store['smart_tags']))
        self.assertTrue(all(tags.normalize_tag_id(i) == i for i in batch['tag_ids']))

    def test_batch_size_is_validated(self):
        service, _, _ = make_service()
        for bad in (0, -5, 501, 'many', None, 2.5 if False else 'x'):
            with self.assertRaises(TagError):
                service.create_batch(bad, 'x', ADMIN)
        self.assertEqual(service.create_batch(500, '', ADMIN)['count'], 500)

    def test_a_collision_is_retried_with_new_codes(self):
        service, _, store = make_service([{'tag_id': 'AAAAAAAAAAAA', 'status': 'blank'}])
        sequence = iter(['AAAAAAAAAAAA'] + [f'BBBBBBBBBB{c}{d}' for c in 'CD' for d in 'EF'] * 3)
        with patch.object(tags, 'generate_tag_id', side_effect=lambda: next(sequence)):
            batch = service.create_batch(1, 'retry', ADMIN)
        self.assertNotEqual(batch['tag_ids'][0], 'AAAAAAAAAAAA')

    def test_the_list_filters_blank_claimed_lost_and_disabled(self):
        rows = [
            {'tag_id': 'BLANKTAG0001', 'status': 'blank', 'is_disabled': False, 'created_at': '2026-10-03'},
            {'tag_id': 'BLANKTAG0002', 'status': 'blank', 'is_disabled': False, 'created_at': '2026-10-04'},
            tag_row(tag_id='CLAIMEDTAG01', created_at='2026-10-05'),
            tag_row(tag_id='LOSTTAG00001', status='lost', created_at='2026-10-06'),
            tag_row(tag_id='BANNEDTAG001', is_disabled=True, created_at='2026-10-07'),
        ]
        service, _, _ = make_service(rows)
        everything = service.admin_list('all')
        self.assertEqual(everything['stats'], {'total': 5, 'blank': 2, 'claimed': 3, 'lost': 1, 'expired': 0, 'disabled': 1})
        ids = lambda status: sorted(t['tag_id'] for t in service.admin_list(status)['tags'])
        self.assertEqual(ids('blank'), ['BLANKTAG0001', 'BLANKTAG0002'])
        self.assertEqual(ids('claimed'), ['BANNEDTAG001', 'CLAIMEDTAG01', 'LOSTTAG00001'])
        self.assertEqual(ids('lost'), ['LOSTTAG00001'])
        self.assertEqual(ids('disabled'), ['BANNEDTAG001'])
        claimed = next(t for t in everything['tags'] if t['tag_id'] == 'CLAIMEDTAG01')
        self.assertEqual(claimed['owner']['name'], 'Maria Santos')  # admins see who owns a tag
        self.assertEqual([t['tag_id'] for t in service.admin_list('all', 'santos')['tags']].count('CLAIMEDTAG01'), 1)
        self.assertEqual(service.admin_list('all', 'nomatchanywhere')['tags'], [])

    def test_deactivating_needs_a_reason_hides_the_tag_and_tells_the_owner(self):
        service, db, store = make_service([tag_row(show_name=True, show_email=True)])
        with self.assertRaises(TagError):
            service.set_disabled(TAG, True, '', ADMIN)
        service.set_disabled(TAG, True, 'Used to harass someone', ADMIN)
        self.assertEqual(service.public_view(TAG), {'tag_id': TAG, 'status': 'disabled'})
        self.assertEqual(store['smart_tags'][0]['disabled_by'], ADMIN)
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'smart_tag_disabled')
        self.assertTrue(service.my_tags(OWNER)[0]['is_disabled'])
        service.set_disabled(TAG, False, '', ADMIN)
        self.assertEqual(service.public_view(TAG)['status'], 'active')


def user_client(service):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.register_blueprint(user_routes.smart_tags_bp, url_prefix='/api/tags')
    return app.test_client(), patch.object(user_routes, '_service', return_value=service)


def admin_client(service, admin_level='admin'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.register_blueprint(admin_routes.smart_tags_bp, url_prefix='/api/admin')

    def require(required_level='admin'):
        if required_level == 'super_admin' and admin_level != 'super_admin':
            raise PermissionError('Super administrator access required')
        return {'account_id': ADMIN, 'email': 'a@umak.edu.ph', 'access_level': admin_level}
    return app.test_client(), patch.object(admin_routes, '_service', return_value=(MagicMock(), service)), patch.object(admin_routes, '_require_admin', side_effect=require)


class UserRouteTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()

    def test_the_public_page_needs_no_login_and_is_never_cached(self):
        service, _, _ = make_service([tag_row(show_email=True)])
        client, patcher = user_client(service)
        with patcher:
            response = client.get(f'/api/tags/{TAG}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn('noindex', response.headers['X-Robots-Tag'])
        self.assertEqual(response.get_json()['contact'], {'email': 'maria@umak.edu.ph'})

    def test_unknown_and_malformed_codes_are_404(self):
        service, _, _ = make_service([tag_row()])
        client, patcher = user_client(service)
        with patcher:
            self.assertEqual(client.get('/api/tags/ZZZZZZZZZZ22').status_code, 404)
            self.assertEqual(client.get('/api/tags/not-a-code').status_code, 404)

    def test_lookups_are_rate_limited_per_address(self):
        service, _, _ = make_service([tag_row()])
        client, patcher = user_client(service)
        with patcher:
            statuses = [client.get(f'/api/tags/{TAG}', headers={'X-Forwarded-For': '9.9.9.9'}).status_code for _ in range(95)]
            other = client.get(f'/api/tags/{TAG}', headers={'X-Forwarded-For': '8.8.8.8'}).status_code
        self.assertEqual(statuses.count(200), 90)
        self.assertEqual(statuses[-1], 429)
        self.assertEqual(other, 200)

    def test_the_found_button_works_without_an_account_and_returns_the_guard_post_steps(self):
        service, db, _ = make_service([tag_row()])
        client, patcher = user_client(service)
        with patcher, patch('app.utils.email_service.send_reference_email_best_effort', return_value=True):
            response = client.post(f'/api/tags/{TAG}/found', json={'message': 'Near the gate'})
        body = response.get_json()
        self.assertEqual((response.status_code, body['success'], body['notified']), (200, True, True))
        self.assertIn('OHSO guard post', ' '.join(body['instructions']))

    def test_the_found_button_is_rate_limited_but_still_returns_instructions(self):
        service, _, _ = make_service([tag_row()])
        client, patcher = user_client(service)
        with patcher, patch('app.utils.email_service.send_reference_email_best_effort', return_value=True):
            statuses = [client.post(f'/api/tags/{TAG}/found', json={}, headers={'X-Forwarded-For': '7.7.7.7'}) for _ in range(5)]
        self.assertEqual([r.status_code for r in statuses], [200, 200, 200, 429, 429])
        self.assertTrue(statuses[-1].get_json()['instructions'])

    def test_claiming_and_editing_need_a_login(self):
        service, _, _ = make_service([{'tag_id': TAG, 'status': 'blank', 'owner_account_id': None}])
        client, patcher = user_client(service)
        with patcher:
            self.assertEqual(client.post(f'/api/tags/{TAG}/claim', json=CLAIM).status_code, 401)
            self.assertEqual(client.patch(f'/api/tags/{TAG}', json={'status': 'lost'}).status_code, 401)
            self.assertEqual(client.get('/api/tags/mine').status_code, 401)

    def test_a_logged_in_user_can_claim_then_manage(self):
        service, _, _ = make_service([{'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False}])
        client, patcher = user_client(service)
        with patcher, patch.object(user_routes, '_authenticated_account_id', return_value=OWNER):
            def upload():
                return {**{k: str(v).lower() if isinstance(v, bool) else v for k, v in CLAIM.items()}, 'photo': (io.BytesIO(PHOTO['data']), 'camera.jpg', 'image/jpeg')}
            claimed = client.post(f'/api/tags/{TAG}/claim', data=upload(), content_type='multipart/form-data')
            again = client.post(f'/api/tags/{TAG}/claim', data=upload(), content_type='multipart/form-data')
            lost = client.patch(f'/api/tags/{TAG}', json={'status': 'lost'})
            mine = client.get('/api/tags/mine')
        self.assertEqual((claimed.status_code, again.status_code, lost.status_code), (201, 409, 200))
        self.assertEqual(mine.get_json()['tags'][0]['status'], 'lost')

    def test_a_missing_table_answers_503_with_setup_required(self):
        db = MagicMock()
        db.client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = Exception('relation "public.smart_tags" does not exist')
        client, patcher = user_client(SmartTagService(db))
        with patcher:
            response = client.get(f'/api/tags/{TAG}')
        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.get_json()['setup_required'])


class AdminRouteTests(unittest.TestCase):
    def test_generating_a_batch_works_for_admins(self):
        service, _, store = make_service()
        client, patch_service, patch_admin = admin_client(service, 'admin')
        with patch_service, patch_admin:
            response = client.post('/api/admin/smart-tags/batch', json={'count': 10, 'label': 'Pack A'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.get_json()['tag_ids']), 10)
        self.assertEqual(len(store['smart_tags']), 10)

    def test_bad_batch_sizes_are_400(self):
        service, _, _ = make_service()
        client, patch_service, patch_admin = admin_client(service)
        with patch_service, patch_admin:
            self.assertEqual(client.post('/api/admin/smart-tags/batch', json={'count': 0}).status_code, 400)
            self.assertEqual(client.post('/api/admin/smart-tags/batch', json={'count': 9999}).status_code, 400)

    def test_only_a_super_admin_can_deactivate_or_reactivate(self):
        service, _, store = make_service([tag_row()])
        client, patch_service, patch_admin = admin_client(service, 'admin')
        with patch_service, patch_admin:
            self.assertEqual(client.post(f'/api/admin/smart-tags/{TAG}/disable', json={'reason': 'abuse'}).status_code, 403)
            self.assertEqual(client.post(f'/api/admin/smart-tags/{TAG}/enable').status_code, 403)
        self.assertFalse(store['smart_tags'][0]['is_disabled'])
        client, patch_service, patch_admin = admin_client(service, 'super_admin')
        with patch_service, patch_admin:
            self.assertEqual(client.post(f'/api/admin/smart-tags/{TAG}/disable', json={'reason': 'Used to harass someone'}).status_code, 200)
            self.assertTrue(store['smart_tags'][0]['is_disabled'])
            self.assertEqual(client.post(f'/api/admin/smart-tags/{TAG}/enable').status_code, 200)

    def test_the_list_filters_and_the_qr_is_a_png(self):
        service, _, _ = make_service([tag_row(), {'tag_id': 'BLANKTAG0001', 'status': 'blank', 'is_disabled': False}])
        client, patch_service, patch_admin = admin_client(service)
        with patch_service, patch_admin:
            blank = client.get('/api/admin/smart-tags?status=blank').get_json()
            png = client.get(f'/api/admin/smart-tags/{TAG}/qr')
            missing = client.get('/api/admin/smart-tags/ZZZZZZZZZZ22/qr')
        self.assertEqual([t['tag_id'] for t in blank['tags']], ['BLANKTAG0001'])
        self.assertEqual(blank['stats']['claimed'], 1)
        self.assertTrue(png.data.startswith(b'\x89PNG'))
        self.assertEqual(missing.status_code, 404)

    def test_every_admin_route_needs_an_admin(self):
        client = Flask(__name__)
        client.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        client.register_blueprint(admin_routes.smart_tags_bp, url_prefix='/api/admin')
        c = client.test_client()
        with patch.object(admin_routes, '_require_admin', side_effect=PermissionError('Admin access required')):
            for method, path in (('get', '/api/admin/smart-tags'), ('post', '/api/admin/smart-tags/batch'), ('post', f'/api/admin/smart-tags/{TAG}/disable'), ('get', f'/api/admin/smart-tags/{TAG}/qr')):
                self.assertEqual(getattr(c, method)(path, json={}).status_code, 403, path)


if __name__ == '__main__':
    unittest.main()
