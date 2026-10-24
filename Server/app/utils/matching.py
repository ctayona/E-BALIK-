"""Matching a lost report with a found item.

Each pair is scored from up to five REAL measurements, each 0 to 100, with the reasons in plain words:
  * category   same category (exact), or a neutral "Other";
  * text       the item name, description and distinctive marks, compared word by word after normalising (plurals, English and
               Filipino synonyms, typos) with the name and the distinctive marks counting for more than the description. Shared
               colours, brands and model numbers raise it; colours or brands that disagree lower it;
  * image      the visual fingerprint of the two photos (`image_match`), only when both items have a photo;
  * location   the same place, one inside the other, or words in common;
  * date       the day it was last seen against the day it was found. A found date BEFORE the last-seen date is impossible and scores 0.
Only components with data on both sides count, and the weights are re-scaled over those, so a report without a photo is not punished.
With fewer than two usable components the score is capped, because that is too little evidence to call a match.
`match_percentage` keeps the old one-number interface that the alerts, the report lifecycle and the admin list rely on.
"""
import difflib
import re
import unicodedata
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

WEIGHTS_WITH_IMAGE = {'category': 15, 'text': 30, 'image': 25, 'location': 15, 'date': 15}
WEIGHTS_WITHOUT_IMAGE = {'category': 20, 'text': 40, 'location': 20, 'date': 20}
LABELS = {'category': 'Category', 'text': 'Name and description', 'image': 'Photo similarity', 'location': 'Location', 'date': 'Date'}
THIN_EVIDENCE_CAP = 60.0
HARD_CONFLICTS = ('Different brands', 'Colours differ', 'Different categories')
HARD_PENALTY = 12.0
IMPOSSIBLE_DATE_CAP = 45.0

STOP = frozenset('''the and for with from that this was were has have had its our your his her their one two not but are you any all can
 lost found item items thing things small big old new very some near inside outside around about please kindly po ang ng sa na may ko mo ito
 yung isang mga ay at ni si kay namin natin nila ako ikaw siya'''.split())

# variant -> canonical word. Phrases are replaced first (see PHRASES), then each word is looked up here.
SYNONYMS: Dict[str, str] = {
    'cellphone': 'phone', 'cellular': 'phone', 'mobile': 'phone', 'smartphone': 'phone', 'iphone': 'iphone', 'telepono': 'phone', 'cp': 'phone',
    'backpack': 'bag', 'knapsack': 'bag', 'rucksack': 'bag', 'handbag': 'bag', 'sling': 'bag', 'tote': 'bag', 'sack': 'bag', 'bag': 'bag', 'bagpack': 'bag',
    'wallet': 'wallet', 'purse': 'wallet', 'pitaka': 'wallet', 'billfold': 'wallet',
    'umbrella': 'umbrella', 'payong': 'umbrella',
    'key': 'key', 'keys': 'key', 'susi': 'key', 'keychain': 'key', 'keyring': 'key', 'lanyard': 'lanyard',
    'earphone': 'earphone', 'earbud': 'earphone', 'headphone': 'earphone', 'headset': 'earphone', 'airpod': 'earphone', 'airpods': 'earphone', 'earpiece': 'earphone',
    'eyeglass': 'glasses', 'eyeglasses': 'glasses', 'glasses': 'glasses', 'spectacle': 'glasses', 'spectacles': 'glasses', 'salamin': 'glasses', 'shades': 'glasses', 'sunglass': 'glasses', 'sunglasses': 'glasses',
    'laptop': 'laptop', 'notebook': 'notebook', 'macbook': 'laptop', 'chromebook': 'laptop',
    'tumbler': 'bottle', 'bottle': 'bottle', 'flask': 'bottle', 'thermos': 'bottle', 'hydroflask': 'bottle', 'botelya': 'bottle',
    'charger': 'charger', 'adapter': 'charger', 'adaptor': 'charger', 'cable': 'charger', 'powerbank': 'powerbank',
    'id': 'card', 'card': 'card', 'identification': 'card', 'atm': 'card', 'license': 'card', 'licence': 'card',
    'calculator': 'calculator', 'watch': 'watch', 'relo': 'watch', 'orasan': 'watch',
    'jacket': 'jacket', 'hoodie': 'jacket', 'sweater': 'jacket', 'jaket': 'jacket', 'cardigan': 'jacket',
    'shoe': 'shoes', 'shoes': 'shoes', 'sapatos': 'shoes', 'sneaker': 'shoes', 'sneakers': 'shoes', 'slipper': 'shoes', 'sandal': 'shoes',
    'book': 'book', 'libro': 'book', 'textbook': 'book', 'folder': 'folder', 'envelope': 'folder',
    'pen': 'pen', 'ballpen': 'pen', 'pencil': 'pen', 'bolpen': 'pen', 'tablet': 'tablet', 'ipad': 'tablet', 'mouse': 'mouse', 'keyboard': 'keyboard',
    'flashdrive': 'flashdrive', 'usb': 'flashdrive', 'thumbdrive': 'flashdrive', 'camera': 'camera', 'ring': 'jewelry', 'necklace': 'jewelry', 'bracelet': 'jewelry', 'earring': 'jewelry',
}
PHRASES = {'cell phone': 'cellphone', 'smart phone': 'smartphone', 'water bottle': 'bottle', 'coin purse': 'wallet', 'ear phones': 'earphone', 'head phones': 'earphone',
           'power bank': 'powerbank', 'flash drive': 'flashdrive', 'thumb drive': 'flashdrive', 'key chain': 'keychain', 'id card': 'card', 'student id': 'card',
           'hand bag': 'handbag', 'back pack': 'backpack', 'eye glasses': 'glasses', 'sun glasses': 'glasses'}

