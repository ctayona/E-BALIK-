"""Read every row of a table in pages.

Supabase silently returns at most 1000 rows per request, so a plain `.execute()` hides everything past the 1000th record from an admin
list without any error. `fetch_all` asks for page after page until the table is exhausted or a safety cap is reached.
"""
import logging
import os
from typing import Any, Callable, Dict, List

logger = logging.getLogger(__name__)

PAGE = 1000


def list_cap() -> int:
    try:
        return max(PAGE, min(int(os.getenv('ADMIN_LIST_MAX') or 10000), 100000))
    except ValueError:
        return 10000


def fetch_all(build: Callable[[], Any], cap: int = 0) -> List[Dict[str, Any]]:
    """`build()` returns a fresh query (select, filters and order already applied); it is paged here with `.range()`."""
    limit = cap or list_cap()
    rows: List[Dict[str, Any]] = []
    offset = 0
    while offset < limit:
        batch = build().range(offset, min(offset + PAGE, limit) - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE
    logger.warning('A list reached its safety cap of %d rows, so older rows were left out. Raise ADMIN_LIST_MAX if that is expected.', limit)
    return rows
