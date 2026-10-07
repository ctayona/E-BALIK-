import io
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import smart_tags as tags
from app.utils.smart_tags import PENDING, SmartTagService, TagError
from test_expiry_buyout import admin_client
from test_smart_tags import ADMIN, CLAIM, OTHER, OWNER, PHOTO, TAG, make_service, tag_row, user_client, user_routes

BUCKET = tags.TAG_IMAGE_BUCKET
SECOND = {'data': PHOTO['data'] + b'second', 'mimetype': 'image/jpeg'}
THIRD = {'data': PHOTO['data'] + b'third', 'mimetype': 'image/jpeg'}
BLANK = {'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False, 'validity_months': 12}


def photos(store):
    return sorted(path for (_, path) in store.get('objects', {}))


def registered(store_rows=None, **extra):
    """A tag that was registered and is waiting for staff."""
    row = tag_row(status=PENDING, item_image_url=f'{TAG}/first.jpg', review_requested_at='2026-10-06T00:00:00+00:00', validity_months=12, **extra)
    service, db, store = make_service([row, *(store_rows or [])], auto_photo=False)
    store['objects'] = {(BUCKET, f'{TAG}/first.jpg'): (b'x', {})}
    return service, db, store


def approved(status='active', **extra):
    service, db, store = make_service([tag_row(status=status, item_image_url=f'{TAG}/approved.jpg', validity_months=12, **extra)], auto_photo=False)
    store['objects'] = {(BUCKET, f'{TAG}/approved.jpg'): (b'x', {})}
    return service, db, store


class RegistrationIsPendingTests(unittest.TestCase):
    def test_a_new_registration_waits_for_staff_and_has_no_expiry_yet(self):
        service, db, store = make_service([dict(BLANK)], auto_photo=False)
        view = service.claim(TAG, OWNER, CLAIM, PHOTO)
        saved = store['smart_tags'][0]
        self.assertEqual((view['status'], view['awaiting_approval'], saved['status']), (PENDING, True, PENDING))
        self.assertIsNone(saved.get('valid_until'))
        self.assertTrue(saved['review_requested_at'])
        self.assertIsNone(saved.get('prior_status'))

    def test_the_public_sees_nothing_about_a_pending_tag(self):
        service, _, _ = registered(show_name=True, show_email=True, show_phone=True)
        for viewer in (None, OTHER):
            view = service.public_view(TAG, viewer)
            self.assertEqual(view, {'tag_id': TAG, 'status': PENDING, 'is_owner': False})
        self.assertEqual(service.public_view(TAG, OWNER), {'tag_id': TAG, 'status': PENDING, 'is_owner': True})
        text = str(service.public_view(TAG, OTHER))
        for private in ('laptop', 'Maria', 'maria@umak.edu.ph', 'photo', 'first.jpg'):
            self.assertNotIn(private, text)

    def test_nobody_can_report_a_pending_tag_found(self):
        service, db, _ = registered()
        with self.assertRaises(TagError) as caught:
            service.report_found(TAG, 'found it', '')
        self.assertEqual(caught.exception.status, 409)
        db.create_user_notification.assert_not_called()

    def test_a_pending_tag_cannot_be_marked_lost_or_renewed_but_can_be_described(self):
        service, _, store = registered()
        with self.assertRaises(TagError) as caught:
            service.update(TAG, OWNER, {'status': 'lost'})
        self.assertEqual(caught.exception.extra['code'], 'pending')
        with self.assertRaises(TagError):
            service.renew(TAG, 12, ADMIN)
        view = service.update(TAG, OWNER, {'item_description': 'New sticker on the lid', 'show_phone': False})
        self.assertEqual((view['item_description'], view['status']), ('New sticker on the lid', PENDING))


class ItemNameLockTests(unittest.TestCase):
    def test_the_owner_cannot_rename_the_item(self):
        service, _, store = approved()
        for name in ('Something else', 'x ' + store['smart_tags'][0]['item_name']):
            with self.assertRaises(TagError) as caught:
                service.update(TAG, OWNER, {'item_name': name})
            self.assertEqual((caught.exception.status, caught.exception.extra['code']), (403, 'item_locked'))
        self.assertEqual(store['smart_tags'][0]['item_name'], 'Black Dell laptop')

    def test_sending_the_same_name_back_is_fine_and_other_fields_change_freely(self):
        service, _, store = approved()
        view = service.update(TAG, OWNER, {'item_name': 'Black Dell laptop', 'item_description': 'Now with a case', 'show_name': True, 'show_email': True, 'show_phone': False})
        self.assertEqual((view['item_description'], view['status'], view['item_name_locked']), ('Now with a case', 'active', True))
        self.assertTrue(store['smart_tags'][0]['show_name'])

    def test_the_lock_holds_when_the_name_is_sent_with_other_changes_and_when_lost(self):
        service, _, store = approved(status='lost')
        with self.assertRaises(TagError):
            service.update(TAG, OWNER, {'item_name': 'Other', 'item_description': 'changed too'})
        self.assertNotEqual(store['smart_tags'][0].get('item_description'), 'changed too')  # nothing was half-applied


class NewPhotoTriggersReviewTests(unittest.TestCase):
    def test_a_new_photo_takes_an_active_tag_out_of_service(self):
        service, _, store = approved()
        view = service.set_photo(TAG, OWNER, SECOND)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['prior_status']), (PENDING, 'active'))
        self.assertEqual(saved['item_image_url'], f'{TAG}/approved.jpg')  # the approved photo is kept for a rejection
        self.assertNotEqual(saved['pending_image_url'], saved['item_image_url'])
        self.assertTrue(view['photo_pending'] and view['is_reregistration'])
        self.assertEqual(service.public_view(TAG, OTHER), {'tag_id': TAG, 'status': PENDING, 'is_owner': False})

    def test_a_lost_tag_returns_to_lost_after_review(self):
        service, _, store = approved(status='lost')
        service.set_photo(TAG, OWNER, SECOND)
        self.assertEqual(store['smart_tags'][0]['prior_status'], 'lost')
        service.approve(TAG, ADMIN)
        self.assertEqual(store['smart_tags'][0]['status'], 'lost')

    def test_a_second_new_photo_replaces_the_waiting_one(self):
        service, _, store = approved()
        service.set_photo(TAG, OWNER, SECOND)
        first_pending = store['smart_tags'][0]['pending_image_url']
        service.set_photo(TAG, OWNER, THIRD)
        saved = store['smart_tags'][0]
        self.assertNotEqual(saved['pending_image_url'], first_pending)
        self.assertEqual(saved['prior_status'], 'active')  # still remembers the real previous state
        self.assertEqual(len(photos(store)), 2)  # approved + the latest pending, the middle one was deleted

    def test_retaking_during_the_first_review_just_replaces_the_submitted_photo(self):
        service, _, store = registered()
        service.set_photo(TAG, OWNER, SECOND)
        saved = store['smart_tags'][0]
        self.assertEqual(saved['status'], PENDING)
        self.assertIsNone(saved.get('prior_status'))
        self.assertNotEqual(saved['item_image_url'], f'{TAG}/first.jpg')
        self.assertNotIn(f'{TAG}/first.jpg', photos(store))

    def test_approving_a_new_photo_swaps_it_in_and_deletes_the_old_one(self):
        service, db, store = approved()
        service.set_photo(TAG, OWNER, SECOND)
        waiting = store['smart_tags'][0]['pending_image_url']
        service.approve(TAG, ADMIN)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['item_image_url'], saved.get('pending_image_url'), saved['verified_by']), ('active', waiting, None, ADMIN))
        self.assertEqual(photos(store), [waiting])
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'smart_tag_approved')
        self.assertTrue(service.public_view(TAG)['photo_url'])

    def test_rejecting_a_new_photo_puts_the_old_one_back_and_tells_the_owner(self):
        service, db, store = approved()
        service.set_photo(TAG, OWNER, SECOND)
        service.reject(TAG, 'The photo does not show the sticker.', ADMIN)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['item_image_url'], saved.get('pending_image_url')), ('active', f'{TAG}/approved.jpg', None))
        self.assertEqual(photos(store), [f'{TAG}/approved.jpg'])
        args = db.create_user_notification.call_args
        self.assertIn('does not show the sticker', args.args[2])
        self.assertEqual(args.kwargs['notification_type'], 'smart_tag_rejected')

    def test_an_expired_or_deactivated_tag_cannot_take_a_new_photo(self):
        for extra, status in (({'valid_until': '2020-01-01T00:00:00+00:00'}, 403), ({'is_disabled': True}, 403)):
            service, _, store = approved(**extra)
            with self.assertRaises(TagError) as caught:
                service.set_photo(TAG, OWNER, SECOND)
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(len(photos(store)), 1)


