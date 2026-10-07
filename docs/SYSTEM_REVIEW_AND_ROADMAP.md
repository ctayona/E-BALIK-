# E-Balik: system review and roadmap

Written 2026-10-07, after the Smart Tag approval work and the Handover PIN, premium email, auction deadline and analytics work.
It is a review of what is built, based on what was tested during development. Anything marked "not tested" was never run against the real stack.

## Status of the launch checklist

| Item | Status |
| --- | --- |
| `JWT_SECRET_KEY` on Render | Done. `render.yaml` generates it. |
| `APP_ENCRYPTION_KEY` on Render | Done (set by hand in the Render dashboard; it is `sync: false` in `render.yaml`). Never change it after PINs and claim data exist, or the encrypted values become unreadable. |
| Keep the free service awake | Done: UptimeRobot pings the API. |
| Auction deadline timer | Done: a Render cron job calls `POST /api/cron/run` with `X-Cron-Secret`. |
| Migrations up to `20261012` | Run by the owner. |
| Missing auction SQL (see below) | Done 2026-10-07: recovered from the live database into `20261005b_auction_awaiting_admin_baseline.sql`. |
| Full end-to-end test on the real stack | Open. |
| Email deliverability (SendGrid sender, SPF/DKIM, `PUBLIC_SITE_URL`) | Open. |

## The missing auction SQL

Every database function the code calls was checked against the repo. All are defined in `Server/manual_migrations` except **`auction_finalize`**.
Related pieces of the "awaiting admin" auction lifecycle are also missing from the repo, although the live database clearly has them
(the app depends on them and works):

