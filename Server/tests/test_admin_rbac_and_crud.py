import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from Admin.Backend.shared import admin_access
from Admin.Backend.lost_items import routes as lost_routes
from Admin.Backend.users import routes as user_routes
from Admin.Backend.claims_verification import routes as claim_routes

ADMIN = {"account_id": "11111111-1111-4111-8111-111111111111", "email": "admin@umak.edu.ph", "access_level": "admin"}
SUPER = {"account_id": "22222222-2222-4222-8222-222222222222", "email": "super@umak.edu.ph", "access_level": "super_admin"}


def require_as(actor):
    """Fake _require_admin that enforces the requested level against the given actor."""
    def _require(required_level="admin"):
        if required_level == "super_admin" and actor["access_level"] != "super_admin":
            raise PermissionError("Super administrator access required")
        return dict(actor)
    return _require


class FakeDB:
    def __init__(self):
        self.users = {
            "victim@umak.edu.ph": {"account_id": "33333333-3333-4333-8333-333333333333", "email": "victim@umak.edu.ph", "campus_id": "K1234", "access_level": "user", "is_active": True, "fname": "Vic", "lname": "Tim"},
            "boss@umak.edu.ph": {"account_id": "44444444-4444-4444-8444-444444444444", "email": "boss@umak.edu.ph", "campus_id": "SA-1", "access_level": "super_admin", "is_active": True, "fname": "Big", "lname": "Boss"},
        }
        self.created = []
        self.updated = []
        self.claims = []
        self.activity = []

    def get_user_by_email(self, email):
        return self.users.get(email)

    def get_user_by_campus_id(self, campus_id):
        return next((u for u in self.users.values() if u["campus_id"] == campus_id), None)

    def get_user_by_account_id(self, account_id):
        return next((u for u in self.users.values() if u["account_id"] == account_id), None)

    def create_user_profile(self, data):
        self.created.append(data)
        return {**data, "created_at": "now"}

    def update_user(self, account_id, data):
        self.updated.append((account_id, data))
        return {**self.get_user_by_account_id(account_id), **data}

    def log_user_activity(self, **kwargs):
        self.activity.append(kwargs)

    def get_found_item_by_fpost_id(self, reference):
        return {"FP1001": {"item_id": "item-1", "item_name": "Calculator", "status": "unclaimed"},
                "FP1002": {"item_id": "item-2", "item_name": "Wallet", "status": "claimed"}}.get(reference)

    def find_open_claim(self, found_item_id, account_id):
        return None

    def create_claim(self, data):
        self.claims.append(data)
        return {**data, "claim_id": "claim-1", "claim_reference": "CLM-2026-0001-X"}

    def create_user_notification(self, *args, **kwargs):
        return {}


def make_app(*blueprints, guard=False):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL="unused", SUPABASE_SERVICE_KEY="unused")
    for blueprint in blueprints:
        if guard:
            app.before_request(admin_access.enforce_super_admin_for_deletes)
        app.register_blueprint(blueprint, url_prefix="/api/admin")
    return app.test_client()


class SuperAdminDeleteGuardTests(unittest.TestCase):
    def test_standard_admin_delete_is_blocked_before_the_route_runs(self):
        client = make_app(lost_routes.lost_items_bp, guard=True)
        with patch.object(admin_access, "_require_admin", side_effect=require_as(ADMIN)), patch.object(lost_routes, "get_db") as get_db:
            response = client.delete("/api/admin/lost-items/MP1001")
        self.assertEqual(response.status_code, 403)
        self.assertIn("super administrators", response.get_json()["error"])
        get_db.assert_not_called()

    def test_super_admin_delete_passes_the_guard(self):
        client = make_app(lost_routes.lost_items_bp, guard=True)
        with patch.object(admin_access, "_require_admin", side_effect=require_as(SUPER)), \
             patch.object(lost_routes, "_require_admin", side_effect=require_as(SUPER)), \
             patch.object(lost_routes, "get_db", return_value=MagicMock()) as get_db:
            response = client.delete("/api/admin/lost-items/MP1001")
        self.assertNotEqual(response.status_code, 403)
        get_db.assert_called()

    def test_guard_ignores_non_delete_methods(self):
        client = make_app(lost_routes.lost_items_bp, guard=True)
        with patch.object(admin_access, "_require_admin", side_effect=AssertionError("guard should not run")), \
             patch.object(lost_routes, "_require_admin", side_effect=require_as(ADMIN)), \
             patch.object(lost_routes, "get_db", return_value=MagicMock(list_admin_missing_items=MagicMock(return_value=[]))):
            response = client.get("/api/admin/lost-items")
        self.assertEqual(response.status_code, 200)


