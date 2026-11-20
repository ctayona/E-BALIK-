"""Isolated artwork validation, revision conflicts, cleanup and scoped access."""
import io
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from memdb import MemClient
from app.utils.event_assets import EventAssets, normalize_artwork, MAX_BYTES
from app.utils.events import EventError, EventFoundation
from Admin.Backend.events import routes
from flask import Flask

ACTOR = '11111111-1111-4111-8111-111111111111'


def picture():
    buffer = io.BytesIO()
    Image.new('RGB', (40, 20), 'navy').save(buffer, 'PNG')
    return buffer.getvalue()


class ArtworkTests(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self.db = SimpleNamespace(client=MemClient(self.store))
        self.db.client.storage = MagicMock()
        self.bucket = self.db.client.storage.from_.return_value
        self.bucket.create_signed_url.return_value = {'signedURL': 'https://storage.example.test/signed-art'}
        self.events = EventFoundation(self.db)
        self.event = self.events.create({'name': 'Pilot'}, ACTOR)
        self.assets = EventAssets(self.db)

    def test_reencodes_image_to_webp(self):
        output = normalize_artwork(picture(), 'logo')
        with Image.open(io.BytesIO(output)) as image:
            self.assertEqual(image.format, 'WEBP')
            self.assertNotIn('exif', image.info)

    def test_invalid_and_oversized_uploads_rejected(self):
        for data, kind in ((b'<svg></svg>', 'logo'), (b'not-an-image', 'banner'), (b'x' * (MAX_BYTES + 1), 'logo'), (picture(), '../evil')):
            with self.subTest(kind=kind), self.assertRaises(EventError):
                normalize_artwork(data, kind)

    def test_revision_safe_replace_and_remove(self):
        first = self.assets.save(self.event['event_id'], 'logo', picture(), 0, ACTOR)
        self.assertEqual(first['revision'], 1)
        self.assertEqual(first['url'], 'https://storage.example.test/signed-art')
        with self.assertRaises(EventError):
            self.assets.save(self.event['event_id'], 'logo', picture(), 0, ACTOR)
        removed = self.assets.save(self.event['event_id'], 'logo', None, 1, ACTOR)
        self.assertEqual((removed['url'], removed['revision']), (None, 2))
        self.bucket.remove.assert_not_called()

    def test_cross_event_asset_cannot_be_modified(self):
        self.assets.save(self.event['event_id'], 'banner', picture(), 0, ACTOR)
        other = self.events.create({'name': 'Other'}, ACTOR)
        self.assertIsNone(self.assets.list(other['event_id'])['banner'])
        with self.assertRaises(EventError):
            self.assets.save(other['event_id'], 'banner', None, 1, ACTOR)

    def test_metadata_conflict_cleans_up_new_object(self):
        with patch.object(self.assets, '_current', return_value=None), patch.object(self.assets.events, 'get', return_value=self.event), patch.object(self.assets.events, '_execute', side_effect=RuntimeError('conflict')):
            with self.assertRaises(RuntimeError):
                self.assets.save(self.event['event_id'], 'logo', picture(), 0, ACTOR)
        uploaded_path = self.bucket.upload.call_args.args[0]
        self.bucket.remove.assert_called_once_with([uploaded_path])

    def test_foreign_storage_path_never_signed(self):
        with self.assertRaises(EventError):
            self.assets._view({'asset_id': ACTOR, 'event_id': self.event['event_id'], 'kind': 'logo', 'revision': 1, 'object_path': f'{ACTOR}/logo/{"a" * 32}.webp'})
        self.bucket.create_signed_url.assert_not_called()

    def test_bad_input_never_uploads(self):
        with self.assertRaises(EventError):
            self.assets.save(self.event['event_id'], 'banner', b'not-image', 0, ACTOR)
        self.bucket.upload.assert_not_called()

    def test_routes_require_super_admin_before_storage(self):
        app = Flask(__name__)
        app.config['EVENTS_FOUNDATION_ENABLED'] = True
        app.register_blueprint(routes.events_bp, url_prefix='/api/admin')
        with patch.object(routes, '_require_admin', side_effect=PermissionError()), patch.object(routes, 'get_db') as db:
            self.assertEqual(app.test_client().get(f'/api/admin/events/{ACTOR}/assets').status_code, 403)
            self.assertEqual(app.test_client().post(f'/api/admin/events/{ACTOR}/assets/logo').status_code, 403)
            db.assert_not_called()
