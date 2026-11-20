"""Private event artwork. Metadata uses optimistic revisions; campus media is untouched."""
import io
import logging
import re
import warnings
from datetime import datetime, timezone
from uuid import uuid4
from PIL import Image, ImageOps, UnidentifiedImageError
from app.utils.events import EventError, EventFoundation, EventSetupRequired, event_id

BUCKET = 'event-brand-assets'
MAX_BYTES = 5 * 1024 * 1024
logger = logging.getLogger(__name__)


def normalize_artwork(data, kind):
    if kind not in ('logo', 'banner'):
        raise EventError('Choose logo or banner.')
    if not data or len(data) > MAX_BYTES:
        raise EventError('Choose an image no larger than 5 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP') or getattr(source, 'n_frames', 1) != 1:
                    raise EventError('Use a non-animated JPG, PNG or WebP image.')
                if source.width * source.height > 20_000_000:
                    raise EventError('Image dimensions are too large (maximum 20 megapixels).')
                source.load()
                picture = ImageOps.exif_transpose(source).convert('RGBA' if kind == 'logo' else 'RGB')
                picture.thumbnail((800, 800) if kind == 'logo' else (2400, 1400))
                # Rebuild pixels to discard EXIF, comments and untrusted metadata.
                clean = Image.new(picture.mode, picture.size)
                clean.paste(picture)
                output = io.BytesIO()
                clean.save(output, format='WEBP', quality=88)
                result = output.getvalue()
                if len(result) > MAX_BYTES:
                    raise EventError('Image is still too large after resizing.')
                return result
    except EventError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise EventError('Unable to read this image. Use a valid JPG, PNG or WebP.') from None


class EventAssets:
    def __init__(self, db):
        self.events = EventFoundation(db)
        self.client = db.client

    def _current(self, identifier, kind):
        identifier = event_id(identifier)
        if kind not in ('logo', 'banner'):
            raise EventError('Choose logo or banner.')
        self.events.get(identifier)
        try:
            rows = self.events._execute(self.client.table('event_brand_assets').select('*').eq('event_id', identifier).eq('kind', kind).limit(1))
        except EventSetupRequired:
            raise EventError('Run 20261115b_event_brand_assets.sql to enable event artwork.', 503, 'artwork_setup_required') from None
        return rows[0] if rows else None

    def _view(self, row):
        if not row:
            return None
        path = row.get('object_path')
        url = None
        if path:
            expected = rf"{re.escape(row['event_id'])}/{row['kind']}/[0-9a-f]{{32}}\.webp"
            if not re.fullmatch(expected, path):
                raise EventError('Artwork path failed validation.', 409, 'invalid_asset')
            signed = self.client.storage.from_(BUCKET).create_signed_url(path, 600)
            url = signed.get('signedURL') or signed.get('signedUrl')
            if not url:
                raise EventError('Unable to load artwork preview.', 503, 'asset_unavailable')
        return {'asset_id': row['asset_id'], 'kind': row['kind'], 'revision': row['revision'], 'url': url}

    def list(self, identifier):
        return {kind: self._view(self._current(identifier, kind)) for kind in ('logo', 'banner')}

    def save(self, identifier, kind, data, expected_revision, actor_id):
        identifier = event_id(identifier)
        actor_id = event_id(actor_id)
        current = self._current(identifier, kind)
        revision = current['revision'] if current else 0
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision != revision:
            raise EventError('Artwork changed. Refresh before saving.', 409, 'asset_conflict')
        if self.events.get(identifier)['status'] != 'draft':
            raise EventError('Artwork can only be changed for drafts.', 409, 'event_locked')
        path = None
        if data is not None:
            content = normalize_artwork(data, kind)
            path = f'{identifier}/{kind}/{uuid4().hex}.webp'
            self.client.storage.from_(BUCKET).upload(path, content, {'content-type': 'image/webp', 'upsert': 'false'})
        now = datetime.now(timezone.utc).isoformat()
        values = {'object_path': path, 'revision': revision + 1, 'updated_at': now, 'updated_by': actor_id}
        try:
            if current:
                rows = self.events._execute(self.client.table('event_brand_assets').update(values).eq('asset_id', current['asset_id']).eq('event_id', identifier).eq('revision', revision))
            else:
                rows = self.events._execute(self.client.table('event_brand_assets').insert({**values, 'asset_id': str(uuid4()), 'event_id': identifier, 'kind': kind, 'created_at': now}), 'Artwork was added by another session. Refresh before saving.')
            if not rows:
                raise EventError('Artwork changed. Refresh before saving.', 409, 'asset_conflict')
        except Exception:
            if path:
                try:
                    self.client.storage.from_(BUCKET).remove([path])
                except Exception:
                    logger.warning('New event artwork could not be cleaned up after a failed save.')
            raise
        # Replaced artwork is retained; never delete an older object a prior preview may still use.
        return self._view(rows[0])
