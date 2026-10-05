import io
import sys
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import report_guard
from app.utils.auction_db import AuctionError, AuctionService, bidder_alias
from app.utils.profanity import find_profanity
from app.utils.supabase_db import SupabaseDB
from test_system_control import FakeClient, auction_row  # helpers only
from Users.Backend.claim import routes as claim_routes
from Users.Backend.found_item import routes as found_routes
from Users.Backend.missing_item import routes as missing_routes
from Users.Backend.profile import routes as profile_routes

NOW = datetime.now(timezone.utc)
ACCOUNT = '11111111-1111-4111-8111-111111111111'
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64


class ProfanityTests(unittest.TestCase):
    def test_catches_english_filipino_and_disguised_words(self):
        for text in ('You are a fuckin idiot', 'f u c k this', 'FUUUCK', 'sh!t', '$hit', 'putang ina mo', 'putanginamo ka', 't4ngina', 'ang bobo mo!', 'what a shitty seller'):
            self.assertIsNotNone(find_profanity(text), text)

    def test_ordinary_words_are_not_flagged(self):
        for text in ('Nice umbrella, class act', 'assistant professor', 'Scunthorpe', 'shiitake mushrooms', 'Great find! Thank you', 'Is the bag still available?', 'Titan watch', 'Assess the damage'):
            self.assertIsNone(find_profanity(text), text)


