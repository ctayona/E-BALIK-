# E-Balik Project Context

> Repository handoff for coding AI assistants and development partners.
> Last updated: 2026-08-22

## Project Purpose

E-Balik is the University of Makati lost-and-found system. Authenticated users can register, verify their account with OTP, report found or missing items, upload images, search reports, review possible matches, manage their own reports, browse public listings, and submit claims.

The project uses the existing Supabase database and storage backend. Do not replace the backend or introduce mock data for report workflows.

## Technology

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Python, Flask
- Database: Supabase/PostgreSQL
- Storage: Supabase Storage
- Authentication: JWT, bcrypt, OTP, optional Google login
- Icons: lucide-react
- Frontend state: React state/hooks; navigation currently uses page state in `Users/Frontend/src/app/App.tsx`

## Run Commands

```powershell
npm install
npm run dev
npm run dev:frontend
npm run dev:backend
npm run build
python -m compileall -q Server Users/Backend Admin/Backend
```

`npm run dev` starts both frontend and backend. The frontend normally runs on Vite and the backend on `http://localhost:5000`.

## Repository Layout

Each section (Users, Admin) has a Frontend and a Backend, and both sides use one folder per page. Frontend folders use the page id (kebab-case); the matching backend folder uses the same name in snake_case.

```text
Users/
  Frontend/                    User web app (Vite root; built via root package.json)
    src/app/pages/<page>/      home, dashboard, report-item, found-item, missing-item, my-reports,
                               matches, browse-items, claim, auction-hall, notifications, profile
    src/app/shared/            Cross-page components (UserHeader, LoadingSkeleton, ui/, figma/)
    src/app/utils/             api.ts, useAuth.ts, clay.ts
  Backend/<page>/routes.py     home, profile, found_item, missing_item, my_reports, matches,
                               browse_items, claim, notifications
  Backend/shared/              account.py (Home + Profile), request_auth.py (report pages)
Admin/
  Frontend/                    Admin web app (own package.json and node_modules)
    src/pages/<page>/          dashboard, lost-items, found-items, ai-matching, claims-verification,
                               chain-of-custody, users, reports-analytics, notifications,
                               activity-logs, admin-profile
    src/components/            Cross-page admin components
  Backend/<page>/routes.py     dashboard, lost_items, found_items, ai_matching, claims_verification,
                               users, reports_analytics, activity_logs, admin_profile
  Backend/shared/              admin_access.py (_require_admin, _log_admin_action)
Server/                        Flask entry point and services shared by both sections
  run.py, config.py, venv/, requirements.txt
  app/__init__.py              App factory (adds the repo root to sys.path for Users/Admin imports)
  app/blueprints.py            Mounts every page blueprint (Users at /api, Admin at /api/admin)
  app/utils/                   Supabase DB, JWT/password, email, crypto, matching, claim status, admin MFA
  database_schema.sql, manual_migrations/, tests/, scripts/
Environment_Configs/           All env files (git-ignored), loaded by explicit path
  backend/.env                 Flask/Supabase/SendGrid/JWT secrets  (Server/config.py, Server/scripts, setup_database.py)
  frontend/.env.local          VITE_* values for both Vite apps      (envDir in Users/ and Admin/ vite.config.ts)
  frontend/.env.local.example  Template
Audits/                        Daily audit logs (YYYY-MM-DD_Audit.md): prompt, edit, and database audits per interaction
Design/                        Design skill packs for AI tools (not loaded by the app)
docs/                          Guides, checklists, notes, archived exports
```

### Endpoint ownership

Each endpoint lives in the backend folder of the page that uses it. Where several pages call it, it lives with the page that owns the workflow.

| Endpoint | Backend page | Frontend callers |
|---|---|---|
| `/api/auth/{register,verify-otp,login,google-login,admin-mfa/verify,forgot-password,reset-password,verify-token}` | `home` | Landing/Login/Register/ForgotPassword, App session |
| `GET /api/found-items/public` | `home` | (older landing list; unused now) |
| `GET /api/public/board` | `home` | Landing (newest missing reports, found items and totals; safe fields only, no login) |
| `/api/auth/profile`, `/api/auth/profile/document-upload` | `profile` | Profile |
| `POST/GET /api/found-items`, `GET /api/found-items/matches` | `found_item` | Found Item (list also My Reports) |
| `POST/GET /api/missing-items`, `GET /api/missing-items/matches` | `missing_item` | Missing Item (list also Dashboard, Matches, My Reports) |
| `PUT/DELETE /api/found-items/<id>`, `PUT/DELETE /api/missing-items/<id>` | `my_reports` | My Reports |
| `GET /api/found-items/search` | `matches` | Matches, Dashboard, Browse Items, Missing Item |
| `GET /api/missing-items/public` | `browse_items` | Browse Items |
| `/api/claims` | `claim` | Claim |
| `/api/notifications` | `notifications` | Notifications, UserHeader badge |
| `/api/auctions/*` | `auctions` | Auction Hall, dashboard Live auctions shelf, Landing showcase |
| `/api/admin/*` | Admin `Backend/<page>` matching the admin page | Chain of Custody reads found-items + claims; admin Notifications reads activity-logs + claims |

Page-specific helpers live beside their page (for example `Users/Frontend/src/app/pages/home/OTPModal.tsx`, `Admin/Frontend/src/pages/users/AccountVerificationTab.tsx`). Anything used by more than one page belongs in that side's `shared/` (or `components/` in the admin frontend).

## Important Files

### Frontend

- `Users/Frontend/src/app/App.tsx`: central page-state navigation and page rendering
- `Users/Frontend/src/app/types.ts`: `Page` and `NavigationOptions` types
- `Users/Frontend/src/app/utils/api.ts`: HTTP client and API definitions
- `Users/Frontend/src/app/utils/useAuth.ts`: authentication state and report API hooks
- `Users/Frontend/src/app/shared/UserHeader.tsx`: desktop/mobile navigation
- `Users/Frontend/src/app/pages/dashboard/Dashboard.tsx`: dashboard, live report panels, carousels, report modal
- `Users/Frontend/src/app/pages/report-item/ReportItem.tsx`: unified choice between found and missing report forms
- `Users/Frontend/src/app/pages/found-item/FoundItem.tsx`: found-item creation and report search/history UI
- `Users/Frontend/src/app/pages/missing-item/MissingItem.tsx`: missing-item creation, search, and report history UI
- `Users/Frontend/src/app/pages/my-reports/MyReports.tsx`: authenticated user's found/missing reports, detail modal, edit/delete
- `Users/Frontend/src/app/pages/matches/Matches.tsx`: missing-to-found matching workspace
- `Users/Frontend/src/app/pages/browse-items/BrowseItems.tsx`: public missing and custody listings
- `Users/Frontend/src/app/pages/claim/Claim.tsx`: claim form UI; backend integration is incomplete
- `Users/Frontend/src/app/pages/profile/Profile.tsx`: profile and verification document features
- `Users/Frontend/src/styles/theme.css`: theme and shared modal styling

