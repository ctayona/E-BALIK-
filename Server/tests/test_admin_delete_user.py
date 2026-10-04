import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from Admin.Backend.users import routes as admin_routes


ADMIN_ID = "11111111-1111-4111-8111-111111111111"
TARGET_ID = "22222222-2222-4222-8222-222222222222"


class FakeDatabase:
    def __init__(self, mfa_enabled=True, consume_step=True):
        self.mfa_enabled = mfa_enabled
        self.consume_step = consume_step
        self.failed_attempts = 0
        self.deleted_call = None
        self.activity = []

    def get_admin_mfa(self, account_id):
        if not self.mfa_enabled:
            return None
        return {
            "enabled_at": "2026-10-01T12:00:00+00:00",
            "secret_ciphertext": "encrypted-secret",
            "locked_until": None,
        }

    def record_admin_mfa_failure(self, account_id):
        self.failed_attempts += 1

    def consume_admin_mfa_step(self, account_id, accepted_step):
        return self.consume_step

    def delete_admin_user(self, target_account_id, admin_account_id, totp_step):
        self.deleted_call = (target_account_id, admin_account_id, totp_step)
        return {
            "deleted_found_items": 2,
            "deleted_missing_items": 1,
            "deleted_claims": 3,
            "deleted_notifications": 4,
            "deleted_activity_rows": 5,
            "storage_cleanup_complete": True,
            "storage_cleanup_failures": [],
        }

    def log_user_activity(self, **kwargs):
        self.activity.append(kwargs)


class AdminDeleteUserRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SUPABASE_URL="unused", SUPABASE_SERVICE_KEY="unused")
        self.app.register_blueprint(admin_routes.users_bp, url_prefix="/api/admin")
        self.client = self.app.test_client()
        self.actor = {"account_id": ADMIN_ID, "email": "admin@example.edu", "access_level": "super_admin"}

    def test_requires_exact_confirmation_before_database_access(self):
        with patch.object(admin_routes, "_require_admin", return_value=self.actor), patch.object(admin_routes, "get_db") as get_db:
            response = self.client.delete(f"/api/admin/users/{TARGET_ID}", json={"confirmation": "yes"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("CONFIRM", response.get_json()["error"])
        get_db.assert_not_called()

    def test_requires_enabled_authenticator(self):
        database = FakeDatabase(mfa_enabled=False)
        with patch.object(admin_routes, "_require_admin", return_value=self.actor), patch.object(admin_routes, "get_db", return_value=database):
            response = self.client.delete(f"/api/admin/users/{TARGET_ID}", json={"confirmation": "CONFIRM", "authenticator_code": "123456"})

        self.assertEqual(response.status_code, 403)
        self.assertIsNone(database.deleted_call)

    def test_invalid_authenticator_is_recorded_and_does_not_delete(self):
        database = FakeDatabase()
        with patch.object(admin_routes, "_require_admin", return_value=self.actor), patch.object(admin_routes, "get_db", return_value=database), patch.object(admin_routes, "matched_totp_step", return_value=None):
            response = self.client.delete(f"/api/admin/users/{TARGET_ID}", json={"confirmation": "CONFIRM", "authenticator_code": "123456"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(database.failed_attempts, 1)
        self.assertIsNone(database.deleted_call)

    def test_valid_confirmation_and_authenticator_call_delete_rpc(self):
        database = FakeDatabase()
        with patch.object(admin_routes, "_require_admin", return_value=self.actor), patch.object(admin_routes, "get_db", return_value=database), patch.object(admin_routes, "matched_totp_step", return_value=12345):
            response = self.client.delete(f"/api/admin/users/{TARGET_ID}", json={"confirmation": "CONFIRM", "authenticator_code": "654321"})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        self.assertEqual(database.deleted_call, (TARGET_ID, ADMIN_ID, 12345))
        self.assertEqual(len(database.activity), 1)

    def test_superadmin_cannot_delete_self(self):
        with patch.object(admin_routes, "_require_admin", return_value=self.actor), patch.object(admin_routes, "get_db") as get_db:
            response = self.client.delete(f"/api/admin/users/{ADMIN_ID}", json={"confirmation": "CONFIRM", "authenticator_code": "654321"})

        self.assertEqual(response.status_code, 403)
        get_db.assert_not_called()


if __name__ == "__main__":
    unittest.main()