class ReportGuardTests(unittest.TestCase):
    def missing(self, name='Black wallet', description='Black leather wallet with a UMak ID inside and a red zipper', status='missing', ref='MP1001'):
        return {'item_name': name, 'description': description, 'status': status, 'mpost_id': ref}

    def test_six_active_reports_is_the_limit_across_both_kinds(self):
        self.assertEqual(report_guard.MAX_ACTIVE_REPORTS, 6)
        rows = [self.missing(ref=f'MP{i}', description=f'distinct description number {i} about something else') for i in range(5)]
        found = [{'item_name': 'Keys', 'description': 'A bunch of keys on a blue lanyard', 'status': 'unclaimed', 'fpost_id': 'FP1'}]
        with self.assertRaises(report_guard.ReportRuleError) as caught:
            report_guard.check_new_report({'item_name': 'Umbrella', 'description': 'Large green umbrella with wooden handle'}, 'missing', rows, found)
        self.assertEqual((caught.exception.code, caught.exception.status), ('report_limit', 429))

    def test_one_below_the_limit_is_accepted(self):
        rows = [self.missing(ref=f'MP{i}', description=f'distinct description number {i} about something else') for i in range(5)]
        report_guard.check_new_report({'item_name': 'Umbrella', 'description': 'Large green umbrella with wooden handle'}, 'missing', rows, [])

    def test_resolved_reports_do_not_count(self):
        rows = [self.missing(status='returned', ref=f'MP{i}', description=f'old report {i} completely different words here') for i in range(report_guard.MAX_ACTIVE_REPORTS)]
        report_guard.check_new_report({'item_name': 'Umbrella', 'description': 'Large green umbrella with wooden handle'}, 'missing', rows, [])

    def test_a_similar_description_is_refused(self):
        existing = [self.missing()]
        for description in ('Black leather wallet with a UMak ID inside and a red zipper', 'black leather wallet, with UMak ID inside and red zipper!', 'Black leather wallet with UMak ID inside and a red zipper.'):
            with self.assertRaises(report_guard.ReportRuleError) as caught:
                report_guard.check_new_report({'item_name': 'Black wallet', 'description': description}, 'missing', existing, [])
            self.assertEqual((caught.exception.code, caught.exception.status), ('duplicate_report', 409))
            self.assertEqual(caught.exception.extra['reference'], 'MP1001')

    def test_a_different_item_is_accepted_even_with_a_similar_title(self):
        report_guard.check_new_report({'item_name': 'Black wallet', 'description': 'Small canvas coin purse with a metal clasp, found near the library'}, 'missing', [self.missing()], [])

    def test_submission_slot_refuses_a_concurrent_duplicate_then_releases(self):
        first = report_guard.begin_submission('claim:a:1')
        with self.assertRaises(report_guard.ReportRuleError):
            report_guard.begin_submission('claim:a:1')
        report_guard.end_submission(first)
        report_guard.end_submission(report_guard.begin_submission('claim:a:1'))  # free again

    def test_only_one_of_many_simultaneous_submissions_wins(self):
        winners, lock = [], threading.Lock()
        barrier = threading.Barrier(8)

        def attempt():
            barrier.wait()
            try:
                key = report_guard.begin_submission('claim:race')
            except report_guard.ReportRuleError:
                return
            with lock:
                winners.append(key)
        threads = [threading.Thread(target=attempt) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(len(winners), 1)
        report_guard.end_submission('claim:race')


def app_client(blueprint, prefix='/api'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.register_blueprint(blueprint, url_prefix=prefix)
    return app.test_client()


def report_db(missing=(), found=()):
    db = MagicMock()
    db.get_user_by_account_id.return_value = {'account_id': ACCOUNT, 'email': 'u@umak.edu.ph', 'fname': 'Ana', 'lname': 'Reyes', 'campus_id': 'K1'}
    db.get_missing_items_by_account.return_value = list(missing)
    db.get_found_items_by_account.return_value = list(found)
    db.next_fpost_id.return_value = 'FP1001'
    db.next_mpost_id.return_value = 'MP1001'
    db.create_found_item.side_effect = lambda payload: {**payload, 'item_id': 'i1'}
    db.create_missing_item.side_effect = lambda payload: {**payload, 'item_id': 'i2'}
    return db


FOUND_FORM = {'item_name': 'Blue umbrella', 'location': 'Library', 'category': 'Accessories', 'description': 'Large blue umbrella with a curved wooden handle', 'found_date': '2026-10-01', 'turnover_location': 'Guard house', 'guard_name_or_id': 'G-12', 'dpa_consent': 'true'}
MISSING_FORM = {'item_name': 'Black wallet', 'category': 'Personal Effects', 'description': 'Black leather wallet with a UMak ID inside', 'last_location': 'Cafeteria', 'last_seen_date': '2026-10-01', 'authorized': 'true', 'dpa_consent': 'true'}


class ReportRouteTests(unittest.TestCase):
    def post(self, module, blueprint, path, form, db):
        client = app_client(blueprint)
        with patch.object(module, 'get_db', return_value=db), patch.object(module, '_authenticated_account_id', return_value=ACCOUNT), \
             patch.object(module, 'send_reference_email_best_effort', return_value=True):
            return client.post(path, data=form)

    def test_dpa_consent_is_required_for_both_report_types(self):
        for module, blueprint, path, form in ((found_routes, found_routes.found_item_bp, '/api/found-items', FOUND_FORM), (missing_routes, missing_routes.missing_item_bp, '/api/missing-items', MISSING_FORM)):
            db = report_db()
            response = self.post(module, blueprint, path, {k: v for k, v in form.items() if k != 'dpa_consent'}, db)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()['code'], 'dpa_required')
            db.create_found_item.assert_not_called()
            db.create_missing_item.assert_not_called()

    def test_consent_is_recorded_in_the_activity_log(self):
        db = report_db()
        response = self.post(found_routes, found_routes.found_item_bp, '/api/found-items', FOUND_FORM, db)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(db.log_user_activity.call_args.kwargs['metadata']['dpa_consent'])

    def test_the_fourth_active_report_is_refused_with_the_limit_code(self):
        existing = [{'item_name': f'Thing {i}', 'description': f'a unique description number {i} nothing alike', 'status': 'missing', 'mpost_id': f'MP{i}'} for i in range(report_guard.MAX_ACTIVE_REPORTS)]
        db = report_db(missing=existing)
        response = self.post(missing_routes, missing_routes.missing_item_bp, '/api/missing-items', MISSING_FORM, db)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.get_json()['code'], 'report_limit')
        db.create_missing_item.assert_not_called()

    def test_a_duplicate_description_is_refused(self):
        db = report_db(missing=[{'item_name': 'Black wallet', 'description': 'Black leather wallet with a UMak ID inside', 'status': 'missing', 'mpost_id': 'MP1000'}])
        response = self.post(missing_routes, missing_routes.missing_item_bp, '/api/missing-items', MISSING_FORM, db)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['code'], 'duplicate_report')
        self.assertIn('MP1000', response.get_json()['error'])

    def test_a_double_click_cannot_create_two_reports(self):
        db = report_db()
        held = report_guard.begin_submission(f'missing:{ACCOUNT}')  # the first request is still running
        try:
            response = self.post(missing_routes, missing_routes.missing_item_bp, '/api/missing-items', MISSING_FORM, db)
        finally:
            report_guard.end_submission(held)
        self.assertEqual(response.status_code, 409)
        db.create_missing_item.assert_not_called()

    def test_the_slot_is_released_after_a_failure(self):
        db = report_db()
        db.create_found_item.side_effect = Exception('boom')
        self.assertEqual(self.post(found_routes, found_routes.found_item_bp, '/api/found-items', FOUND_FORM, db).status_code, 500)
        ok_db = report_db()
        self.assertEqual(self.post(found_routes, found_routes.found_item_bp, '/api/found-items', FOUND_FORM, ok_db).status_code, 201)


