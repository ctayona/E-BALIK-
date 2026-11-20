# Event Rentals — Phase 0 Baseline

Date: 2026-11-15 (Asia/Singapore)
Scope: Pre-implementation baseline and initial integration inventory.
Status: Baseline checks captured; Phase 0 remains in progress. No event application code or migration has been created.

## 1. Checkout and preservation

- Local HEAD: 39dbd71e4c3c3c1751d684cb1dcea7c19998a0fc, main.
- Pre-existing modified file: CLAUDE.md.
- Pre-existing untracked files include .claude/settings.local.json, AGENTS.md, codex.md, daily audits, docs/PROMPT_BUILDTRACK_ADMIN_FEATURES.md, and docs/EVENT_RENTALS_ROADMAP.md.
- No reset, checkout replacement, dependency installation, commit, push, or deployment performed. Feature implementation should use an isolated branch before source edits.

## 2. Current checks

| Check | Result | Notes |
|---|---|---|
| npm run build | PASS | User Vite 6.3.5 build |
| npm run build:admin | PASS | Installed admin Vite 8.2.2; existing config-loader warnings about __dirname and JSON import attributes |
| npm run typecheck:admin | PASS | No TypeScript errors reported |
| npm run typecheck:user | PASS within existing allowance | 108 errors, matching the checked-in baseline of 108; not a clean type check |
| node scripts/check-text-guard-parity.mjs | PASS | Browser/server text rules agree |
| Backend unittest discovery | PASS | 1,039 tests in 25.451 seconds; guarded offline runner below |

These are local automated results, not browser acceptance results or proof of production health. A future event release must add meaningful event tests and repeat the applicable integration/release checks.

## 3. Environment caveats and reproducibility

- Shell Node version: 24.14.0; npm: 11.9.0. Root package.json and CI target Node 22. Builds pass locally, but repeat release verification under the declared Node 22 toolchain/CI. Do not silently change project engines to match this machine.
- Existing Server/venv launcher could not execute correctly in the restricted shell. Its pyvenv.cfg records Python 3.13.14; the accessible launcher selects Python 3.13.3.
- No virtual environment was rebuilt. Backend tests ran through py -3.13 outside the interpreter sandbox restriction, with existing Server/venv/Lib/site-packages supplied through process-local PYTHONPATH.
- EBALIK_TESTING=1 and PYTHONDONTWRITEBYTECODE=1 were set. Supabase URL/key values were replaced with dummy values for the test process. AUCTION_EMAIL_MODE=mock was set.
- A Python audit hook blocked socket.connect for the entire test process; tests used fixtures/mocks. No live database, storage, or email write was permitted. Backup test output refers to synthetic fixtures and a temporary test archive, not a production backup.
- Full local backend output: %TEMP%/ebalik-phase0-backend-20261115.log. Temporary logs are not committed and may expire.

Equivalent guarded backend invocation, from Server, after reviewing isolation and resolving interpreter access:

```powershell
$env:EBALIK_TESTING = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = Join-Path (Get-Location) 'venv/Lib/site-packages'
$env:SUPABASE_URL = 'https://example.invalid'
$env:SUPABASE_KEY = 'offline-baseline-only'
$env:SUPABASE_SERVICE_KEY = 'offline-baseline-only'
$env:AUCTION_EMAIL_MODE = 'mock'
py -3.13 -c "import sys,unittest; sys.addaudithook(lambda event,args: (_ for _ in ()).throw(RuntimeError('Network blocked during offline baseline')) if event == 'socket.connect' else None); suite=unittest.defaultTestLoader.discover('tests', pattern='test_*.py'); result=unittest.TextTestRunner(verbosity=1).run(suite); sys.exit(not result.wasSuccessful())"
```

The PYTHONPATH workaround is test-process-only. Prefer repairing/recreating the development environment in a separately scoped task rather than making application imports depend on it.

## 4. Read-only live metadata findings

- public.found_items has no event_id column in the inspected live metadata; RLS is enabled. This inspection did not audit every policy or every table.
- Both found-item-images and missing-item-images buckets are public. Event-private photos must not be uploaded into those buckets under the assumption that a hidden event page protects them.
- 20261026_income_ledger_lock remains recorded as applied. trg_income_ledger_guard and trg_income_ledger_no_truncate are installed and enabled.
- No real attendee/report rows were read. No migrations, DDL, DML, storage changes, or remote settings changes performed.

