"""A small in-memory stand-in for the Supabase client, shared by the tests that need to run services against real rows.

Supports the query-builder calls the services use: select / insert / update / delete, eq, neq, is_, in_, lt, lte, gt, gte,
`not_.is_` / `not_.in_`, order, limit, range, count, and `rpc` handlers registered by the test. Unique indexes can be declared
(`unique={'claims': 'handover_pin_hash'}`) so a duplicate insert or update raises like Postgres does.
"""
import uuid
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional


class _Not:
    def __init__(self, table):
        self.table = table

    def is_(self, key, value):
        self.table.filters.append(lambda r: (r.get(key) is not None) if value == 'null' else r.get(key) != value)
        return self.table

    def in_(self, key, values):
        self.table.filters.append(lambda r: r.get(key) not in values)
        return self.table

    def eq(self, key, value):
        self.table.filters.append(lambda r: r.get(key) != value)
        return self.table


class MemTable:
    def __init__(self, client, name):
        self.client, self.name = client, name
        self.op, self.payload, self.filters = 'select', None, []
        self.order_key, self.max_rows, self.offset, self.want_count = None, None, 0, False
        self.single_row = False

    # builder
    def select(self, *_a, count=None, **_k):
        self.want_count = bool(count)
        self.columns = [c.strip() for c in str(_a[0]).split(',')] if _a and _a[0] != '*' else []
        return self

    def insert(self, payload):
        self.op, self.payload = 'insert', payload
        return self

    def update(self, payload):
        self.op, self.payload = 'update', payload
        return self

    def delete(self):
        self.op = 'delete'
        return self

    @property
    def not_(self):
        return _Not(self)

    def eq(self, key, value):
        self.filters.append(lambda r: r.get(key) == value)
        return self

    def neq(self, key, value):
        self.filters.append(lambda r: r.get(key) != value)
        return self

    def is_(self, key, value):
        self.filters.append(lambda r: (r.get(key) is None) if value == 'null' else r.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) < str(value))
        return self

    def lte(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) <= str(value))
        return self

    def gt(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) > str(value))
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) >= str(value))
        return self

    def order(self, key, desc=False):
        self.order_key = (key, desc)
        return self

    def limit(self, n):
        self.max_rows = n
        return self

    def single(self):
        self.single_row = True
        return self

    def range(self, start, end):
        self.offset, self.max_rows = start, end - start + 1
        return self

    # execution
    def _check_unique(self, rows, candidate, ignore=None):
        column = self.client.unique.get(self.name)
        if column and candidate.get(column) is not None:
            for r in rows:
                if r is not ignore and r.get(column) == candidate.get(column):
                    raise Exception(f'duplicate key value violates unique constraint "{column}" (23505)')

    def execute(self):
        store = self.client.store
        rows = store.setdefault(self.name, [])
        missing = self.client.missing_columns.get(self.name, ())
        if self.op == 'select':
            bad = [c for c in getattr(self, 'columns', []) if c in missing]
            if bad:
                raise Exception(f'column {self.name}.{bad[0]} does not exist (42703)')
        if self.op == 'insert':
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for row in new:
                bad = [k for k in row if k in missing]
                if bad:
                    raise Exception(f'Could not find the {bad[0]} column of {self.name} in the schema cache (PGRST204)')
                self._check_unique(rows, row)
                full = {**row}
                if self.name == 'auctions' and 'auction_id' not in full:
                    full['auction_id'] = str(uuid.uuid4())
                rows.append(full)
                out.append(dict(full))
            return SimpleNamespace(data=out, count=len(out))
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == 'update':
            bad = [k for k in (self.payload or {}) if k in missing]
            if bad:
                raise Exception(f'column "{bad[0]}" of relation "{self.name}" does not exist (42703)')
            for row in matched:
                candidate = {**row, **self.payload}
                self._check_unique(rows, candidate, ignore=row)
                row.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in matched], count=len(matched))
        if self.op == 'delete':
            for row in matched:
                rows.remove(row)
            return SimpleNamespace(data=[dict(r) for r in matched], count=len(matched))
        if self.order_key:
            key, desc = self.order_key
            matched = sorted(matched, key=lambda r: (r.get(key) is None, str(r.get(key))), reverse=desc)
        total = len(matched)
        if self.max_rows is not None:
            matched = matched[self.offset: self.offset + self.max_rows]
        if self.single_row:
            if len(matched) != 1:
                raise Exception('JSON object requested, multiple (or no) rows returned (PGRST116)')
            return SimpleNamespace(data=dict(matched[0]), count=1)
        return SimpleNamespace(data=[dict(r) for r in matched], count=total if self.want_count else None)


class MemClient:
    def __init__(self, store: Dict[str, List[Dict[str, Any]]], unique: Optional[Dict[str, str]] = None,
                 rpc_handlers: Optional[Dict[str, Callable]] = None, missing_columns: Optional[Dict[str, tuple]] = None):
        self.store, self.unique = store, unique or {}
        self.rpc_handlers = rpc_handlers or {}
        self.missing_columns = missing_columns or {}

    def table(self, name):
        return MemTable(self, name)

    def rpc(self, name, params):
        handler = self.rpc_handlers.get(name)
        data = handler(params) if handler else []
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))