class ClaimRouteTests(unittest.TestCase):
    def form(self, **extra):
        data = {'fpost_id': 'FP1001', 'claim_reason': 'It is my umbrella, it has my name inside', 'identity_document_type': 'campus_id', 'dpa_consent': 'true',
                'proof_image': (io.BytesIO(PNG), 'proof.png', 'image/png'), 'identity_document': (io.BytesIO(PNG), 'id.png', 'image/png')}
        data.update(extra)
        return {k: v for k, v in data.items() if v is not None}

    def db(self, pending=None):
        db = MagicMock()
        db.get_found_item_by_fpost_id.return_value = {'item_id': 'i1', 'fpost_id': 'FP1001', 'status': 'unclaimed', 'item_name': 'Umbrella'}
        db.get_pending_claim.return_value = pending
        db.create_claim.return_value = {'claim_id': 'c1', 'claim_reference': 'CL1'}
        db.get_user_by_account_id.return_value = {'email': 'u@umak.edu.ph', 'fname': 'Ana', 'lname': 'Reyes'}
        db.client.storage.from_.return_value.create_signed_url.return_value = {'signedURL': 'x'}
        return db

    def post(self, db, **extra):
        client = app_client(claim_routes.claims_bp, '/api/claims')
        with patch.object(claim_routes, 'get_db', return_value=db), patch.object(claim_routes, '_account_id', return_value=ACCOUNT), \
             patch.object(claim_routes, 'send_reference_email_best_effort', return_value=True):
            return client.post('/api/claims', data=self.form(**extra), content_type='multipart/form-data')

    def test_one_submission_creates_exactly_one_claim(self):
        db = self.db()
        self.assertEqual(self.post(db).status_code, 201)
        self.assertEqual(db.create_claim.call_count, 1)

    def test_an_overlapping_second_request_is_refused_and_creates_nothing(self):
        db = self.db()
        held = report_guard.begin_submission(f'claim:{ACCOUNT}:fp1001')
        try:
            response = self.post(db)
        finally:
            report_guard.end_submission(held)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['code'], 'duplicate_submission')
        db.create_claim.assert_not_called()

    def test_a_claim_that_is_already_open_is_refused(self):
        db = self.db(pending={'claim_id': 'c0'})
        self.assertEqual(self.post(db).status_code, 409)
        db.create_claim.assert_not_called()

    def test_a_database_uniqueness_error_becomes_a_clean_409(self):
        db = self.db()
        db.create_claim.side_effect = Exception('duplicate key value violates unique constraint "uq_claims_one_open_per_claimant_item"')
        response = self.post(db)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['code'], 'duplicate_claim')

    def test_dpa_consent_is_required(self):
        db = self.db()
        response = self.post(db, dpa_consent=None)
        self.assertEqual((response.status_code, response.get_json()['code']), (400, 'dpa_required'))
        db.create_claim.assert_not_called()

    def test_the_slot_is_released_after_the_request(self):
        db = self.db()
        self.post(db)
        self.assertEqual(self.post(db, ).status_code, 201)  # a later, separate submission is not blocked by the first


class VerificationUploadTests(unittest.TestCase):
    def test_dpa_consent_is_required_for_the_verification_document(self):
        client = app_client(profile_routes.profile_bp)
        data = {'document': (io.BytesIO(PNG), 'id.png', 'image/png'), 'document_type': 'government_id'}
        with patch.object(profile_routes.JWTService, 'extract_token_from_header', return_value='t'), \
             patch.object(profile_routes.JWTService, 'verify_token', return_value={'account_id': ACCOUNT}):
            response = client.post('/api/auth/profile/document-upload', data=data, content_type='multipart/form-data', headers={'Authorization': 'Bearer t'})
        self.assertEqual((response.status_code, response.get_json()['code']), (400, 'dpa_required'))


