"""Role changes retain official identity and refresh the private E-Balik display ID."""
import unittest
from unittest.mock import MagicMock, patch
from flask import Flask
from app.utils.account_identity import ebalik_id
from Admin.Backend.users import routes

ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'


class RoleIdentityTests(unittest.TestCase):
    def test_id_follows_role_and_preserves_original_identifiers(self):
        profile = dict(account_id=OWNER, campus_id='K12345678', user_role='Student', access_level='user')
        original = dict(profile)
        self.assertTrue(ebalik_id(profile).startswith('STU-'))
        for role, prefix in [('guard', 'GRD'), ('admin', 'ADM'), ('super_admin', 'SUP')]:
            changed = {**profile, 'access_level': role}
            self.assertEqual(ebalik_id(changed), prefix + '-' + OWNER.replace('-', '').upper())
        self.assertEqual(profile, original)
        self.assertTrue(ebalik_id({**profile, 'user_category': 'Faculty'}).startswith('FAC-'))
        self.assertEqual(ebalik_id({}), '')

    def client(self):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='offline', SUPABASE_SERVICE_KEY='offline')
        app.register_blueprint(routes.users_bp, url_prefix='/api/admin')
        profile = dict(account_id=OWNER, campus_id='K12345678', user_role='Student',
                       access_level='user', is_active=True, email='fixture@example.invalid', fname='Test', lname='Person')
        db = MagicMock()
        db.get_user_by_account_id.side_effect = lambda identifier: dict(profile)
        def change(identifier, level, actor):
            profile['access_level'] = level
            return dict(account_id=OWNER, email=profile['email'], access_level=level, user_role=profile['user_role'])
        db.set_user_access_level.side_effect = change
        actor = dict(account_id=ADMIN, access_level='super_admin', email='admin@example.invalid')
        for patcher in [patch.object(routes, '_require_admin', return_value=actor),
                        patch.object(routes, 'get_db', return_value=db)]:
            patcher.start()
            self.addCleanup(patcher.stop)
        return app.test_client(), profile, db

    def test_guard_promotion_returns_complete_refreshed_identity_and_is_retry_safe(self):
        client, profile, db = self.client()
        url = '/api/admin/users/' + OWNER + '/access-level'
        reply = client.patch(url, json=dict(access_level='guard'))
        self.assertEqual(reply.status_code, 200)
        row = reply.get_json()['profile']
        self.assertEqual(row['studentId'], 'K12345678')
        self.assertTrue(row['roleId'].startswith('GRD-'))
        self.assertEqual(row['accessLevel'], 'guard')
        self.assertEqual(profile['account_id'], OWNER)
        self.assertEqual(client.patch(url, json=dict(access_level='guard')).status_code, 200)
        self.assertEqual(db.set_user_access_level.call_count, 1)

    def test_archived_and_inactive_accounts_are_explained_before_mutation(self):
        client, profile, db = self.client()
        profile['is_active'] = False
        url = '/api/admin/users/' + OWNER + '/access-level'
        self.assertEqual(client.patch(url, json=dict(access_level='guard')).status_code, 409)
        profile['archived_at'] = '2026-11-25T00:00:00Z'
        self.assertEqual(client.patch(url, json=dict(access_level='guard')).get_json()['code'], 'account_archived')
        db.set_user_access_level.assert_not_called()

    def test_demotion_restores_affiliation_id_without_changing_official_id(self):
        client, profile, db = self.client()
        profile.update(access_level='guard', user_category='Faculty', user_role='Faculty')
        reply = client.patch('/api/admin/users/' + OWNER + '/access-level', json=dict(access_level='user'))
        self.assertEqual(reply.status_code, 200)
        row = reply.get_json()['profile']
        self.assertTrue(row['roleId'].startswith('FAC-'))
        self.assertEqual(row['studentId'], 'K12345678')
        self.assertEqual(db.set_user_access_level.call_count, 1)

    def test_role_permissions_and_setup_failure_remain_explicit(self):
        client, profile, db = self.client()
        url = '/api/admin/users/' + OWNER + '/access-level'
        with patch.object(routes, '_require_admin', return_value=dict(account_id=ADMIN, access_level='admin')):
            self.assertEqual(client.patch(url, json=dict(access_level='admin')).status_code, 403)
            profile['access_level'] = 'admin'
            self.assertEqual(client.patch(url, json=dict(access_level='guard')).status_code, 403)
        profile['access_level'] = 'super_admin'
        self.assertEqual(client.patch(url, json=dict(access_level='guard')).status_code, 403)
        self.assertEqual(client.patch('/api/admin/users/' + ADMIN + '/access-level', json=dict(access_level='guard')).status_code, 400)
        profile['access_level'] = 'user'
        db.set_user_access_level.assert_not_called()
        db.set_user_access_level.side_effect = RuntimeError('user_profiles_access_level_check')
        reply = client.patch(url, json=dict(access_level='guard'))
        self.assertEqual(reply.status_code, 503)
        self.assertEqual(reply.get_json()['code'], 'guard_role_setup_required')
        with patch.object(routes, '_require_admin', side_effect=RuntimeError('offline auth failure')):
            self.assertEqual(client.patch(url, json=dict(access_level='guard')).status_code, 500)

    def test_affiliation_edit_updates_identity_without_overwriting_campus_id(self):
        client, profile, db = self.client()
        def update(identifier, fields):
            profile.update(fields)
            return dict(profile)
        db.update_user.side_effect = update
        reply = client.patch('/api/admin/users/' + OWNER, json=dict(user_role='Faculty'))
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(profile['campus_id'], 'K12345678')
        self.assertEqual(profile['user_category'], 'Faculty')
        self.assertTrue(reply.get_json()['user']['roleId'].startswith('FAC-'))

    def test_owner_profile_edit_preserves_admin_assigned_affiliation(self):
        from Users.Backend.profile import routes as owner_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='offline', SUPABASE_SERVICE_KEY='offline')
        app.register_blueprint(owner_routes.profile_bp, url_prefix='/api')
        profile = dict(account_id=OWNER, fname='Maria', lname='Santos', email='m.santos.k12345678@umak.edu.ph',
                       campus_id='EMP-0001', user_role='Staff', user_category='Staff', access_level='user',
                       verification_status='pending')
        db = MagicMock()
        db.get_user_by_account_id.side_effect = lambda identifier: dict(profile)
        db._decrypt_profile_sensitive_fields.side_effect = lambda row: row
        def update(identifier, fields):
            profile.update(fields)
            return dict(profile)
        db.update_user.side_effect = update
        with (
            patch.object(owner_routes, 'get_db', return_value=db),
            patch.object(owner_routes.JWTService, 'extract_token_from_header', return_value='offline'),
            patch.object(owner_routes.JWTService, 'verify_token', return_value=dict(account_id=OWNER)),
        ):
            reply = app.test_client().put('/api/auth/profile', headers={'Authorization': 'Bearer offline'},
                json=dict(fname='Maria', lname='Santos', email=profile['email']))
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(profile['user_role'], 'Staff')
        self.assertEqual(profile['campus_id'], 'EMP-0001')
        self.assertTrue(reply.get_json()['user']['ebalik_id'].startswith('STF-'))