### Backend

- `Server/run.py`: Flask entry point
- `Server/app/blueprints.py`: page blueprint registration
- `Server/app/__init__.py`: Flask application setup
- `Users/Backend/home/routes.py`: registration, login, OTP, password reset, session endpoints (profile endpoints: `Users/Backend/profile/routes.py`)
- `Users/Backend/found_item/routes.py`: found-item creation, own listing, match summaries
- `Users/Backend/missing_item/routes.py`: missing-item creation, own listing, match summaries
- `Server/app/utils/supabase_db.py`: Supabase database operations
- `Server/app/utils/matching.py`: shared match scoring and summary functions
- `Server/database_schema.sql`: current canonical database schema

## Current Navigation

The `Page` union currently includes:

```text
home
dashboard
report-item
found-item
missing-item
my-reports
matches
browse-items
claim
profile
```

Navigation is not React Router yet. `App.tsx` passes `NavigationOptions` when a page needs context:

```ts
{
  searchTerm?: string;
  mode?: "form";
  reportId?: string;
}
```

`mode: "form"` opens Found Item or Missing Item as a focused form without duplicate inner tabs. Those forms have a back button to Report Item. `reportId` preselects a missing report in Matches.

## User Experience Structure

### Dashboard

- Navy/gold branded welcome/search area.
- Loads real unclaimed found reports and the current user's missing reports.
- Shows separate Recent Found Items and Recent Missing Items panels.
- Each panel has a five-item list and a one-card carousel that rotates every two seconds.
- Clicking a report opens an in-place details modal rather than navigating to the old Missing Item page.
- Modal links to Browse Items and Matches.
- Browse and Report Item actions are available below the panels.

### Report Item

A single entry point with two choices:

- I found an item -> Found Item form
- I lost an item -> Missing Item form

Do not duplicate the report forms inside this page.

### My Reports

Contains only reports owned by the authenticated account:

- All reports
- Missing items
- Found items

Cards show report ID, image, item name, category, location, date, and status. Clicking a card opens a modal with details. Users can edit or delete only their own reports.

Edit and delete must use the five-second countdown plus confirmation checkbox before executing.

### Matches

Current primary workflow is the user's missing report compared against unclaimed found reports.

Current features:

- Select missing report.
- Automatically load matches.
- Carry a `reportId` from other pages.
- Filter all, strong matches (75%+), or possible matches (55%+).
- Open match detail modal.

Reverse matching from a user's found report to possible missing owners is a future enhancement.

### Browse Items

Two tabs:

- Missing Items
- Items in Custody

Features:

- Search text.
- Category filter.
- Tile mode with 9 items per page.
- List mode with 10 items and scrolling.
- Pagination.
- Detail modal.
- Public-safe information only.

Do not expose reporter email, campus ID, private distinctive marks, or sensitive claim information in public listings.

## Backend Endpoints

### Auth

```text
POST /api/auth/register
POST /api/auth/verify-otp
POST /api/auth/login
POST /api/auth/google-login
POST /api/auth/forgot-password
POST /api/auth/reset-password
PUT  /api/auth/profile
POST /api/auth/profile/document-upload
GET  /api/auth/verify-token
```

### Found Items

```text
POST   /api/found-items
GET    /api/found-items
GET    /api/found-items/search
GET    /api/found-items/matches
PUT    /api/found-items/<fpost_id>
DELETE /api/found-items/<fpost_id>
```

Found images use the `found-item-images` bucket.

### Missing Items

```text
POST   /api/missing-items
GET    /api/missing-items
GET    /api/missing-items/matches
GET    /api/missing-items/public
PUT    /api/missing-items/<mpost_id>
DELETE /api/missing-items/<mpost_id>
```

Missing images use the `missing-item-images` bucket.

### Admin (`/api/admin`, Admin/Backend page blueprints)

Roles come from `user_profiles.access_level` (`user | admin | super_admin`). Standard admins can create, read and update; **only `super_admin` can delete**. Every admin blueprint gets the `before_request` guard `enforce_super_admin_for_deletes` (`Admin/Backend/shared/admin_access.py`, attached in `Server/app/blueprints.py`), so any `DELETE` route under `/api/admin` returns 403 for a standard admin, including routes added later. Individual delete routes and DB RPCs also check the role. On the frontend, `Admin/Frontend/src/utils/permissions.ts` (`canDelete`, `isSuperAdmin`) controls whether delete actions are shown.

```text
POST  /api/admin/users                 create a standard user account (password >= 16, hashed)
PATCH /api/admin/users/<account_id>    edit profile fields (not access_level/password/is_active; only super_admin may edit a super_admin)
POST  /api/admin/claims                record a walk-in claim (found item FP ref + claimant email/campus ID)
PATCH /api/admin/claims/<claim_id>     edit the claim reason on a pending/approved claim
```

Admin UI building blocks: `Admin/Frontend/src/components/ui/AdminModal.tsx` (dialog that becomes a bottom sheet on mobile) and `components/ui/primitives.tsx` (`BTN`, `PageHeader`, `RolePill`, `Field`, inputs). The dashboard opens with a navy "desk" band and a "Needs your action" worklist that links to pages through `onNavigate`.

Lost-report status (`PUT /api/admin/lost-items/<ref>` with `status`) accepts only `missing | found | returned` (`SupabaseDB.ADMIN_MISSING_ITEM_STATUSES`). Found items let admins set only the holding states `unclaimed | review`; claimed, ready-to-release and returned come from the claim workflow. Both admin list endpoints also return `rawStatus`.

**Admin console theme, language and management layout**
- Theme and language are per-device preferences in `Admin/Frontend/src/utils/preferences.ts` (`useTheme`, `useLanguage`, `useT`). `initPreferences()` runs in `main.tsx` and sets `html[data-theme]` and `lang`. The localStorage keys are `ebalik_admin_theme` and `ebalik_admin_language`.
- Copy lives in `src/i18n/strings.ts`: English is primary, Tagalog falls back to English per key. Navigation, header, page titles and the four management pages are translated. Record values (statuses, categories) stay as stored.
- Dark mode lives in `src/index.css`. `:root[data-theme="dark"]` remaps the design tokens (ink, line, frost, slate, tints) and the common hard-coded utilities, so every page follows the theme. `dark:` utilities use the custom variant bound to `data-theme`. Don't pair `bg-white` with `dark:bg-*`, because the unlayered remap wins; use `bg-[var(--surface)]` instead.
- Every management page (Lost items, Found items, Claims, Users) uses `src/components/ui/management.tsx`: `SegmentedFilter` (status tabs with counts), `Toolbar`, `SearchField`, `FilterSelect`, `DataTable` (horizontal scroll with the last column pinned via `.mgmt-actions`, so row actions are always reachable), `IconAction`, `StatusPill`, `usePagination` plus `TableFooter`, `DetailGrid`, and `ExportButton`. Exports go through `src/utils/csv.ts` (BOM plus formula-injection guard).
- Item categories are shared with the user app's report forms in `src/utils/itemOptions.ts`.
- **Localization (admin):**
  - Typed keys live in `i18n/strings.ts`. Every other displayed English phrase goes through `tr("English phrase", { 0: value })` from `utils/preferences.ts`.
  - The Tagalog dictionary is `i18n/phrases.ts`, keyed by the exact English text; anything missing falls back to English.
  - Shared components translate string props at render (`AdminModal`, `ConfirmActionDialog`, `InfoModalHost`, `StatusPill`, `SegmentedFilter`, `FilterSelect`, `DataTable` headers, `DetailGrid`, `Field`, input placeholders), so pass them plain English.
  - New UI text must be wrapped in `tr()` and have an entry added to `phrases.ts`.