class AuctionPrivacyTests(unittest.TestCase):
    def service(self, rows):
        db = MagicMock()
        db.client = FakeClient(rows)
        service = AuctionService(db)
        service.settle_and_notify = lambda *a, **k: 0
        return service, db

    def rows(self):
        return {
            'auctions': [auction_row(status='active', ends_at=(NOW + timedelta(hours=2)).isoformat(), highest_bidder_id='w1', winner_account_id=None, bid_count=2, current_price=450, extension_count=1)],
            'auction_bids': [{'bid_id': 'b1', 'bidder_account_id': 'w1', 'amount': 450, 'created_at': NOW.isoformat()}, {'bid_id': 'b2', 'bidder_account_id': 'w2', 'amount': 400, 'created_at': (NOW - timedelta(minutes=5)).isoformat()}],
            'auction_comments': [{'comment_id': 'c1', 'account_id': 'w2', 'body': 'Still available?', 'created_at': NOW.isoformat()}],
            'user_profiles': [{'account_id': 'w1', 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'campus_id': 'K1'}],
        }

    def test_aliases_are_stable_per_auction_and_differ_between_people_and_auctions(self):
        self.assertEqual(bidder_alias('a1', 'w1'), bidder_alias('a1', 'w1'))
        self.assertNotEqual(bidder_alias('a1', 'w1'), bidder_alias('a1', 'w2'))
        self.assertNotEqual(bidder_alias('a1', 'w1'), bidder_alias('a2', 'w1'))
        self.assertRegex(bidder_alias('a1', 'w1'), r'^Bidder_[0-9A-Z]{3}$')

    def test_the_public_page_never_shows_real_names(self):
        service, _ = self.service(self.rows())
        detail = service.public_detail('a1', viewer_id='w2')
        text = str(detail)
        for forbidden in ('Maria', 'Santos', 'maria@umak', 'K1'):
            self.assertNotIn(forbidden, text)
        self.assertEqual(detail['auction']['leader'], bidder_alias('a1', 'w1'))
        self.assertTrue(all(b['bidder'].startswith('Bidder_') for b in detail['bids']))
        self.assertTrue(detail['comments'][0]['author'].startswith('Bidder_'))
        self.assertTrue(detail['bids'][1]['is_mine'])  # the viewer can still tell which bids are theirs

    def test_the_feed_is_anonymous_too(self):
        service, _ = self.service(self.rows())
        self.assertNotIn('Maria', str(service.public_feed()))

    def test_the_admin_still_sees_real_names(self):
        service, _ = self.service(self.rows())
        detail = service.admin_detail('a1')
        self.assertEqual(detail['auction']['leader'], 'Maria Santos')
        self.assertEqual(detail['auction']['leader_detail']['email'], 'maria@umak.edu.ph')

    def test_the_log_lists_the_opening_bids_extension_and_close(self):
        service, _ = self.service(self.rows())
        types = [e['type'] for e in service.public_detail('a1')['log']]
        self.assertEqual(types[0], 'opened')
        self.assertEqual(types.count('bid'), 2)
        self.assertIn('extended', types)

    def test_a_comment_with_foul_language_is_blocked_before_saving(self):
        service, db = self.service(self.rows())
        with self.assertRaises(AuctionError) as caught:
            service.add_comment('a1', 'w1', 'this is bullshit, putangina')
        self.assertEqual((caught.exception.status, caught.exception.extra['code']), (422, 'profanity'))
        self.assertEqual([w for w in db.client.writes if w[0] == 'auction_comments'], [])

    def test_a_clean_comment_is_saved_with_an_anonymous_author(self):
        client = MagicMock()

        def table(name):
            t = MagicMock()
            chain = t.select.return_value
            for _ in range(6):  # any depth of eq/order/limit chaining returns the same terminal mock
                chain.eq.return_value = chain
                chain.order.return_value = chain
                chain.limit.return_value = chain
            chain.execute.return_value = MagicMock(data=[{'auction_id': 'a1', 'status': 'active'}] if name == 'auctions' else [])
            t.insert.return_value.execute.return_value = MagicMock(data=[{'comment_id': 'c9', 'body': 'Is the bag still available?', 'created_at': NOW.isoformat()}])
            return t
        client.table.side_effect = table
        service = AuctionService(MagicMock(client=client))
        created = service.add_comment('a1', 'w1', 'Is the bag still available?')
        self.assertTrue(created['author'].startswith('Bidder_'))
        self.assertTrue(created['is_mine'])

    def test_reactions_degrade_when_the_table_is_missing(self):
        service, db = self.service(self.rows())
        db.client.fail['auction_reactions'] = 'relation "public.auction_reactions" does not exist'
        self.assertEqual(service.reaction_counts(['a1']), {})
        self.assertEqual(service.my_reaction_ids('w1'), [])
        from app.utils.auction_db import AuctionsUnavailable
        with self.assertRaises(AuctionsUnavailable):
            service.set_reaction('a1', 'w1', True)

    def test_reactions_are_saved_and_counted(self):
        rows = self.rows()
        rows['auction_reactions'] = [{'auction_id': 'a1'}, {'auction_id': 'a1'}]
        service, db = self.service(rows)
        result = service.set_reaction('a1', 'w1', True)
        self.assertEqual(result['reaction_count'], 2)
        self.assertIn(('auction_reactions', 'upsert', {'auction_id': 'a1', 'account_id': 'w1'}), db.client.writes)

    def test_resending_the_winner_email_needs_a_confirmed_winner(self):
        service, _ = self.service({'auctions': [auction_row(status='awaiting_admin')]})
        with self.assertRaises(AuctionError):
            service.resend_winner_email('a1')

    def test_a_failed_winner_email_is_recorded_so_it_can_be_resent(self):
        rows = {'auctions': [auction_row(status='ended', fulfillment_status='awaiting_pickup', winner_account_id='w1')], 'user_profiles': [{'account_id': 'w1', 'fname': 'Maria', 'email': 'maria@umak.edu.ph'}]}
        service, db = self.service(rows)
        with patch('app.utils.auction_db.send_auction_won_email', return_value={'mode': 'sendgrid', 'sent': False, 'subject': 's'}):
            result = service.resend_winner_email('a1')
        self.assertEqual(result['recorded'], 'sendgrid_failed')
        self.assertIn(('auctions', 'update', {'winner_email_mode': 'sendgrid_failed'}), db.client.writes)

    def test_the_winner_email_mode_auto_sends_only_when_sendgrid_is_configured(self):
        from app.utils import auction_email
        with patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'auto', 'SENDGRID_API_KEY': ''}), patch.object(auction_email.logger, 'info'):
            self.assertEqual(auction_email.send_auction_won_email(to_email='a@b.c', recipient_name='A', item_title='T', reference='R', amount=5)['mode'], 'mock')
        with patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'auto', 'SENDGRID_API_KEY': 'SG.x'}), patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as send:
            result = auction_email.send_auction_won_email(to_email='a@b.c', recipient_name='A', item_title='T', reference='R', amount=5)
        self.assertEqual((result['mode'], result['sent']), ('sendgrid', True))
        send.assert_called_once()