Before migration design, inspect relevant remaining tables, policies, grants, triggers, and current RPC definitions one task-relevant object at a time. SQL files describe intended history; live definitions can drift.

## 5. Initial integration inventory

This identifies implementation owners requiring detailed scope review. It is not an exhaustive call-site audit or a claim that any boundary has already been fixed.

| Area | Starting implementation | Event work required before enablement |
|---|---|---|
| App entry/hosting | Users/Frontend/src/app/App.tsx; Admin/Frontend/src/App.tsx; vercel.json | Add event entry/navigation without changing existing tag/admin/share behavior |
| Styling | Users/Frontend/src/styles/theme.css | Scoped theme variables and component variants; preserve campus theme |
| Staff authorization | Admin/Backend/shared/admin_access.py; Server/app/utils/access_control.py | Add event membership/actions without granting global admin/guard roles |
| Data access | Server/app/utils/supabase_db.py; Users/Backend page routes; Admin/Backend page routes | Inventory list/detail/write/bulk paths and enforce scope everywhere |
| Public board/search | Users/Backend/home/routes.py; browse_items/routes.py; matches/routes.py | Exclude event-only records and expose only approved safe publications |
| Matching/alerts | Server/app/utils/match_alerts.py; matching.py | Event-limited comparisons and notification destinations |
| Claims/custody | Users/Backend/claim/routes.py; Server/app/utils/report_lifecycle.py; custody_log.py; handover.py | Derive scope from reports; enforce staff/claimant permissions and cross-link consistency |
| Database functions | manual_migrations claim, closeout, access, and auction function history | Inspect current live definitions; protect privileged RPC and trigger paths |
| Tags | Server/app/utils/smart_tags.py | Batch association, registration/scan rules, event-aware auto-posting and recovery |
| Auctions | Server/app/utils/auction_db.py; auction SQL functions | Exclude event custody from campus eligibility and settlement paths |
| Jobs/cleanup | Server/app/utils/scheduler.py; housekeeping.py; mission_control.py | Scope reminders, expiry, retention, orphan scans and cleanup |
| Media/deletion | supabase_db.py image helpers; route upload helpers; Storage policies | Private event media and correct lifecycle/deletion handling |
| Exports/analytics | Server/app/utils/analytics.py; monthly_report.py; mission_control.py | Separate campus/event metrics and authorize exports |
| Receipts/payments | Server/app/utils/receipts.py; payments.py; income.py | Event ownership checks; explicit future event_rental source and compatibility |
| Backups/restores/bin | Server/scripts/backup_database.py; restore_database.py; app/utils/backup_restore.py; recycle_bin.py | Extend table ordering, references, retention and authorized restoration |

## 6. Proposed first implementation slice

After Phase 0/1 gates are satisfied:

1. Add an isolated Events foundation: event identity/configuration, event-specific membership/actions, and validated branding settings.
2. Prepare additive migration files, preflight/verification SELECTs, and recovery instructions locally for the user to apply manually.
3. Implement feature-disabled behavior and missing-event-schema handling that leaves campus operations working.
4. Add isolated permission/lifecycle tests before connecting event reports to existing workflows.
5. Deliver admin event setup/appearance preview only after the foundation passes its gates. Keep event report creation disabled until shared campus paths are protected.

There is no migration for the user to run at this baseline stage.

## 7. Remaining Phase 0 and Phase 1 gates

- Complete the dependency inventory to exact query/RPC/storage/job call sites, not just modules.
- Inspect remaining relevant live schema/security metadata read-only.
- Resolve or record toolchain compatibility through Node 22 CI and a supported backend environment.
- Isolate implementation work on a feature branch before source edits; preserve all user changes.
- Write event permission/state/publication/closure rules and confirm the architecture against the dependency inventory.
- Pilot selection and responsible event operator remain unspecified. They are needed before live enablement; they do not prevent local design/test work.
- No event writes or production enablement until the roadmap's schema and scope gates pass.