- **Dialog layering (admin):** `AdminModal` is z-70 and portaled. `ConfirmActionDialog` is z-90 and portaled, so a confirmation always sits above the form that opened it. The image zoom is z-80 and the global result modal z-1000. Escape closes only the top dialog (`isTopDialog`).

**User app theme**
- `Users/Frontend/src/app/utils/theme.ts` (`initTheme` in `main.tsx`, `useTheme`) sets `html[data-theme]` and the PWA `theme-color`. The localStorage key is `ebalik_user_theme`, and the default follows the OS setting. The toggle lives in `UserHeader` (desktop and drawer).
- Dark mode is the `:root[data-theme="dark"]` layer at the end of `styles/theme.css`. It mirrors the admin: navy-black canvas, glass cards, gold primary actions, and remapped brand and utility colours. The shadcn tokens are navy-tinted. `.app-chrome` styles the header and tab bar, and `.ui-modal-panel` makes the shared modal opaque.
- All-caps label styling has been removed from both apps; labels and headings use sentence case.

### Auction Hall (`/api/auctions`, `Users/Backend/auctions`; admin `/api/admin/auctions`, `Admin/Backend/auctions`)

Items in custody (found item status `unclaimed`) for at least 30 days with no open claim can be auctioned. The data layer is `Server/app/utils/auction_db.py` (`AuctionService`); email is `Server/app/utils/auction_email.py`.

**Setup:** run `Server/manual_migrations/20261005_auction_hall.sql` once in the Supabase SQL Editor. Until then every auction endpoint answers `503 {"setup_required": true}`; the admin page shows the setup steps and the user pages show "opening soon".

**Database:**
- `auctions` holds a snapshot of the item (title, photo, gallery), pricing (`starting_price`, `bid_increment`, `current_price`), timer (`starts_at`, `ends_at`, `original_ends_at`), anti-snipe settings, status (`scheduled | active | ended | cancelled`), winner and pickup (`fulfillment_status`: `awaiting_pickup | collected | forfeited`). A unique partial index allows only one live auction per item.
- `auction_bids` and `auction_comments` (comments can be hidden by admins).
- Foreign keys use SET NULL or CASCADE, so deleting an item or a user is never blocked.
- RLS is on with no policies; only the backend service key reads or writes.
- **Buy Now:** `buyout_price` (NULL = none; must exceed `starting_price`; locked once bidding starts) and `bought_out` (migration `20261009_tag_expiry_and_auction_buyout.sql`). Admins set it optionally when creating an auction (`parse_buyout` in `auction_db.py`).

**Rules enforced in Postgres:**
- `auction_place_bid(auction, bidder, amount)` locks the auction row and checks: account active, auction open, item still `unclaimed`, bidder isn't already leading, amount at least the starting bid or the current price plus the increment. It inserts the bid, updates the price, and extends the end time when a bid lands inside the anti-snipe window (capped by `max_extensions`). It returns `{ok, error, min_bid, extended, previous_bidder_id, auction}` rather than raising.
- **Buy Now is decided inside `auction_place_bid`** (same row lock, so two simultaneous buyers cannot both win). A bid at or above `buyout_price` is capped to exactly `buyout_price`, inserted, and the auction goes straight to `awaiting_admin` with the buyer as `winner_account_id` / `winning_amount`, `bought_out = true`, `ends_at` and `ended_at` set to now. The existing admin "Confirm winner" (`auction_finalize`) and pickup flow then run unchanged. The current leader may still buy out; the result carries `bought_out`. The user app shows "Buy Now for ₱X" (`shared/auction/AuctionDetail.tsx`), the buyer gets a "You used Buy Now" notice and the previous leader "Auction ended: Buy Now". The public log shows a `buyout` event with the anonymous alias.
- `auction_settle_due()` starts scheduled auctions, closes finished ones, awards the highest bid and marks the item `auctioned`. It cancels instead of awarding when the item is no longer unclaimed or an ownership claim is open, because a real owner has priority. Each finished auction is returned once.

**Settlement is lazy:** the API calls `settle_and_notify()` on every auction read (throttled to 2s). Winners get an in-app notification (`notification_type auction_won`, link to the Auction Hall) and an email through `send_auction_won_email`. Winner notices are claimed atomically through `winner_notified_at`, so they send once. `AUCTION_EMAIL_MODE=mock` (default) only logs the email, with the address masked, and `sendgrid` sends it. The outbid leader and a cancelled auction's leader get in-app notices too.

**Public API:** `GET /api/auctions` (live, upcoming and recent sold; no login), `GET /api/auctions/<id>` (bids and comments; optional login adds personal fields), `GET /api/auctions/mine`, `POST /api/auctions/<id>/bids`, `POST /api/auctions/<id>/comments`, `DELETE /api/auctions/<id>/comments/<comment>` (own comment). Bidders and commenters are shown as first name plus last initial; email and campus ID are never returned.

**Admin API:** `GET /auctions`, `GET /auctions/eligible-items`, `POST /auctions`, `GET|PATCH /auctions/<id>`, `POST /auctions/<id>/{cancel,end,fulfillment}`, `PATCH /auctions/<id>/comments/<comment>` (hide or restore), `DELETE /auctions/<id>` (super admin only, never while live or awaiting pickup). Prices lock once bidding starts; after that the end time can only move later.

**Frontends:**
- Admin: `Admin/Frontend/src/pages/auctions/` (`Auctions`, `AuctionFormModal` with the live lot ticket, `AuctionDetailModal`) with `utils/auctionApi.ts` and `utils/countdown.ts`. The dashboard work queue shows "Auction pickups waiting".
- User: `Users/Frontend/src/app/utils/auctions.ts` (typed client, `useAuctionFeed`, countdown helpers), `shared/auction/` (`Gallery`, `AuctionParts` with the clock, tile and SOLD tile, `AuctionDetail` bidding dialog, `AuctionShelf` for the dashboard, `AuctionShowcase` for the landing page, `useWatchlist`), and `pages/auction-hall/` (the feed page and post card). The Auction Hall is a social-style feed with swipeable photos, a two-step confirm to bid, comments and a Sold grid. Countdowns follow the server clock.
- Landing: `pages/home/LiveBoard.tsx` shows recent missing reports and found items from `/api/public/board`; the hero counts are real data.

