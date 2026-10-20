"""Search found items by photo: "show me what looks like my lost bag".

No outside AI service and no cost: each photo is reduced to a small visual fingerprint with Pillow, and a search compares the query
photo's fingerprint with the fingerprints of items waiting at the office. The fingerprint has three parts:
  * `dh`  a 64-bit difference hash: the broad shape and light/dark layout (survives resizing and small colour changes);
  * `g`   a 4x4 grid of average colours: where the colours sit in the picture;
  * `h`   a 12-bin colour (hue) histogram weighted by saturation: the overall palette.
This finds items that look alike (same colour, similar shape, similar framing). It cannot read text or tell two black phones apart,
so results are suggestions to look at, ranked by similarity, never a verdict. The fingerprint is stored on the found item
(`found_items.image_features`, migration 20261023) when the photo is uploaded; items from before that are fingerprinted on the first
search that meets them (a few per search) and remembered.
"""
import colorsys
import io
import logging
import urllib.request
from typing import Any, Dict, List, Optional

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

VERSION = 1
GRID = 4
HUE_BINS = 12
MAX_PIXELS = 24_000_000           # refuse decompression bombs
MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024
BACKFILL_PER_SEARCH = 20
MIN_SIMILARITY = 0.42
MAX_RESULTS = 12
WEIGHTS = (0.30, 0.35, 0.35)      # shape, colour layout, palette

_cache: Dict[str, Dict[str, Any]] = {}   # item id -> fingerprint, for the life of the process (rows without the column yet)


def _open(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    if image.width * image.height > MAX_PIXELS:
        raise ValueError('That photo is too large.')
    image.draft('RGB', (320, 320))                     # JPEG: decode small, much faster
    image = ImageOps.exif_transpose(image)             # phone photos carry their rotation in metadata
    if image.mode in ('RGBA', 'LA', 'P'):
        flat = Image.new('RGB', image.size, (255, 255, 255))
        flat.paste(image.convert('RGBA'), mask=image.convert('RGBA').split()[-1])
        return flat
    return image.convert('RGB')


def fingerprint(data: bytes) -> Optional[Dict[str, Any]]:
    """The visual fingerprint of an image, or None when the bytes are not a readable image."""
    try:
        image = _open(data)
    except Exception as error:
        logger.info('Photo could not be fingerprinted: %s', str(error)[:100])
        return None
    gray = image.convert('L').resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.tobytes())          # tobytes works on every Pillow version (getdata is being removed)
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (1 if pixels[row * 9 + col] > pixels[row * 9 + col + 1] else 0)
    small = image.resize((GRID, GRID), Image.Resampling.BOX)
    grid = list(small.tobytes())
    sample = image.resize((48, 48), Image.Resampling.BOX)
    histogram = [0.0] * HUE_BINS
    raw = sample.tobytes()
    for index in range(0, len(raw), 3):
        red, green, blue = raw[index], raw[index + 1], raw[index + 2]
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        weight = saturation * (0.25 + 0.75 * value)    # grey and near-black pixels carry no colour information
        histogram[min(HUE_BINS - 1, int(hue * HUE_BINS))] += weight
    total = sum(histogram)
    # Almost no colour (black, white, grey item): record how dark or light it is instead, so two grey items can still match.
    if total < 5:
        mean = sum(pixels) / len(pixels)
        return {'v': VERSION, 'dh': f'{bits:016x}', 'g': grid, 'h': [], 'tone': round(mean)}
    return {'v': VERSION, 'dh': f'{bits:016x}', 'g': grid, 'h': [round(255 * value / total) for value in histogram], 'tone': None}


def similarity(a: Optional[Dict[str, Any]], b: Optional[Dict[str, Any]]) -> float:
    """0 to 1: how alike two fingerprints are."""
    if not a or not b or a.get('v') != VERSION or b.get('v') != VERSION:
        return 0.0
    try:
        shape = 1 - bin(int(a['dh'], 16) ^ int(b['dh'], 16)).count('1') / 64
        layout = 1 - sum(abs(x - y) for x, y in zip(a['g'], b['g'])) / (255 * len(a['g']))
        if a.get('h') and b.get('h'):
            palette = sum(min(x, y) for x, y in zip(a['h'], b['h'])) / max(sum(a['h']), sum(b['h']), 1)   # the bins are rounded, so divide by their own total
        elif not a.get('h') and not b.get('h'):
            palette = 1 - abs((a.get('tone') or 0) - (b.get('tone') or 0)) / 255      # both colourless: compare brightness
        else:
            palette = 0.0                                                             # one is colourful, the other is not
        return round(max(0.0, min(1.0, WEIGHTS[0] * shape + WEIGHTS[1] * layout + WEIGHTS[2] * palette)), 4)
    except (KeyError, ValueError, TypeError):
        return 0.0


def download(url: str) -> Optional[bytes]:
    """The bytes of a public photo (capped in size and time), or None."""
    if not url or not str(url).lower().startswith('https://'):
        return None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ebalik-photo-search'}), timeout=6) as response:
            data = response.read(MAX_DOWNLOAD_BYTES + 1)
        return data if len(data) <= MAX_DOWNLOAD_BYTES else None
    except Exception as error:
        logger.info('Photo download failed: %s', str(error)[:100])
        return None


def store(db, item_id: Any, features: Optional[Dict[str, Any]]) -> None:
    """Remember an item's fingerprint. Best effort: before migration 20261023 only the in-process cache keeps it."""
    if not features or not item_id:
        return
    _cache[str(item_id)] = features
    try:
        db.client.table('found_items').update({'image_features': features}).eq('item_id', str(item_id)).execute()
    except Exception as error:
        logger.info('Fingerprint not saved (run migration 20261023): %s', str(error)[:100])


def search(db, query_bytes: bytes) -> Dict[str, Any]:
    """Rank open found items that have a photo by how much they look like the query photo."""
    query = fingerprint(query_bytes)
    if not query:
        raise ValueError('We could not read that photo. Use a JPG, PNG or WEBP picture.')
    columns = 'item_id,fpost_id,item_name,category,location,found_date,image_url,status'
    try:
        rows = db.client.table('found_items').select(columns + ',image_features').eq('status', 'unclaimed').neq('image_url', '').order('created_at', desc=True).limit(500).execute().data or []
        saved_column = True
    except Exception as error:
        if 'image_features' not in str(error):
            raise
        rows = db.client.table('found_items').select(columns).eq('status', 'unclaimed').neq('image_url', '').order('created_at', desc=True).limit(500).execute().data or []
        saved_column = False
    results: List[Dict[str, Any]] = []
    backfilled = 0
    waiting = 0   # items whose photo could not be fingerprinted yet (a later search picks them up)
    for row in rows:
        features = row.get('image_features') if saved_column else None
        features = features or _cache.get(str(row['item_id']))
        if not features and backfilled < BACKFILL_PER_SEARCH:
            backfilled += 1
            data = download(row.get('image_url'))
            features = fingerprint(data) if data else None
            if features:
                store(db, row['item_id'], features)
        if not features:
            waiting += 1
        score = similarity(query, features)
        if score >= MIN_SIMILARITY:
            results.append({
                'reference': row.get('fpost_id'), 'item_name': row.get('item_name'), 'category': row.get('category'), 'location': row.get('location'),
                'found_date': row.get('found_date'), 'image_url': row.get('image_url'), 'similarity': round(score * 100),
            })
    results.sort(key=lambda item: item['similarity'], reverse=True)
    return {'results': results[:MAX_RESULTS], 'searched': len(rows) - waiting, 'waiting': waiting}