class AdminUserCrudTests(unittest.TestCase):
    def setUp(self):
        self.client = make_app(user_routes.users_bp)
        self.db = FakeDB()

    def post_user(self, actor, body):
        with patch.object(user_routes, "_require_admin", side_effect=require_as(actor)), patch.object(user_routes, "get_db", return_value=self.db):
            return self.client.post("/api/admin/users", json=body)

    def test_admin_can_create_standard_user_with_hashed_password(self):
        response = self.post_user(ADMIN, {"fname": "Ana", "lname": "Cruz", "email": "Ana.Cruz@umak.edu.ph", "campus_id": "K9999", "user_role": "student", "password": "a-very-long-temp-pass"})
        self.assertEqual(response.status_code, 201)
        created = self.db.created[0]
        self.assertEqual(created["email"], "ana.cruz@umak.edu.ph")
        self.assertEqual(created["access_level"], "user")
        self.assertNotIn("password", created)
        self.assertNotEqual(created["password_hash"], "a-very-long-temp-pass")
        self.assertEqual(self.db.activity[0]["action"], "Create User")

    def test_create_rejects_short_password_and_duplicates(self):
        short = self.post_user(ADMIN, {"fname": "A", "lname": "B", "email": "new@umak.edu.ph", "campus_id": "K1", "password": "short"})
        self.assertEqual(short.status_code, 400)
        duplicate = self.post_user(ADMIN, {"fname": "A", "lname": "B", "email": "victim@umak.edu.ph", "campus_id": "K2", "password": "a-very-long-temp-pass"})
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(self.db.created, [])

    def test_admin_cannot_edit_super_admin_or_escalate_access(self):
        boss_id = self.db.users["boss@umak.edu.ph"]["account_id"]
        victim_id = self.db.users["victim@umak.edu.ph"]["account_id"]
        with patch.object(user_routes, "_require_admin", side_effect=require_as(ADMIN)), patch.object(user_routes, "get_db", return_value=self.db):
            edit_super = self.client.patch(f"/api/admin/users/{boss_id}", json={"fname": "Hacked"})
            escalate = self.client.patch(f"/api/admin/users/{victim_id}", json={"access_level": "super_admin"})
            ok = self.client.patch(f"/api/admin/users/{victim_id}", json={"fname": "Victoria"})
        self.assertEqual(edit_super.status_code, 403)
        self.assertEqual(escalate.status_code, 400)
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.db.updated[0][1]["fname"], "Victoria")


class AdminClaimCreateTests(unittest.TestCase):
    def setUp(self):
        self.client = make_app(claim_routes.claims_verification_bp)
        self.db = FakeDB()

    def post_claim(self, body):
        with patch.object(claim_routes, "_require_admin", side_effect=require_as(ADMIN)), patch.object(claim_routes, "get_db", return_value=self.db):
            return self.client.post("/api/admin/claims", json=body)

    def test_admin_records_walk_in_claim(self):
        response = self.post_claim({"found_item_reference": "FP1001", "claimant": "victim@umak.edu.ph", "claim_reason": "Has my name inside", "verified_in_person": True})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.db.claims[0]["status"], "pending")
        self.assertEqual(self.db.claims[0]["identity_document_type"], "verified_in_person")

    def test_claim_rejects_closed_item_and_unknown_claimant(self):
        closed = self.post_claim({"found_item_reference": "FP1002", "claimant": "victim@umak.edu.ph", "claim_reason": "Mine"})
        unknown = self.post_claim({"found_item_reference": "FP1001", "claimant": "nobody@umak.edu.ph", "claim_reason": "Mine"})
        self.assertEqual(closed.status_code, 409)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(self.db.claims, [])



class LostItemStatusTests(unittest.TestCase):
    """update_admin_missing_item accepts only the documented missing_items lifecycle values."""

    def make_db(self):
        from app.utils.supabase_db import SupabaseDB
        db = SupabaseDB.__new__(SupabaseDB)  # skip the network client set-up
        db.client = MagicMock()
        db._admin_item_row = MagicMock(return_value={"item_id": "row-1"})
        db.client.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"item_id": "row-1", "status": "returned"}])
        return db

    def test_valid_status_is_written(self):
        db = self.make_db()
        result = db.update_admin_missing_item("MP1001", {"status": "Returned"})
        written = db.client.table.return_value.update.call_args[0][0]
        self.assertEqual(written["status"], "returned")
        self.assertEqual(result["status"], "returned")

    def test_unknown_status_is_rejected_before_writing(self):
        db = self.make_db()
        with self.assertRaises(ValueError):
            db.update_admin_missing_item("MP1001", {"status": "deleted"})
        db.client.table.return_value.update.assert_not_called()

    def test_route_maps_invalid_status_to_400(self):
        client = make_app(lost_routes.lost_items_bp)
        fake = MagicMock()
        fake.update_admin_missing_item.side_effect = ValueError("Invalid lost item status")
        with patch.object(lost_routes, "_require_admin", side_effect=require_as(ADMIN)), patch.object(lost_routes, "get_db", return_value=fake):
            response = client.put("/api/admin/lost-items/MP1001", json={"status": "deleted"})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