**Lifecycle (Awaiting admin):** when the timer ends, `auction_settle_due()` no longer closes the auction. With bids it moves to `awaiting_admin` (shown as `awaiting`): bidding stops, the leader and price are kept provisionally and the item is untouched. Without bids it ends; if the item is gone or an owner claim is open it is cancelled. Only an admin finishes it:
- `POST /api/admin/auctions/<id>/finalize` calls `auction_finalize` (admin only, only from `awaiting_admin`). It confirms the winner (`fulfillment_status = awaiting_pickup`, item marked `auctioned`, winner notified) or cancels when the item or winner is no longer valid.
- `POST /api/admin/auctions/<id>/reauction` is the "winner flaked" action. It works from `awaiting_admin` or from a sold auction that is still `awaiting_pickup`. It forfeits the old sale, returns the item to `unclaimed` and opens a new auction (`reauctioned_from`, `reauction_reason`) with new terms. Optional `suspend_days` (1 to 365) suspends the previous winner and notifies them. Staff and the acting admin are never suspended.
- A forfeited sale never receives a "You won" notice (`_notify_pending_winners` only notifies `awaiting_pickup` and `collected`).
- Users see "Awaiting result" badges; the Sold tab is now Results. Bidding uses a confirmation `Modal` and the global message box for every outcome. Admin actions use `AdminModal` (finalize, re-auction, suspend) and `ConfirmActionDialog` (end, delete, collect, forfeit).

## System control, verification gate and suspensions

Run `Server/manual_migrations/20261006_system_control_verification.sql` after `20261005_auction_hall.sql`. Until it runs, the code degrades: no maintenance or force logout (the Control Panel shows the setup notice), role assignment and timed suspension answer with a clear message, and the health check still works.

**Database:** `user_profiles` gains `user_category` (Student, Faculty, Staff, Visitor), `suspended_until`, `suspension_reason`, `suspended_by`. New table `system_settings(setting_key, setting_value JSONB, ...)` holds `maintenance_mode`, `sessions_valid_after` and `last_cleanup` (RLS on, service key only). `auctions` gains the awaiting-admin columns. `SupabaseDB.supports_governance_fields` detects the new columns.

**Enforcement (`Server/app/utils/system_control.py`)** is one Flask `before_request` hook registered in `Server/app/__init__.py`, with a 5 second cache that fails open if the database is unreachable. Order: maintenance, revoked session, suspension, verification gate. Admins and super admins skip everything except maintenance, which never blocks them.
- **Maintenance:** non-staff get `503 {maintenance: true}` on every `/api` path except sign-in and `GET /api/system/status`. `login_block` rejects non-staff sign-in and Google sign-in with the message. The user app shows `shared/system/MaintenanceScreen.tsx` (with a staff-only sign-in), and the admin header shows a "Maintenance mode is ON" pill.
- **Force logout:** stores `sessions_valid_after`. Any non-staff token with `iat` older than that gets `401 {session_revoked: true}`. Staff tokens are never revoked.
- **Suspension:** `is_active = false` plus optional `suspended_until`. It is enforced at sign-in and on every request, and an expired suspension is lifted automatically. Admin: `PATCH /api/admin/users/<id>/status` accepts `days` and `reason`.
- **Verification gate:** unverified users get `403 {verification_required: true}` for `POST /api/found-items`, `/api/missing-items`, `/api/claims` and `/api/auctions/<id>/bids`. The UI (`shared/verification/VerificationGate.tsx`) explains this and disables submit.
- **Roles:** the admin verification review requires one of Student, Faculty, Staff, Visitor (`user_category`; the legacy `user_role` keeps working, Visitor maps to Others). Verified users cannot change their email or campus ID. The Profile page shows status, role, progress and what is unlocked (`VerificationStatusCard`).
- **Client events:** `Users/Frontend/src/app/utils/system.ts` raises `ebalik:system` events from the API clients; `App.tsx` signs the user out on a revoked session or suspension and shows the maintenance screen.

**Control Panel API (super admin only, including reads), `Admin/Backend/system_control`:**

```text
GET  /api/admin/system/overview            maintenance state, last forced logout, last cleanup, setup_required
PUT  /api/admin/system/maintenance         {enabled: bool, message}
POST /api/admin/system/force-logout        revoke every standard user session
GET  /api/admin/system/health              run the 10-check scan (read only)
GET  /api/admin/system/cleanup/preview     ?days=&include_unread=
POST /api/admin/system/cleanup             {days >= 30, include_unread, targets[]}
GET  /api/system/status                    public: {maintenance, message, since, announcement}
```

Cleanup only ever touches `user_notifications` (read ones by default), `otp_tokens` and `admin_mfa_challenges` older than the chosen age (minimum 30 days). The health scan checks environment variables (names only, never values), database latency, schema, unverified users with high activity, admin MFA coverage, the verification backlog, suspensions, table bloat, auctions waiting too long and the system controls. Frontend: `Admin/Frontend/src/pages/system-control/SystemControl.tsx` with `utils/systemApi.ts`; the sidebar item and route are super-admin only.

## Report rules, privacy consent and auction privacy

Run `Server/manual_migrations/20261007_report_integrity_and_reactions.sql` after `20261006`. Everything below works without it except saved hearts (the table) and the database-level duplicate-claim index.

- **Double submits:** `Server/app/utils/report_guard.py` holds one in-process slot per account and action (`begin_submission` / `end_submission`), so a double-click or retry cannot create two records; the second request gets 409 `duplicate_submission`. The claim route uses the slot `claim:<account>:<found item>`, answers a database uniqueness error with 409 `duplicate_claim`, and the migration adds the partial unique index `uq_claims_one_open_per_claimant_item` (skipped, with a notice, if duplicates already exist). The user forms also ignore a second click while a request runs.
- **Anti-spam:** an account can have at most 6 active reports (`MAX_ACTIVE_REPORTS` in `report_guard.py`) (missing plus found; resolved reports do not count): 429 `report_limit`. A new report whose description is highly similar to one of the account's own active reports of the same kind is refused: 409 `duplicate_report` (`is_similar` in `report_guard.py`). The frontend shows both as message boxes (`utils/submitErrors.ts`).
- **Data Privacy Act consent:** the Missing, Found, Claim and verification-document submissions require `dpa_consent=true`; the server refuses them without it (400 `dpa_required`) and records the consent in the activity-log metadata (`Users/Backend/shared/privacy.py`). The checkbox is `shared/privacy/DataPrivacyConsent.tsx`.
- **After a report:** the user is sent to My Reports, where the new report leads the list with a gold ring and a "Just added" tag (`highlightReportId` navigation option, `ItemCollection highlightId`).
- **Verification refresh:** every `useAuth()` instance syncs from the shared `ebalik:user-updated` event; the app polls the profile every 8 s while the account is unverified (20 s otherwise) and the Profile page every 6 s; an approval shows a message box with the role.
- **AI match email:** confirming an AI match emails the missing-item reporter as well as the in-app notice (`confirm_ai_match_and_notify`, best effort; the admin sees whether the email went out).
- **Auctions, public privacy:** user-facing pages never show real names. Bidders and commenters appear as `Bidder_XXX`, stable inside one auction (`bidder_alias`, derived from the auction, the account and the server secret). The admin console still shows real names. The public detail returns an activity `log` (opened, bids, extensions, close, confirmed winner, forfeited).
- **Comment filter:** `Server/app/utils/profanity.py` (English and Filipino, tolerant of letter swaps, repeated or spaced letters) blocks a comment with 422 `profanity`; the dialog keeps what the user typed.
- **Hearts (reactors):** saved per account in `auction_reactions` (`PUT|DELETE /api/auctions/<id>/reaction`, `GET /api/auctions/watching`); the admin auction page has a Hearts tab with who reacted. Hearts saved on a device by the old version move to the account once.
- **Re-auction rule:** only after a winner was confirmed and has not collected (`ended` plus `awaiting_pickup`). Before that the admin confirms the winner or cancels.
- **Winner email:** `AUCTION_EMAIL_MODE=auto` (default) sends through SendGrid when `SENDGRID_API_KEY` is set and only logs otherwise. The result is stored in `winner_email_mode` (`sendgrid`, `mock` or `sendgrid_failed`); the admin sees it and can use `POST /api/admin/auctions/<id>/resend-winner-email`.