# colour word -> canonical colour, and which canonical colours do not contradict each other
COLORS: Dict[str, str] = {
    'black': 'black', 'itim': 'black', 'white': 'white', 'puti': 'white', 'red': 'red', 'pula': 'red', 'maroon': 'red', 'blue': 'blue', 'asul': 'blue', 'navy': 'blue', 'sky': 'blue',
    'green': 'green', 'berde': 'green', 'yellow': 'yellow', 'dilaw': 'yellow', 'brown': 'brown', 'kayumanggi': 'brown', 'tan': 'brown', 'beige': 'brown',
    'gray': 'gray', 'grey': 'gray', 'abo': 'gray', 'silver': 'gray', 'pink': 'pink', 'rosas': 'pink', 'purple': 'purple', 'violet': 'purple', 'lila': 'purple',
    'orange': 'orange', 'gold': 'yellow', 'golden': 'yellow', 'transparent': 'clear', 'clear': 'clear',
}
COMPATIBLE = {frozenset(p) for p in (('black', 'gray'), ('white', 'gray'), ('white', 'clear'), ('brown', 'orange'), ('red', 'pink'), ('blue', 'purple'), ('yellow', 'orange'))}
BRANDS = frozenset('''apple iphone samsung huawei oppo vivo realme xiaomi redmi nokia infinix tecno asus acer lenovo hp dell msi sony jbl casio jansport adidas nike puma
 herschel eastpak anker logitech canon nikon fujifilm lg philips sandisk kingston seagate toshiba hydroflask stanley nalgene crocs converse vans fila hello kitty miniso
 oakley rayban fossil timex g-shock gshock lacoste samsonite'''.split())

CATEGORY_NEUTRAL = {'other', 'others', 'misc', 'miscellaneous'}


def _ascii(value: Any) -> str:
    return unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii').lower()


@lru_cache(maxsize=8192)
def _words(text: str) -> Tuple[str, ...]:
    """Normalised, canonical words of a text (stop words dropped, plurals folded, synonyms mapped)."""
    plain = ' ' + re.sub(r'[^a-z0-9]+', ' ', _ascii(text)) + ' '
    for phrase, repl in PHRASES.items():
        plain = plain.replace(f' {phrase} ', f' {repl} ')
    words = []
    for word in plain.split():
        if len(word) < 2 or word in STOP:
            continue
        if word in COLORS:
            words.append(COLORS[word])
            continue
        if len(word) > 3 and word.endswith('s') and not word.endswith('ss') and word not in SYNONYMS:
            word = word[:-1]
        words.append(SYNONYMS.get(word, word))
    return tuple(words)


@lru_cache(maxsize=200000)
def _similar(a: str, b: str) -> float:
    """1.0 for the same word, 0.8 for a close typo (long words only), else 0."""
    if a == b:
        return 1.0
    if len(a) < 5 or len(b) < 5 or abs(len(a) - len(b)) > 2 or a[0] != b[0]:
        return 0.0
    return 0.8 if difflib.SequenceMatcher(None, a, b).ratio() >= 0.86 else 0.0


def _weighted(name: Any, marks: Any, description: Any) -> Dict[str, float]:
    """word -> importance: the name counts most, the distinctive marks next, the description least."""
    weights: Dict[str, float] = {}
    for text, weight in ((name, 3.0), (marks, 2.5), (description, 1.0)):
        for word in _words(str(text or '')):
            weights[word] = max(weights.get(word, 0.0), weight)
    return weights