class AiMatchEmailTests(unittest.TestCase):
    def db(self):
        db = SupabaseDB.__new__(SupabaseDB)
        rows = {'missing_items': {'item_id': 'm1', 'mpost_id': 'MP1', 'account_id': 'u1', 'reporter_account_id': 'u1', 'item_name': 'Black wallet'},
                'found_items': {'item_id': 'f1', 'fpost_id': 'FP1', 'item_name': 'Wallet'}}
        client = MagicMock()

        def table(name):
            t = MagicMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data=rows.get(name))
            t.insert.return_value.execute.return_value = MagicMock(data=[{'match_id': 'x1'}])
            return t
        client.table.side_effect = table
        db.client = client
        db.get_user_by_account_id = MagicMock(return_value={'email': 'ana@umak.edu.ph', 'fname': 'Ana', 'lname': 'Reyes'})
        db.log_user_activity = MagicMock()
        db.create_user_notification = MagicMock(return_value={'notification_id': 'n1'})
        return db

    def test_confirming_a_match_emails_the_missing_item_reporter(self):
        db = self.db()
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as send:
            result = db.confirm_ai_match_and_notify('MP1', 'FP1', confirmed_by_account_id='admin')
        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs['to_email'], 'ana@umak.edu.ph')
        self.assertEqual(kwargs['reference'], 'MP1')
        self.assertNotIn('location', str(kwargs).lower())  # the found item's location is not emailed
        self.assertTrue(result['email_sent'])
        self.assertIn('email', result['message'])

    def test_an_email_failure_does_not_undo_the_confirmation(self):
        db = self.db()
        with patch('app.utils.email_service.send_reference_email_best_effort', side_effect=Exception('sendgrid down')):
            result = db.confirm_ai_match_and_notify('MP1', 'FP1', confirmed_by_account_id='admin')
        self.assertTrue(result['success'])
        self.assertFalse(result['email_sent'])
        db.create_user_notification.assert_called_once()


class ReauctionRuleRouteTests(unittest.TestCase):
    def test_reauction_before_confirming_a_winner_is_refused(self):
        service = AuctionService(MagicMock(client=FakeClient({'auctions': [auction_row(status='awaiting_admin')]})))
        with self.assertRaises(AuctionError) as caught:
            service.reauction('a1', {}, ACCOUNT)
        self.assertEqual(caught.exception.status, 409)
        self.assertIn('Confirm the winner first', caught.exception.message)


if __name__ == '__main__':
    unittest.main()