## Handover PINs, premium emails, auction deadlines and dashboard analytics

Run `Server/manual_migrations/20261012_handover_pins_and_auction_timeouts.sql` after `20261011` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **Handover PIN (`Server/app/utils/handover.py`):** approving a claim (`PATCH /api/admin/claims/<id>/status` with `approved_for_pickup`) draws a 6 character PIN from a 31-symbol alphabet without look-alikes (no 0, O, 1, I, L). The row stores `handover_pin_hash` (HMAC with the app key, used for lookup; unique) and `handover_pin_encrypted` (AES-GCM, so the owner can read it again); the plain PIN exists only in the email and the owner's own claim card (`get_claims_by_account` adds `handover_pin` for approved claims). The admin API never returns a PIN. The guard types it on the Admin Dashboard (`pages/dashboard/HandoverPinCard.tsx`): `POST /api/admin/claims/handover/lookup` shows claimant name, campus ID, item and claim reference; `POST .../release` calls the same `admin_update_claim_status('collected')` function as the claims page (claim `collected`, found item `returned`) and clears the PIN, so a used PIN never works twice. Both are admin or super admin only and rate limited to 12 tries a minute per admin. `POST /api/admin/claims/<id>/handover-pin` creates a fresh PIN for an approved claim (claims approved before PINs existed, or a lost email) and re-sends the approval email. A PIN failure never undoes an approval: the response carries `handover_pin_issued` and `approval_email_sent`.
- **Premium emails (`Server/app/utils/email_templates.py`):** one layout for every message: navy page and glass-style card, UMak seal and wordmark header, gold hairline, large PIN/code panel, a large gold button, reassurance notes and a footer, built from tables and inline styles with `bgcolor` fallbacks so it works in Outlook and Gmail. `render_email()` returns HTML plus a plain-text part, and escapes every value. `EmailService` now sends OTP (registration and reset), welcome, claim approved (`send_claim_approved_email`), announcement, test, and every `send_reference_email` message (claims received, reports, Smart Tags, AI matches, auctions) through it; `send_notice_email` is the generic sender. The logo and buttons use `PUBLIC_SITE_URL`.
- **Auction deadlines (`AuctionService.process_overdue_pickups`):** the clock starts at `winner_notified_at` (a resend of the winner email does not restart it). After 48 hours with no pickup the winner gets a 24-hour final warning (in-app plus email, once, `pickup_warning_sent_at`). After 72 hours the win is forfeited automatically: `fulfillment_status = forfeited`, `auto_forfeited_at`, the item returns to `unclaimed`, the winner gets `bidding_banned_until = now + 30 days` (staff are never banned), is told by notification and email, and every admin gets an in-app notification and an email "Ready for Re-Auction". The ban is enforced in `AuctionService.place_bid` (403 `bidding_banned`, also covers Buy Now). The admin Auctions page marks such auctions "Ready for re-auction" (`reauction_ready`, stat `reauction_ready`, a Dashboard work-queue row), and `reauction()` accepts them without another forfeit; each can be listed again once.
- **Scheduler (`Server/app/utils/scheduler.py`):** an in-process timer thread (every `SCHEDULER_INTERVAL_MINUTES`, default 15; `SCHEDULER_ENABLED=false` disables it; off in tests), `POST /api/cron/run` with header `X-Cron-Secret` (503 until `CRON_SECRET` is set; exempt from maintenance mode), and `python Server/scripts/run_cron.py`. A free Render service sleeps when idle, so use the HTTP trigger from an outside timer for reliability (`DEPLOYMENT_GUIDE.md`). Steps claim their rows with conditional updates, so overlapping runs never double-send.
- **Analytics (`Server/app/utils/analytics.py`, `GET /api/admin/dashboard/analytics`):** `build_visual_analytics` is a pure function (tested) returning lost-item categories (top 6 plus Other), lost reports by weekday, by month (12 months) and a weekday by month heatmap (by `last_seen_date`, falling back to `created_at`), the busiest weekday and month, and found-item outcomes (returned or collected, auctioned, disposed or abandoned, still in custody, return rate). The dashboard section is `pages/dashboard/AnalyticsSection.tsx` (Recharts donut, bar chart, CSS heatmap, each with a "view as a table" fallback). Colours follow a validated colour-blind-safe categorical order and a single-hue ramp, in light and dark.

## Mission Control (System Control page, super admin only)