def _dice(a: Dict[str, float], b: Dict[str, float]) -> float:
    """Weighted overlap in both directions: 1.0 when every important word on each side has a partner on the other."""
    if not a or not b:
        return 0.0
    matched_a = sum(weight * max((_similar(word, other) for other in b), default=0.0) for word, weight in a.items())
    matched_b = sum(weight * max((_similar(word, other) for other in a), default=0.0) for word, weight in b.items())
    return (matched_a + matched_b) / (sum(a.values()) + sum(b.values()))


def _colors(words: Dict[str, float]) -> set:
    return {w for w in words if w in set(COLORS.values())}


def _model_numbers(words: Dict[str, float]) -> set:
    return {w for w in words if len(w) >= 3 and any(c.isdigit() for c in w) and any(c.isalpha() for c in w)}


def _text(missing: Dict[str, Any], found: Dict[str, Any]) -> Tuple[Optional[float], List[str], List[str]]:
    a = _weighted(missing.get('item_name'), missing.get('distinctive_marks'), missing.get('description'))
    b = _weighted(found.get('item_name'), found.get('distinctive_marks'), found.get('description'))
    if not a or not b:
        return None, [], []
    score = _dice(a, b)
    reasons: List[str] = []
    conflicts: List[str] = []
    shared_brands = (set(a) & set(b)) & BRANDS
    brands_a, brands_b = set(a) & BRANDS, set(b) & BRANDS
    if shared_brands:
        score += 0.20
        reasons.append(f"Same brand: {', '.join(sorted(shared_brands))}")
    elif brands_a and brands_b:
        score -= 0.30
        conflicts.append(f"Different brands: {', '.join(sorted(brands_a))} vs {', '.join(sorted(brands_b))}")
    models = _model_numbers(a) & _model_numbers(b)
    if models:
        score += 0.15
        reasons.append(f"Same model or number: {', '.join(sorted(models))}")
    colors_a, colors_b = _colors(a), _colors(b)
    if colors_a & colors_b:
        score += 0.10
        reasons.append(f"Same colour: {', '.join(sorted(colors_a & colors_b))}")
    elif colors_a and colors_b and not any(frozenset((x, y)) in COMPATIBLE for x in colors_a for y in colors_b):
        score -= 0.25
        conflicts.append(f"Colours differ: {', '.join(sorted(colors_a))} vs {', '.join(sorted(colors_b))}")
    shared = sorted(w for w in set(a) & set(b) if w not in BRANDS and w not in set(COLORS.values()) and w not in models)
    if shared:
        reasons.append(f"Words in common: {', '.join(shared[:6])}")
    return max(0.0, min(1.0, score)), reasons, conflicts


def _category(missing: Dict[str, Any], found: Dict[str, Any]) -> Tuple[Optional[float], List[str], List[str]]:
    a, b = _ascii(missing.get('category')).strip(), _ascii(found.get('category')).strip()
    if not a or not b:
        return None, [], []
    if a == b:
        return (0.35, [], []) if a in CATEGORY_NEUTRAL else (1.0, [f"Same category: {missing.get('category')}"], [])
    if a in CATEGORY_NEUTRAL or b in CATEGORY_NEUTRAL:
        return 0.35, [], []
    return 0.0, [], [f"Different categories: {missing.get('category')} vs {found.get('category')}"]


def _location(missing: Dict[str, Any], found: Dict[str, Any]) -> Tuple[Optional[float], List[str], List[str]]:
    a, b = ' '.join(_words(missing.get('last_location'))), ' '.join(_words(found.get('location')))
    if not a or not b:
        return None, [], []
    if a == b:
        return 1.0, ['Same place'], []
    if a in b or b in a:
        return 0.75, ['One place is inside the other'], []
    wa, wb = set(a.split()), set(b.split())
    close = sum(1 for word in wa if any(_similar(word, other) for other in wb))
    if close:
        return min(0.6, 0.25 + 0.35 * close / max(1, min(len(wa), len(wb)))), ['Places share words'], []
    return 0.0, [], []


def _date(missing: Dict[str, Any], found: Dict[str, Any]) -> Tuple[Optional[float], List[str], List[str]]:
    lost, seen = missing.get('last_seen_date'), found.get('found_date')
    if not lost or not seen:
        return None, [], []
    try:
        gap = (datetime.strptime(str(seen)[:10], '%Y-%m-%d') - datetime.strptime(str(lost)[:10], '%Y-%m-%d')).days
    except ValueError:
        return None, [], []
    if gap < -1:
        return 0.0, [], ['Found before it was last seen, which is not possible']
    gap = max(0, gap)
    if gap == 0:
        return 1.0, ['Found the same day it was lost'], []
    score = 0.8 if gap <= 2 else 0.5 if gap <= 7 else 0.2 if gap <= 14 else 0.0
    return score, [f'Found {gap} day(s) after it was last seen'] if score else [], [] if score else [f'Found {gap} days after it was last seen']