class StaffDecisionTests(unittest.TestCase):
    def test_approving_a_first_registration_activates_it_and_starts_the_validity_clock(self):
        service, db, store = registered()
        service.approve(TAG, ADMIN)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['verified_by'], saved['verification_note']), ('active', ADMIN, None))
        until = datetime.fromisoformat(saved['valid_until'])
        self.assertLess(abs((until - tags.add_months(datetime.now(timezone.utc), 12)).total_seconds()), 5)
        self.assertEqual(db.create_user_notification.call_args.args[0], OWNER)
        self.assertEqual(service.public_view(TAG)['status'], 'active')

    def test_a_tag_with_no_validity_period_never_gets_an_expiry_date(self):
        row = tag_row(status=PENDING, item_image_url=f'{TAG}/a.jpg', validity_months=None)
        service, _, store = make_service([row], auto_photo=False)
        service.approve(TAG, ADMIN)
        self.assertIsNone(store['smart_tags'][0].get('valid_until'))

    def test_rejecting_a_first_registration_frees_the_sticker_and_removes_everything(self):
        service, db, store = registered(show_name=True, show_email=True, contact_phone='0917 123 4567')
        service.reject(TAG, 'This is not the item on your account.', ADMIN)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['owner_account_id'], saved['item_name'], saved['item_image_url'], saved['claimed_at']), ('blank', None, None, None, None))
        self.assertEqual((saved['show_name'], saved['show_email'], saved['show_phone'], saved['contact_phone']), (False, False, False, None))
        self.assertEqual(photos(store), [])
        self.assertIn('This is not the item', db.create_user_notification.call_args.args[2])
        # the sticker can be registered again by anyone, with a fresh photo
        again = service.claim(TAG, OTHER, CLAIM, PHOTO)
        self.assertEqual(again['status'], PENDING)

    def test_a_reason_is_required_and_only_pending_tags_can_be_reviewed(self):
        service, _, _ = registered()
        for reason in ('', ' ', 'no'):
            with self.assertRaises(TagError):
                service.reject(TAG, reason, ADMIN)
        service.approve(TAG, ADMIN)
        for action in (lambda: service.approve(TAG, ADMIN), lambda: service.reject(TAG, 'Because it is wrong', ADMIN)):
            with self.assertRaises(TagError) as caught:
                action()
            self.assertEqual((caught.exception.status, caught.exception.extra['code']), (409, 'not_pending'))
        with self.assertRaises(TagError) as caught:
            service.approve('NOSUCHTAG222', ADMIN)
        self.assertEqual(caught.exception.status, 404)