- the function `auction_finalize`
- columns `auctions.finalized_at`, `auctions.reauctioned_from`, `auctions.reauction_reason`
- the status `awaiting_admin` being allowed on `auctions.status` (the repo's constraint only lists scheduled, active, ended, cancelled)
- a newer version of `auction_settle_due()` that moves finished auctions to `awaiting_admin` (the repo only has the older version that closes them directly)

Why it matters: a fresh database built from this repo would have auctions that cannot be confirmed, re-auctioned or settled correctly.

**Resolved.** The export was run and `Server/manual_migrations/20261005b_auction_awaiting_admin_baseline.sql` was written from it
(columns, status constraint, live-auction unique index, `auction_settle_due`, `auction_finalize`). It is for new environments only; do not run it on the live database.
The steps below are kept as the record of how it was done.

### How to recover it (the live database is the source of truth)

1. Open the Supabase SQL Editor and run `Server/scripts/export_auction_schema.sql` (it only reads, it changes nothing).
2. Use "Download CSV" or copy the result and save it as `Server/scripts/auction_schema_export.csv` (or paste it into the chat).
3. Turn it into one idempotent migration, `Server/manual_migrations/20261005b_auction_awaiting_admin_baseline.sql`
   (`CREATE OR REPLACE FUNCTION` for each function, `ADD COLUMN IF NOT EXISTS`, the widened status constraint), and parse-check it.
4. Do not run that file on your live database. It exists so a new environment can be built from the repo. Running it is safe in principle
   (it only re-creates what already exists) but there is no reason to.
5. Place it in the run order between `20261005` and `20261006`, and update `DEPLOYMENT_GUIDE.md`.

## Before launch (highest value)

1. **Test the whole thing once on the real stack.** Almost everything was verified with fakes or stubbed APIs. Walk one real item through:
   report, match, claim, approval email with PIN, guard release; Smart Tag register and staff approve; auction win, 48 hour warning, 72 hour forfeit.
2. **Email deliverability.** The templates look right in a browser preview but were not checked in Gmail or Outlook. Verify the SendGrid sender
   domain (SPF/DKIM) so approval emails with PINs do not land in spam. Check `PUBLIC_SITE_URL` is the live address, or the logo breaks.
3. **Recover the missing auction SQL** (above).
4. **Production secrets.** Confirmed set. The code falls back to development defaults if they are ever missing, so keep them in Render.
5. **Real devices.** Test the QR scanner, the live camera and the PIN screen on actual phones and the guard's tablet.

## What to improve

- **Automated checks.** A GitHub Actions run of the backend tests, type-checks and builds on every push. There are no frontend or end-to-end tests.
- **A guard-only role.** Releasing items currently needs a full admin account. A role that can only use the PIN screen limits what a security desk account can do.
- **Rate limits survive restarts.** The PIN guess limit and report limits live in memory and reset on restart. Fine on one worker; move them to the database if you scale.
- **Bidding ban inside the database.** It is enforced in the app. Adding it to the bid function makes it tamper-proof.
- **Error monitoring** (for example Sentry) on the backend and both frontends.
- **Privacy housekeeping.** ID documents and proof photos are stored. Add a retention rule (delete after a claim closes plus N days) and a short data privacy page.
- **`database_schema.sql` is incomplete** (no auctions tables, no reaction tables). Treat `manual_migrations` as the real history, or consolidate into one baseline.

## What to add

- **Scan-to-release:** show the Handover PIN as a QR code in the claimant's account so the guard can scan instead of typing.
- **Approved but never collected claims:** a reminder at 7 days and an expiry, like the auction deadline.
- **Smart Tag expiry reminder emails** ("expires in 30 days", with a renew link).
- **More analytics:** date range filter, CSV or PDF export, a campus location hotspot view.
- **Notification preferences** and an unsubscribe link on non-essential emails.
- **Handover receipt:** email the owner a short "item released" confirmation after the guard releases it.
- **Auto-suggest auctions:** items in custody over 30 days shown to admins as "ready to auction".

## Not worth doing yet

Native mobile apps, SMS, and heavier AI matching. The PWA and current matching are enough until real usage shows a gap.

## Done since this review (2026-10-07)

Guard-only role; privacy retention rule and data privacy page; scan-to-release QR; approved-but-uncollected claim reminder (7 days) and expiry (14 days);
Smart Tag expiry reminder emails; analytics date range, CSV and printable export, campus hotspots; email preferences and unsubscribe; handover receipt;
auction "ready to list" count on the dashboard; overnight sessions now end (users 60 min idle / 12 h, staff 20 min idle / 8 h). Details in `PROJECT_CONTEXT.md`.
Still open from the list: the end-to-end test on the real stack, email deliverability, CI, error monitoring, scaling the in-memory rate limits.

## Working with the live database (Supabase connector)

Connected 2026-10-07 as a read-only connector pointed at the live project (`read_only=true`, one project). Verified: it lists tables and
runs reads, and it offers no "apply migration" tool. The write test was blocked by Claude Code's own permission check, so the lock itself was not proven by a refused write.

Rules for using it:
- You still run every migration yourself in the SQL Editor. I write them and parse-check them.
- **Keep token use low.** Look at structure first (table list, columns, functions, indexes, row counts). Read row contents only when a task truly needs
  them, only the specific columns, with a small `LIMIT`. Do not read `user_profiles`, `otp_tokens`, `admin_mfa*` or the claim ID documents unless asked.
- Never copy data from the database into the repo, audit logs or commits.
- The SQL Editor's saved snippets (even private ones) are not visible through the connector. The repo's `Server/manual_migrations` is the record;
  to check what is applied, compare the live structure with those files instead of matching snippet names.
- To cut access: remove the connector in Claude Code settings, then revoke Claude under Supabase, Account, Authorized apps.

Snippet names to repo files (best guess): AUCTION HALL = `20261005`; AUCTION HALL 2 = `20261005b` (confirm it contains `auction_finalize`);
SYSTEM CONTROL = `20261006`; SMART TAGS = `20261008`; TAG_EXPIRY_AND_BUYOUT = `20261009`; TAG_PHOTO_AND_SYSTEM_CONTROL = `20261010`;
TAG_STAFF_VERIFY = `20261011`; HANDOUTS = `20261012`.