def _image(missing: Dict[str, Any], found: Dict[str, Any]) -> Tuple[Optional[float], List[str], List[str]]:
    a, b = missing.get('image_features'), found.get('image_features')
    if not a or not b:
        return None, [], []
    from app.utils import image_match
    sim = image_match.similarity(a, b)
    if not sim:
        return None, [], []
    score = max(0.0, min(1.0, (sim - 0.35) / 0.5))
    note = f'Photos look {"very similar" if score >= 0.8 else "somewhat alike" if score >= 0.45 else "different"} ({round(sim * 100)}% alike)'
    return score, [note] if score >= 0.45 else [], [] if score >= 0.45 else [note]


def match_details(missing_item: Dict[str, Any], found_item: Dict[str, Any]) -> Dict[str, Any]:
    """The score with every component, the reasons and the conflicts. `components[key]` is None when there was no data to compare."""
    parts = {'category': _category, 'text': _text, 'image': _image, 'location': _location, 'date': _date}
    results = {key: fn(missing_item, found_item) for key, fn in parts.items()}
    use_image = results['image'][0] is not None
    weights = WEIGHTS_WITH_IMAGE if use_image else WEIGHTS_WITHOUT_IMAGE
    available = {key: results[key][0] for key in weights if results[key][0] is not None}
    total = sum(weights[key] for key in available)
    score = sum(weights[key] * value for key, value in available.items()) / total * 100 if total else 0.0
    if len(available) < 2:
        score = min(score, THIN_EVIDENCE_CAP)
    conflicts_all = [c for key in ('category', 'text', 'image', 'location', 'date') for c in results[key][2]]
    hard = sum(1 for c in conflicts_all if c.startswith(HARD_CONFLICTS))
    score -= min(30.0, HARD_PENALTY * hard)                                  # a contradiction counts against the pair beyond its own component
    score -= 8.0 if any(c.startswith('Photos look different') for c in conflicts_all) else 0.0
    if any(c.startswith('Found before it was last seen') for c in conflicts_all):
        score = min(score, IMPOSSIBLE_DATE_CAP)                              # it cannot have been found before it was lost
    score = max(0.0, score)
    reasons = [r for key in ('category', 'text', 'image', 'location', 'date') for r in results[key][1]]
    conflicts = [c for key in ('category', 'text', 'image', 'location', 'date') for c in results[key][2]]
    return {
        'score': round(min(100.0, score), 1),
        'components': {key: (None if results[key][0] is None else {'percent': round(results[key][0] * 100), 'weight': weights.get(key, 0)}) for key in parts},
        'reasons': reasons, 'conflicts': conflicts, 'used_image': use_image,
    }


def match_percentage(missing_item: Dict[str, Any], found_item: Dict[str, Any]) -> float:
    return match_details(missing_item, found_item)['score']


def _cheap_score(missing: Dict[str, Any], found: Dict[str, Any]) -> float:
    """A fast pre-ranking (category, date, exact words) used to pick which pairs deserve the full comparison."""
    score = 0.0
    c = _category(missing, found)[0]
    score += 30 * (c or 0)
    d = _date(missing, found)[0]
    score += 20 * (d if d is not None else 0.3)
    a = set(_weighted(missing.get('item_name'), missing.get('distinctive_marks'), missing.get('description')))
    b = set(_weighted(found.get('item_name'), found.get('distinctive_marks'), found.get('description')))
    if a and b:
        score += 50 * len(a & b) / len(a | b)
    return score


def best_candidates(missing_item: Dict[str, Any], found_items: List[Dict[str, Any]], top: int = 3, pool: int = 8) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """The `top` best found items for one lost report as (found item, details), without comparing every pair in full."""
    ranked = sorted(found_items, key=lambda found: _cheap_score(missing_item, found), reverse=True)[:pool]
    scored = [(found, match_details(missing_item, found)) for found in ranked]
    scored.sort(key=lambda pair: pair[1]['score'], reverse=True)
    return scored[:top]


def build_match_summaries(missing_items, found_items):
    summaries = {}
    for item in missing_items:
        scores = [match_percentage(item, found) for found in found_items]
        summaries[item.get('mpost_id')] = {
            'matched_above_55': sum(score >= 55 for score in scores),
            'matched_below_54': sum(score < 55 for score in scores),
            'total_matches': len(scores),
        }
    return summaries


def build_found_match_summaries(found_items, missing_items):
    summaries = {}
    for item in found_items:
        scores = [match_percentage(missing, item) for missing in missing_items]
        summaries[item.get('fpost_id')] = {
            'matched_above_55': sum(score >= 55 for score in scores),
            'matched_below_54': sum(score < 55 for score in scores),
            'total_matches': len(scores),
        }
    return summaries
