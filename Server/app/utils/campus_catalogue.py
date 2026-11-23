import os
import json
from pathlib import Path

CATALOGUE = json.loads((Path(__file__).resolve().parents[3] / 'shared' / 'campus.json').read_text(encoding='utf-8'))


def catalogue_paths():
    for building, floors in CATALOGUE['buildings'].items():
        yield building
        for floor, rooms in floors.items():
            yield f'{building} / {floor}'
            for room in rooms:
                yield f'{building} / {floor} / {room}'


PLACES = tuple(catalogue_paths())

KNOWN_PATHS = frozenset(PLACES)


def canonical(place):
    return CATALOGUE['aliases'].get(place, place) if isinstance(place, str) else place

EVENT_LEGACY = tuple(CATALOGUE['legacy'][:7])

def configured():
    return os.getenv('CAMPUS_VENUES_ENABLED', '').lower() == 'true'


def ready(client):
    if not configured():
        return False
    try:
        return bool(client.table('migration_log').select('name').eq('name', '20261123_campus_venues').limit(1).execute().data)
    except Exception:
        return False


def parents(label):
    parts = label.split(' / ')
    return [' / '.join(parts[:i]) for i in range(1, len(parts)+1)]


def available(client, *, events=False):
    fallback = EVENT_LEGACY if events else CATALOGUE['legacy']
    if not configured():
        return list(fallback)
    try:
        active = {r['label'] for r in client.table('campus_venues').select('label').eq('active', True).execute().data}
    except Exception:
        return list(fallback)
    # Database additions are offered immediately without a frontend rebuild.
    choices = sorted(active - set(CATALOGUE['legacy']))
    return [label for label in dict.fromkeys([*fallback, *choices]) if label in active and all(p in active for p in parents(label))]


def management_ready(client):
    return ready(client)