class AdminOverrideTests(unittest.TestCase):
    def test_staff_can_change_every_field_and_the_photo_without_triggering_approval(self):
        service, db, store = approved()
        service.admin_update(TAG, {'item_name': 'Black Dell XPS laptop', 'item_description': 'Fixed typo', 'show_name': True, 'show_email': False, 'show_phone': False}, SECOND, ADMIN)
        saved = store['smart_tags'][0]
        self.assertEqual((saved['status'], saved['item_name'], saved['item_description']), ('active', 'Black Dell XPS laptop', 'Fixed typo'))
        self.assertNotEqual(saved['item_image_url'], f'{TAG}/approved.jpg')
        self.assertEqual(photos(store), [saved['item_image_url']])
        self.assertIsNone(saved.get('prior_status'))
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'smart_tag_updated')

    def test_a_staff_edit_does_not_approve_or_unapprove_a_tag(self):
        service, _, store = registered()
        service.admin_update(TAG, {'item_name': 'Corrected name'}, None, ADMIN)
        self.assertEqual((store['smart_tags'][0]['status'], store['smart_tags'][0]['item_name']), (PENDING, 'Corrected name'))

    def test_a_staff_photo_clears_a_waiting_owner_photo(self):
        service, _, store = approved()
        service.set_photo(TAG, OWNER, SECOND)
        service.admin_update(TAG, {}, THIRD, ADMIN)
        saved = store['smart_tags'][0]
        self.assertIsNone(saved.get('pending_image_url'))
        self.assertEqual(len(photos(store)), 1)

    def test_a_blank_tag_cannot_be_edited_and_nothing_to_change_is_an_error(self):
        service, _, _ = make_service([dict(BLANK)], auto_photo=False)
        with self.assertRaises(TagError) as caught:
            service.admin_update(TAG, {'item_name': 'x y'}, None, ADMIN)
        self.assertEqual(caught.exception.status, 409)
        service, _, _ = approved()
        with self.assertRaises(TagError):
            service.admin_update(TAG, {}, None, ADMIN)
        with self.assertRaises(TagError):
            service.admin_update(TAG, {'item_name': 'a'}, None, ADMIN)  # still validated

    def test_the_reviewer_gets_the_new_and_the_previous_photo(self):
        service, _, _ = approved()
        self.assertEqual(service.admin_photos(TAG)['previous_url'], None)
        service.set_photo(TAG, OWNER, SECOND)
        shown = service.admin_photos(TAG)
        self.assertTrue(shown['is_new_photo'])
        self.assertIn('approved.jpg', shown['previous_url'])
        self.assertNotIn('approved.jpg', shown['url'])