`Admin/Frontend/src/pages/system-control/` now has five tabs: Controls and health (maintenance, force logout, health scan, cleanup), Announcement, Communications, Admin access, Data and email. Backend: `Server/app/utils/mission_control.py`, routes in `Admin/Backend/system_control/routes.py` (all super admin only, rate limited per admin, every action written to the activity log). Run `Server/manual_migrations/20261010_tag_photo_and_mission_control.sql` for the storage tools; everything else needs no schema (the banner lives in `system_settings` under `announcement`, messages use `user_notifications`).
- **Announcement banner:** `PUT /api/admin/system/announcement {live, tone: info|success|warning|critical, title, message}`. `GET /api/system/status` (public) carries `announcement` only while live; its `id` is the save time, so a visitor who closed it sees an edited one again. Shown above every user page (`shared/system/AnnouncementBanner.tsx`, mounted in `App.tsx`) and every admin page (`components/AnnouncementBanner.tsx`), polled every 30 s and paused in hidden tabs. Text is stripped of angle brackets and rendered as text. "Important" cannot be closed.
- **Communications hub:** `GET /system/users/search?q=` (name, email, campus ID; characters that could reach the filter are removed) and `POST /system/messages {audience: user|all, account_id, title, message, send_email, send_in_app}`. In-app copies are inserted in batches of 500 into `user_notifications` (`notification_type = 'announcement'`). Email uses `EmailService.send_announcement_email` (escaped, no links); to one user it is sent inline, to everyone it runs in a background thread and is capped at 2,000 recipients. Suspended accounts are skipped for "all". 10 sends per hour per admin.
- **Admin access governance:** `GET /system/admins` (admins, super admins and legacy role accounts, with two-factor status and last sign-in) and `POST /system/admins/<id>/revoke`. Revoking sets `access_level = 'user'` at once (admin routes re-read the level on every request, so the session stops working), notifies the person, and refuses: revoking yourself, a standard user, and the last active super admin. Typing CONFIRM is required in the UI.
- **Audit export:** `GET /system/export?format=json|csv`. Allow-listed columns of users, claims, found items and lost reports plus totals; never password hashes, ID documents, proof images or claim text. CSV is a zip of one sheet per section, formula-looking cells are prefixed so Excel shows them as text.
- **Storage and cleanup:** `GET /system/storage` (via the SQL function `storage_bucket_stats()`), `POST /system/storage/scan` and `/clean`. An image is orphaned when no found item, auction, missing report, Smart Tag or claim refers to it and it is over 24 hours old. Only the four image buckets are touched (`found-item-images`, `missing-item-images`, `smart-tag-images`, `claim-proof-images`); ID documents are never scanned. If any reference table cannot be read, nothing is deleted.
- **Email test:** `POST /system/email-test` sends a message to the signed-in super admin and returns the provider's answer (key missing, rejected key, unverified sender, accepted).

## Smart Tags (QR stickers)

Run `Server/manual_migrations/20261008_smart_tags.sql` after `20261007`. Until then the endpoints answer 503 `setup_required`, the admin page shows the setup steps and the user's Smart Tags page says Smart Tags are opening soon. Set `PUBLIC_SITE_URL` on the backend (your site address) **before printing stickers**: every QR code must open `<PUBLIC_SITE_URL>/tag/<tag_id>`.