class AdminListTests(unittest.TestCase):
    def test_pending_tags_have_their_own_filter_count_and_review_flags(self):
        rows = [
            tag_row(tag_id='PENDING00001', status=PENDING, item_image_url='P/1.jpg', review_requested_at='2026-10-06T08:00:00+00:00', created_at='2026-10-01'),
            tag_row(tag_id='PENDING00002', status=PENDING, item_image_url='P/2.jpg', pending_image_url='P/new.jpg', prior_status='active', review_requested_at='2026-10-06T09:00:00+00:00', created_at='2026-10-02'),
            tag_row(tag_id='ACTIVETAG001', created_at='2026-10-03'),
            {'tag_id': 'BLANKTAG0001', 'status': 'blank', 'is_disabled': False, 'created_at': '2026-10-04'},
        ]
        service, _, _ = make_service(rows)
        result = service.admin_list('all')
        self.assertEqual((result['stats']['pending'], result['stats']['claimed'], result['stats']['blank']), (2, 3, 1))
        listed = {t['tag_id']: t for t in service.admin_list('pending')['tags']}
        self.assertEqual(sorted(listed), ['PENDING00001', 'PENDING00002'])
        self.assertEqual((listed['PENDING00001']['is_reregistration'], listed['PENDING00001']['has_pending_photo']), (False, False))
        self.assertEqual((listed['PENDING00002']['is_reregistration'], listed['PENDING00002']['has_pending_photo']), (True, True))
        self.assertEqual(listed['PENDING00002']['submitted_at'], '2026-10-06T09:00:00+00:00')
        self.assertEqual(sorted(t['tag_id'] for t in service.admin_list('claimed')['tags']), ['ACTIVETAG001', 'PENDING00001', 'PENDING00002'])

    def test_batches_count_pending_tags_separately(self):
        batch = str(uuid.uuid4())
        rows = [tag_row(tag_id='PENDING00001', status=PENDING, batch_id=batch, batch_label='B'), tag_row(tag_id='ACTIVETAG001', batch_id=batch, batch_label='B'),
                {'tag_id': 'BLANKTAG0001', 'status': 'blank', 'is_disabled': False, 'batch_id': batch, 'batch_label': 'B', 'created_at': '2026-10-01'}]
        service, _, _ = make_service(rows)
        group = service.batches()['batches'][0]
        self.assertEqual((group['pending'], group['active'], group['blank'], group['total']), (1, 1, 1, 3))


class RouteTests(unittest.TestCase):
    def test_staff_can_approve_reject_and_edit_over_http(self):
        service, _, store = registered()
        client, ps, pa = admin_client(service, 'admin')
        with ps, pa:
            no_reason = client.post(f'/api/admin/smart-tags/{TAG}/reject', json={})
            edited = client.patch(f'/api/admin/smart-tags/{TAG}', json={'item_name': 'Dell Latitude'})
            photo = client.patch(f'/api/admin/smart-tags/{TAG}', data={'item_description': 'with photo', 'photo': (io.BytesIO(SECOND['data']), 'staff.jpg', 'image/jpeg')}, content_type='multipart/form-data')
            approved_ = client.post(f'/api/admin/smart-tags/{TAG}/approve')
            twice = client.post(f'/api/admin/smart-tags/{TAG}/approve')
        self.assertEqual((no_reason.status_code, edited.status_code, photo.status_code, approved_.status_code, twice.status_code), (400, 200, 200, 200, 409))
        self.assertEqual((store['smart_tags'][0]['status'], store['smart_tags'][0]['item_name']), ('active', 'Dell Latitude'))

    def test_the_photo_route_returns_both_pictures(self):
        service, _, _ = approved()
        service.set_photo(TAG, OWNER, SECOND)
        client, ps, pa = admin_client(service, 'admin')
        with ps, pa:
            body = client.get(f'/api/admin/smart-tags/{TAG}/photo').get_json()
        self.assertTrue(body['is_new_photo'] and body['url'] and body['previous_url'])

    def test_an_owner_who_tries_to_rename_over_http_gets_a_403(self):
        service, _, _ = approved()
        client, patcher = user_client(service)
        with patcher, patch.object(user_routes, '_authenticated_account_id', return_value=OWNER):
            renamed = client.patch(f'/api/tags/{TAG}', json={'item_name': 'Gaming PC'})
            described = client.patch(f'/api/tags/{TAG}', json={'item_description': 'Still mine'})
            retaken = client.post(f'/api/tags/{TAG}/photo', data={'photo': (io.BytesIO(SECOND['data']), 'again.jpg', 'image/jpeg')}, content_type='multipart/form-data')
        self.assertEqual((renamed.status_code, renamed.get_json()['code'], described.status_code), (403, 'item_locked', 200))
        self.assertEqual((retaken.status_code, retaken.get_json()['tag']['status']), (200, PENDING))


if __name__ == '__main__':
    unittest.main()