- **Operator guide:** `SMART_TAGS_GUIDE.md` (what `PUBLIC_SITE_URL` means, choosing a permanent address, the test run, printing, selling and troubleshooting). The admin page warns "Do not print stickers yet" while the QR address is unset, local or not https (`url_check` in `smart_tags.py`).
- **Expiry and types (migration `20261009_tag_expiry_and_auction_buyout.sql`):** `tag_type` (`qr | rfid | nfc`; only `qr` is generated today, others are switched on with `SMART_TAG_TYPES_ENABLED=qr,rfid`), `validity_months` (chosen when the batch is generated; NULL = never expires), `valid_until` (set when the owner registers the tag: `claimed_at` plus `validity_months`), `batch_id` (one UUID per "Generate batch" run), `scan_count` / `last_scanned_at`. Status adds `expired`. A tag past `valid_until` is switched to `expired` the first time anyone scans or lists it (`_refresh`) and in bulk when the admin page loads (`_expire_due`); an expired tag shows finders only "This Smart Tag has expired" (no item, owner or found button), the owner sees "Expired" in My Smart Tags, and `update` / `report_found` refuse it. `encode_value()` decides what is written on the medium (a link for QR/NFC, the bare code for RFID). Admin can renew a tag (`POST /api/admin/smart-tags/<id>/renew`), see batches soonest-expiring first (`GET .../batches`) and super admins can deactivate or reactivate a whole batch (`POST .../batches/<batch_id>/disable|enable`).
- **Registering from the My Smart Tags page:** `shared/tags/RegisterTagModal.tsx` (code typed, or scanned with `ScanCodeButton.tsx`, which reads QR codes in any browser using the `jsqr` library loaded on demand, then the details form with the live photo) so the user never leaves the page; each tag card has an Add/Retake photo camera button. The public `/tag/<code>` page still works for people who scan the sticker first.
- **Item picker:** the registration and edit form chooses the item from a dropdown (`shared/tags/ItemTypePicker.tsx`: Smartphone, Laptop, Tablet, Keys, Wallet, ID Card, Tumbler, Backpack, Umbrella, Earphones, Power bank, Calculator, Watch, Eyeglasses) or "Other" with a typed name; the label is what is saved as `item_name`, and the description holds the details.
- **Live registration photo (migration `20261010_tag_photo_and_mission_control.sql`):** `smart_tags.item_image_url` holds the storage **path** of a photo of the item with its sticker, kept in the PRIVATE bucket `smart-tag-images` (5 MB, jpeg/png/webp). Registration is multipart (`POST /api/tags/<code>/claim` with a `photo` file) and the photo is required (400 `photo_required`); `POST /api/tags/<code>/photo` lets an owner retake it. The server sniffs the real image type from the bytes (the filename and content type are not trusted), caps the size, and deletes the object if the claim loses a race. Finders get a short-lived signed link (`photo_url`, 10 minutes) only for active or lost tags, never for blank, expired or deactivated ones; the raw path is never sent to a browser. The admin tag dialog loads it from `GET /api/admin/smart-tags/<code>/photo`. The user form uses `shared/tags/LivePhotoField.tsx`: `getUserMedia` live video with a shutter (no file input exists in that path), or on touch devices whose browser blocks the camera API a `capture="environment"` input; desktops without a camera are blocked. The picture is redrawn on a canvas, which strips EXIF and shrinks it. A browser cannot prove a photo is live, so this removes the gallery path rather than cryptographically proving freshness.
- **Staff approval and name lock (migration `20261011_tag_staff_verification.sql`):** `status` adds `pending_verification`; registration (`claim`) now lands there with `prior_status = NULL` and no `valid_until` (the validity clock starts at approval: `valid_until = approved_at + validity_months`). Pending tags are invisible to the public (`public_view` returns only `{tag_id, status, is_owner}`), cannot be marked lost, renewed or reported found. The owner sees `awaiting_approval`, `photo_pending`, `is_reregistration`, `item_name_locked` and a yellow "Awaiting Admin Approval" badge. `update` rejects an `item_name` change with 403 `item_locked` and a status change while pending with 409 `pending`. `set_photo` on an active/lost tag stores the new photo in `pending_image_url`, remembers `prior_status`, and sets `pending_verification` (approved photo kept in `item_image_url`). Admin: `POST /api/admin/smart-tags/<id>/approve`, `POST .../reject` (reason required; first registration resets the tag to blank, a re-photo deletes the pending photo and restores the previous photo and status), `PATCH /api/admin/smart-tags/<id>` (JSON or multipart; every field and the photo, never changes approval state), `GET .../photo` returns `{url, previous_url, is_new_photo}`; list filter and stat `pending`. Admin UI: `pages/smart-tags/VerificationModal.tsx` and `AdminTagEditModal.tsx`. User UI: `TagDetailsForm.tsx` shows a Confirmation modal before registering (exact fraud warning, "Confirm Registration") and a locked item name in edit mode (`ItemTypePicker` `locked` prop).
- **Table `smart_tags`:** `tag_id` (primary key), `owner_account_id`, `item_name`, `item_description`, `status` (`blank | active | lost | expired`), privacy toggles `show_name`, `show_email`, `show_phone` (all off by default) with `contact_phone`, and admin control `is_disabled`, `disabled_reason`, `disabled_by`. RLS on, no policies: only the backend reads or writes it. `tag_id` is 12 characters from a 32-symbol alphabet without look-alikes (no 0, O, 1, I), drawn with `secrets.choice` (about 60 bits), so it cannot be guessed or enumerated. The CHECK only enforces the format.
- **Code:** `Server/app/utils/smart_tags.py` (`SmartTagService`), `Server/app/utils/rate_limit.py`, `Users/Backend/smart_tags/routes.py` (mounted at `/api/tags`), `Admin/Backend/smart_tags/routes.py` (`/api/admin/smart-tags`).
- **Public page:** `/tag/<code>` is handled in `App.tsx` before sign-in (`pages/tag/TagPage.tsx`; production rewrite in `vercel.json`). Blank: "This E-Balik Smart Tag is unregistered! Log in to claim it" (signed-in users see the claim form). Disabled or ownerless: nothing about the item or owner. Active or lost: item, description and only the contact details the owner switched on, plus a large "I found this item!" button. `public_view` builds its answer from an explicit allow-list (never the database row); answers are `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **Finder action:** `POST /api/tags/<code>/found` works without an account. It notifies the owner in the app and by email at most once per 5 minutes per tag (atomic claim of the notice), then shows the OHSO guard post steps. Lookups are limited to 90 per minute per address, found notices to 10 per hour per address and 3 per tag.
- **Owner:** `GET /api/tags/mine`, `POST /api/tags/<code>/claim` (atomic: succeeds only while the tag is blank, unowned and not disabled; needs Data Privacy Act consent; up to 25 tags per account), `PATCH /api/tags/<code>` (details, privacy switches, `active` or `lost`). Someone else's tag answers 404, the same as a missing tag. Owners manage tags on the dedicated **Smart Tags** page (`Page` value `my-tags`, `pages/my-tags/MyTagsPage.tsx`, which renders `shared/tags/MyTags.tsx`; it is no longer on the Dashboard). Smart Tag notifications use `link_page = 'my-tags'`, and older ones are matched by type in `Notifications.tsx`. The `/tag/<code>` page's "Manage my tags" button also opens it.
- **Admin ("factory"):** `Admin/Frontend/src/pages/smart-tags/SmartTags.tsx`. Generate batch (1 to 500, optional label), filters All / Blank (unsold) / Claimed (sold and registered) / Lost / Deactivated, per-tag QR image (PNG), CSV of codes and URLs for printing. Deactivate and reactivate are super admin only; the owner is notified with the reason.
- **XSS:** free text is stored as plain text (control characters and angle brackets removed, length capped), rendered only as React text (no `dangerouslySetInnerHTML`), escaped in emails, and email and phone become `mailto:` or `tel:` links only when they match a strict pattern.

## Deployment

Free-tier setup is in `DEPLOYMENT_GUIDE.md`: Vercel serves the user app at `/` and the admin console at `/admin/` from one project (`vercel.json`, `npm run build:vercel`, `scripts/merge-admin-build.mjs`), Render runs the Flask API (`render.yaml`, `Procfile`, gunicorn `Server/run.py:app`) and Supabase stays the database. Production CORS comes from the `CORS_ORIGINS` environment variable. Environment checklists are `Environment_Configs/*/production.env.example`.

## Image Upload Rules

The missing image upload bug was fixed in `Users/Frontend/src/app/utils/api.ts`.

When building `FormData`, preserve `File` objects. Do not call `String(file)` because that sends `[object File]` instead of file bytes.

Correct pattern:

```ts
if (value !== undefined) {
  formData.append(key, value instanceof File ? value : String(value));
}
```

The backend normalizes Supabase public URL responses that may be strings or objects. Keep image fallbacks in UI cards and modals.

## Matching Logic

Implemented in `Server/app/utils/matching.py`.

Score components:

```text
Category equality:       30 points
Location similarity:     up to 25 points
Date proximity:          up to 20 points
Text token similarity:   up to 25 points
Maximum:                 100 points
```

Confidence levels:

```text
75%+: strong match
55%-74%: possible match
54% or lower: low confidence
```

Matching currently calculates dynamically. A future `match_candidates` table may store match state such as `new`, `viewed`, `dismissed`, `confirmed`, and `claimed`.

## Database

The canonical schema is `Server/database_schema.sql`. It includes:

- `user_profiles`
- `otp_tokens`
- `found_items`
- `missing_items`
- `claims`
- RLS setup and indexes
- Auction Hall tables (`auctions`, `auction_bids`, `auction_comments`) are defined only in `Server/manual_migrations/20261005_auction_hall.sql`
- `found-item-images` storage bucket
- `missing-item-images` storage bucket

Found report IDs use:

```text
FP<weekday number><three-digit sequence>
```

Missing report IDs use:

```text
MP<weekday number><three-digit sequence>
```

Weekday mapping is Monday `1` through Sunday `7`.

Found report status starts as `unclaimed`. Found custody is tracked separately using `custody_status`, normally `turned_over`.

`docs/DATABASE_SCHEMA.txt` is older documentation and may not reflect all current fields. Treat `Server/database_schema.sql` as authoritative.

## Theme ("Gallery Glass")

Premium, image-led and still fast to scan. Navy anchors structure and gold marks the primary action. Iris (periwinkle) handles links and focus, and tide (mint) signals matches and good news. Frosted glass is reserved for overlays, sticky bars and photo captions, so it doesn't sit on every card.

Tokens are Tailwind v4 `@theme` variables, defined in `Users/Frontend/src/styles/theme.css` and mirrored in `Admin/Frontend/src/index.css`. Use the utilities, not raw hex:

```text
navy-50 … navy-950    brand navy = navy-800 (#1f3160)
gold-50 … gold-900    brand gold = gold-500 (#d1a153); use gold-700 for gold TEXT on white
iris-50 … iris-700    links, focus ring (iris-500 #6e8ef0)
tide-50 … tide-700    mint, for matches / success context (tide-500 #3fbf9f)
frost-50 … frost-200  glass and soft panels
page, line, line-strong, ink, ink-soft, ink-muted          neutrals
shadow-card, shadow-raised, shadow-overlay, shadow-glow-gold, shadow-glow-iris
```

- Utilities: `.app-canvas` (soft gradient page background), `.glass`, `.glass-dark`, `.text-gradient-gold`, `.scrim-bottom`, `.no-scrollbar`, `.kenburns`, `.slide-progress`. All motion utilities respect `prefers-reduced-motion`.
- Fonts: Outfit (headings, `--font-heading`) and Inter (body), in both apps.
- User-app component classes live in `Users/Frontend/src/app/utils/clay.ts` (`CX.btnGold`, `CX.btnNavy`, `CX.card`, `CX.cardHover`, `CX.input`, `CX.badge*`, `CX.eyebrow`, `CX.pageTitle`…).
- Controls are at least 44px tall and text is at least 12px. Focus uses a global iris `:focus-visible` ring. Card hover lifts use `transform` only. Icons come from Lucide, never emoji.

### Media components (`Users/Frontend/src/app/shared/media/`)

- `ItemImage` + `GalleryItem` type: photo with a branded no-photo fallback (UMak seal watermark + category glyph). `GalleryItem` holds public-safe fields only.
- `HeroSlideshow`: accessible auto-advancing slideshow. It pauses on hover, focus, hidden tab, or the pause button, never autoplays with reduced motion, supports arrow keys, and has dots with a progress fill.
- `ItemCollection`: the single item display used across pages. It renders `GalleryItem[]` as photo tiles (2 to 4 columns) or compact list rows, with `badge` and `extra` slots for status, IDs, match scores and meters.
- `ItemViewer`: full-screen viewer with zoom/pan, previous/next across the current list, a thumbnail filmstrip, a details panel, and caller-supplied actions. It traps focus, locks scrolling, and closes on Esc.
- Used by Dashboard (hero, Recent found items, and Recent missing reports with a Campus/Mine switch), Browse Items, My Reports, Matches, the Found/Missing Item report history, and Landing.

### Tile / list view (`Users/Frontend/src/app/shared/view/`)

- `useViewMode()` + `ViewToggle`: one app-wide "tile" / "list" preference, persisted in `localStorage` (`ebalik_view_mode`) and synced across pages and tabs. Every item collection reads it, so switching on one page switches everywhere.

### Modals (`Users/Frontend/src/app/shared/modal/Modal.tsx`)

- Every user-app dialog uses `Modal`: a centered card on desktop and a bottom sheet with a grab handle and safe-area padding on phones. It provides a toned icon tile, eyebrow, title, description, an optional photo `hero`, a scrollable body, and a sticky `footer`.
- It handles the portal, focus trap, Escape (topmost modal only, via a modal stack), focus restore, and reference-counted scroll lock. Pass `dismissible={false}` while a request is in flight.
- `CountdownConsent`: the 5-second countdown + acknowledgement block for edits, deletes, report submissions and claims.
- Admin: `Admin/Frontend/src/components/ConfirmActionDialog.tsx` follows the same style. Page-level admin overlays get the frosted backdrop and premium panel through `index.css`.

### Mobile / PWA

- `Users/Frontend/src/app/shared/MobileTabBar.tsx`: bottom navigation below `lg` (Home, Browse, a gold Report button, Matches, Reports). Content reserves `76px + safe-area` at the bottom.
- `Users/Frontend/public/manifest.webmanifest` + `public/icons/*` (generated from the UMak seal, including a maskable icon). `index.html` sets `viewport-fit=cover`, the theme color and Apple web-app meta tags.
- `Users/Frontend/public/sw.js`: app-shell service worker, registered in `main.tsx` in production only. Navigations are network-first with a cached-shell offline fallback; `/assets` and `/icons` are cache-first; Google Fonts are stale-while-revalidate. It never caches the API or `/admin`. Bump `VERSION` in `sw.js` when caching rules change.
- Inputs are 16px on phones (prevents iOS focus zoom). The header and sticky toolbars are offset by `env(safe-area-inset-top)`.

### Performance

- `Users/Frontend/src/app/utils/api.ts`: GET requests are de-duplicated and cached for 15 s; any mutation and logout clear the cache. `/api/auth` and `/api/notifications` are never cached.
- `vite.config.ts` splits `vendor-react` and `vendor-motion` chunks. Tailwind skips the unused `src/app/shared/ui/**`.
- Heavy images are served as WebP siblings (`*.webp` next to the original PNGs in `src/imports`).

Avoid:

- Replacing the navy/gold base, or glass on every surface (keep it for overlays and captions).
- Carousels without pause/arrow controls, or carousels as the only way to reach items. Always provide a grid or "View all".
- Stock or sample photos standing in for real items. Use the `ItemImage` fallback.
- Duplicate report forms and tabs.
- Exposing private report data publicly.
- Mock placeholder reports in user-facing workflows.
- Breaking existing report creation or authentication behavior.

## Global Information Modal

Every finished process (submit, save, delete, sign-in, logout, claim decisions…) reports its outcome through one global modal in each app:

- User app: `Users/Frontend/src/app/shared/info-modal/` (store + `<InfoModalHost />`, mounted in `App.tsx`)
- Admin app: `Admin/Frontend/src/components/info-modal/` (same code, mounted in `App.tsx`)

```ts
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
showInfoModal({ variant: "success" | "error" | "warning" | "info", title, message, reference?, details? });
```

- Messages queue and show one at a time. Identical messages are merged.
- Success and info auto-close (the timer pauses on hover or keyboard focus). Errors and warnings stay until dismissed.
- Escape closes the modal. Focus is trapped while open and restored afterwards.
- The queue is mirrored to sessionStorage (shared key across both apps on the same origin), so a result survives reloads and the admin-to-user logout redirect.
- Admin API mutations report automatically: `adminMutationRequest` calls `reportAdminProcess` with `auto: true`. Pages can follow up with a more specific `showInfoModal({ ..., replaceAuto: true })`, which replaces the generic message instead of stacking a duplicate.
- Rule of thumb: server and process outcomes go to the modal. Pre-submit field validation and one-time-code entry errors stay inline next to the field.

## Safety Constraints For Future Changes

1. Read the nearby owning implementation before editing.
2. Preserve existing backend routes and authentication behavior unless a change is required.
3. Keep report edits and deletes owner-scoped on the server, not only hidden in the UI.
4. Keep statuses server-controlled during creation.
5. Preserve multipart file uploads as real `File` objects.
6. Add confirmation for destructive or sensitive actions.
7. Run `npm run build` after frontend changes.
8. Run `python -m compileall -q Server Users/Backend Admin/Backend` after backend changes.
9. Check editor diagnostics for touched TypeScript files.
10. Do not commit or reset unrelated user changes.

## Known Gaps And Recommended Next Work

- Replace repeated modal JSX with a shared accessible modal component.
- Add keyboard focus trapping and Escape-key close behavior to modals.
- Add reverse matching for a user's found reports and possible missing owners.
- Add persisted match candidates and dismiss/confirm actions.
- Fully connect Claim UI to the `claims` backend table.
- Add system-wide public missing-report endpoint if Dashboard should show all users' missing reports rather than the current user's reports.
- Add automated tests for image upload, carousel rotation, modal flows, edit confirmation, delete confirmation, and match navigation.
- Consider React Router when browser back/forward and deep links become important.
- Update `docs/DATABASE_SCHEMA.txt` to match the canonical SQL schema.
