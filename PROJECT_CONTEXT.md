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
    src/pages/<page>/          dashboard, reports (lost, found and custody tabs, plus the handling-history dialog), lost-items, found-items,
                               ai-matching, claims-verification, guard-desk (release desk, assigned items, notices), users,
                               reports-analytics (Analytics), notifications, activity-logs, admin-profile, smart-tags, auctions,
                               recycle-bin, system-control
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
| `POST/GET /api/found-items`, `GET /api/found-items/matches`, `GET /api/found-items/guards` | `found_item` | Found Item (list also My Reports; guards = who can receive an item) |
| `POST/GET /api/missing-items`, `GET /api/missing-items/matches` | `missing_item` | Missing Item (list also Dashboard, Matches, My Reports) |
| `PUT/DELETE /api/found-items/<id>`, `PUT/DELETE /api/missing-items/<id>` | `my_reports` | My Reports |
| `GET /api/found-items/search` | `matches` | Matches, Dashboard, Browse Items, Missing Item |
| `GET /api/missing-items/public` | `browse_items` | Browse Items |
| `/api/claims` | `claim` | Claim |
| `/api/notifications` | `notifications` | Notifications, UserHeader badge |
| `/api/auctions/*` | `auctions` | Auction Hall (cards with inline bidding and comments), Auction posts in the home feed, Landing showcase |
| `/api/admin/*` | Admin `Backend/<page>` matching the admin page | the Items in custody tab reads found-items + claims + auctions (`/found-items/custody`, `/found-items/<ref>/history`); admin Notifications reads activity-logs + claims |

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
- User: `Users/Frontend/src/app/utils/auctions.ts` (typed client, `useAuctionFeed`, countdown helpers), `shared/auction/` (`Gallery`, `AuctionParts` with the clock, tile and SOLD tile, `AuctionDetail` bidding dialog, `AuctionShowcase` for the landing page, `useWatchlist`), and `pages/auction-hall/` (the feed page and post card). The Auction Hall is a social-style feed with swipeable photos, a two-step confirm to bid, comments and a Sold grid. Countdowns follow the server clock.
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
- **Winner email:** `AUCTION_EMAIL_MODE=auto` (default) sends through the configured email provider when `BREVO_API_KEY` or `SENDGRID_API_KEY` is set and only logs otherwise. The result is stored in `winner_email_mode` (`sendgrid`, `mock` or `sendgrid_failed`); the admin sees it and can use `POST /api/admin/auctions/<id>/resend-winner-email`.

## Auction lifecycle, Archive, exact bids, ID checks and menu badges

Run `Server/manual_migrations/20261016_archive_and_bid_steps.sql` after `20261015` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **Stages (admin Auctions page):** `AuctionService.stage_of` gives every auction one stage: `live`, `scheduled`, `awaiting_admin` (timer ended with bids, the administrator decides), `awaiting_pickup` (winner confirmed, waiting for payment and pickup), `completed` (paid and collected, stored as `fulfillment_status = 'collected'`), `forfeited`, `no_bids`, `cancelled`. A won auction is **not** "Sold": it is Awaiting pickup until **Complete auction**. **Confirm winner** only says who won (the winner is told to pay and collect). The page tabs are All, Live, Awaiting admin, Awaiting pickup, Scheduled, Completed, Closed without a sale, Archived.
- **Editing after the sale:** a lot that is awaiting the administrator or awaiting pickup can still have its title, description and photos edited (`_update_sold_lot`; prices, times and the winner are final, 409 otherwise). **Give the winner more time** (`POST /api/admin/auctions/<id>/extend-pickup`) resets `winner_notified_at` and clears the warning, so the 48h warning and 72h forfeit clocks restart, and tells the winner. Re-auction already worked from awaiting pickup.
- **Choosing the item:** `eligible_items()` lists every unclaimed item that has no open claim and no live auction, with `recommended = days >= 30`; the form marks younger items "Early". `create_auction` refuses an early item with 409 `early_auction` unless the request carries `allow_early: true` (the form shows a confirmation checkbox). Only the date rule can be overridden: an open claim or a live auction still blocks. The dashboard's "ready to auction" count and the Auctions "Ready to auction" tile count recommended items only.
- **Archive (`Server/app/utils/archive.py`, `POST /api/admin/archive {kind: lost|found|claim|auction, reference, archived}`):** hides a **finished** record from the working lists into the page's **Archived** tab and deletes nothing (not the Recycle bin). Finished means: lost report `returned/resolved/closed`; found report `returned/claimed/closed/collected`; claim `collected` or `rejected`; auction stage `completed/forfeited/no_bids/cancelled`. Any administrator may archive and restore. Live work can never be archived (409 `not_finished`). Admin list rows carry `archived`; archived rows are excluded from the working tabs and counts. A completed report stays in its owner's Completed tab, and the user Auction Hall is not affected. Before the migration every archive call answers 503 `setup_required`. Users, Smart Tags and Notifications have no Archive: accounts use suspend, tags use deactivate.
- **Exact bids:** valid bids sit on a ladder (the starting bid plus whole increments); `bid_step_problem` / `ladder_ceiling` in `auction_db.py`, the same rule in `auction_place_bid` (migration 20261016), and the bid form in `AuctionDetail.tsx` blocks off-step amounts. The Buy Now price is always allowed. A bid between two steps answers 409 `bid_not_on_step` with the next valid amount; `min_next_bid` is the first rung at or above "current price + increment".
- **ID verification:** an account is verified only by an administrator looking at the uploaded ID. The upload must be a real image or PDF (`Users/Backend/shared/uploads.has_valid_signature`, 400 `invalid_document`); approving needs `identity_checked: true` (400 `identity_check_required`) and the review screen has a "I opened the submitted ID and it matches" box; rejecting needs a reason. Unverified people who open a public report (Browse, Dashboard, search results) get a pop-up (`VerificationRequiredModal`, `useVerificationPrompt`) with a button to the Profile page, and the Found, Missing and Claim submit buttons open the same pop-up.
- **Photos:** `shared/PhotoSourceButtons.tsx` gives **Take photo** (camera) and **Upload photo** (gallery or files, or PDF for ID documents) on the found, lost, claim and profile ID forms. The found form no longer forces the camera.
- **Notifications to claim:** `get_user_notifications` adds `found_item_reference` (FP2031); the Submit-a-claim button passes the readable reference, not the internal id. Matches and Dashboard also pass the chosen lost report, which the claim form preselects.
- **Menu badges:** `GET /api/admin/nav-badges` (`Server/app/utils/admin_badges.py`) counts only work waiting for an administrator: claims waiting for review, ID verifications, Smart Tags awaiting approval, auctions awaiting the administrator's decision. Shown beside Claims and verification, Users, Smart tags and Auctions, refreshed every minute, on tab focus and after claim or verification changes. AI matching has no badge because its suggestions are computed on demand and nothing waits there for an approval.

## Report lifecycle, custody view and guard handover

Run `Server/manual_migrations/20261015_report_lifecycle_and_guard_handover.sql` after `20261014` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **One rule for "finished":** an item goes report -> custody -> claim or auction -> release. When it is released, every report about it is finished. Found reports end as `returned` (set by the claim status function, or by `AuctionService.set_fulfillment('collected')` for a sold item); lost reports end as `returned` too. People see `returned`, `resolved`, `closed` (and for found reports `claimed`, `collected`) as **Completed** (`Users/Frontend/src/app/utils/reportLifecycle.ts`, mirrored by `COMPLETED_MISSING` / `COMPLETED_FOUND` in `Server/app/utils/report_lifecycle.py`).
- **Who closes what** (`Server/app/utils/report_lifecycle.py`, `ReportLifecycle`; every call is idempotent and never raises, so a failure cannot undo a release): (1) the database trigger `close_reports_after_claim_collection` closes the claimant's lost report named in `claims.missing_report_id` or confirmed by an administrator as a match, and notifies its owner; (2) `complete_for_claim` (called by `SupabaseDB.update_claim_status` after `collected`, which covers the admin status button and the guard/admin Handover PIN release) repeats that without needing the trigger, and if nothing was linked closes the claimant's single best open lost report that is a **strong match (75%+)**, and tells the finder; (3) `complete_for_found_item` (admin sets a found item to `returned`) closes confirmed matches; (4) `complete_for_auction` (winner collected) finishes the found report and tells the finder; (5) `housekeeping.process_report_sync` re-checks claims collected in the last 60 days in the scheduled run, so anything missed is closed without notices. Notifications use `notification_type = 'report_completed'` and `link_page = 'my-reports'`, which opens My Reports on the Completed tab.
- **Claim form:** optional **Which of your lost reports is this?** (`POST /api/claims` field `missing_report_id` = `mpost_id`, must be the claimant's own open report, else 400 `invalid_missing_report`).
- **My Reports:** tabs All / Missing / Found show reports still in progress; **Completed** shows finished ones (read-only). `PUT/DELETE /api/found-items/<id>` and `/api/missing-items/<id>` refuse (409 `report_completed`) a completed report, and refuse deleting a found report that has claims or is in an auction (409 `report_in_use`). Matches and the Dashboard skip completed lost reports.
- **Admin Reports page** (`Admin/Frontend/src/pages/reports/`): one page with three tabs, **Lost reports** (the old Lost items page), **Found reports** (the old Found items page) and **Items in custody** (`CustodyView.tsx`). The old nav names are still accepted by `App.tsx` (`lost-items`, `found-items`, `items-in-custody` open the matching tab, and stored bookmarks keep working). The former "Reports and analytics" page is now called **Analytics**. `GET /api/admin/found-items/custody` (`Server/app/utils/custody.py`) returns every held item with a state (waiting for the owner, claim to review, approved and waiting for pickup, on hold, in auction, auction result to confirm, sold and waiting for pickup), days held, who received it and whether it is old enough to auction (30 days). It never returns who turned the item in.
- **Guards:** `PATCH /api/admin/users/<id>/access-level` now works for **administrators** when the change is between `user` and `guard`; making or changing an `admin` stays with super administrators, nobody changes themselves or a super administrator, and a suspended account cannot be promoted (the database function enforces the same). The Users page has one **Change role** action (`RoleModal.tsx`) instead of two hidden icons. `admin_update_claim_status` admits a guard **only** to record a collection (before migration 20261015 the database refused guards, so the release desk worked for admins only).
- **Handing an item to a specific guard:** `GET /api/found-items/guards` lists active guards (name only). The found form has **Which guard received it?** (or "Another guard (not listed)" to type a name); `POST /api/found-items` accepts `handover_guard_id`, stores the guard's own name in `guard_name_or_id`, and notifies the guard (in the app and by email). `GET /api/admin/claims/handover/assigned` lists the held items handed to a guard (a guard sees theirs, administrators see everyone's); it is shown on the guard's Release desk and on the new **Release desk** page in the admin console (same PIN screen as the guard's), available to administrators and super administrators.

## Recycle bin (Recycle bin page, super admin only)

Run `Server/manual_migrations/20261014_recycle_bin.sql` after `20261013`. Code: `Server/app/utils/recycle_bin.py`, `Admin/Backend/recycle_bin/routes.py`, `Admin/Backend/shared/authenticator.py`, `Admin/Frontend/src/pages/recycle-bin/RecycleBin.tsx`.

- **Archive first, delete second.** `delete_admin_claim`, `delete_admin_found_item`, `delete_admin_missing_item`, `delete_admin_user` (in `supabase_db.py`) and `AuctionService.delete_auction` call `RecycleBin.archive_entity` before the existing delete RPC. It stores a JSON snapshot of the record and everything the database cascade-deletes with it (`recycle_bin.snapshot`: a found item brings its claims and AI matches; an account brings its found items, lost reports, claims on them, and matches; an auction brings its bids, comments and hearts) and copies the files into the private bucket `recycle-bin`. If the copy fails nothing is deleted; if the delete then fails the archive is discarded. If the bin table is missing the delete is refused with 503 `setup_required`.
- **Not kept:** notifications, activity logs, authenticator secrets (never copied), and links the database sets to NULL when an account is deleted (Smart Tag ownership, auction winner or bidder links). Auction photos are not copied (they belong to the found item; the orphan cleaner may remove them).
- **Restore** (`POST /api/admin/recycle-bin/<id>/restore` with `{"confirmation": "CONFIRM"}`): checks nothing conflicts, puts the files back (never overwriting an existing file), inserts the rows parents first, then drops the snapshot. Refused with 409 when the same record exists again (`already_exists`), when the account or item it belongs to is gone (`parent_missing`), or when a reference was reused (`restore_conflict`, everything partly restored is undone). Claims by people who no longer exist, or bidders, are skipped or unlinked and reported. Restoring an account restores its password hash, so they can sign in again; they must set up their authenticator again if they were an admin.
- **Permanent delete** (`POST .../purge` with `CONFIRM` and `authenticator_code`): the entry is checked first, then the code is spent (`consume_authenticator_code`: not enabled 403, locked 423, wrong or reused 401), then the files and snapshot are removed, leaving a tombstone (what, when, who).
- **Expiry:** `RECYCLE_BIN_DAYS` (default 30, 1 to 365). `housekeeping.process_recycle_bin` purges expired entries in the scheduled run.
- **Retention rule now archives:** old ID documents and proof photos (`reason = 'retention'`, `entity_type = 'evidence'`) are copied here before they leave the claim or the verification record; restoring one attaches the files to the record again. Nothing is removed from the record if the copy fails.
- The list endpoint never returns snapshots (they contain password hashes and encrypted fields): only label, counts, who, when and days left.

## Sessions, guard role, reminders, retention, preferences and analytics ranges

Run `Server/manual_migrations/20261013_guard_role_reminders_and_retention.sql` after `20261012` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **Sessions (`Server/app/utils/auth.py`, `Users/Frontend/src/app/utils/sessionGuard.ts`, `Admin/Frontend/src/utils/sessionGuard.ts`):** `session_lifetime()` gives tokens 12 hours (users) or 8 hours (admin, super admin, guard); `JWTService.verify_token` also refuses any token older than that by its `iat`, so 30-day tokens issued before the limit stop working. The frontends sign out after 60 minutes (users) or 20 minutes (staff) without interaction, on load, on returning to the tab and every 15 seconds. Idle time counts from the later of the last interaction and the token's issue time, so a sign-in made this morning is never judged by last night's stamp. A 401 "Token has expired / Invalid token" from any API call ends the session at once (`watchForExpiredSessions`). Ending clears the user and admin copies of the sign-in (`ebalik_token`, `ebalik_user`, `ebalik_admin_token`, `ebalik_admin_user`) and the user site explains why (`ebalik_session_notice`). Keep the two `sessionGuard.ts` files identical.
- **Guard role:** `access_level = 'guard'`. `_require_admin(required_level='guard')` admits guard, admin and super admin and is used only by the Handover lookup and release routes; every other admin route refuses a guard (`required_level='admin'` and `'super_admin'` never include it). The admin app shows a guard only `pages/guard-desk/GuardDesk.tsx` (the PIN card with a QR scanner). A super admin assigns it in Users (`PATCH /api/admin/users/<id>/access-level`). Guards sign in through the normal staff login (no authenticator step: they can do nothing but release by PIN) and are not blocked by maintenance mode or the verification gate (`system_control.DESK_LEVELS`).
- **Scan-to-release:** the claimant's approved claim card shows the PIN and a QR code (`GET /api/claims/<id>/handover-qr`, owner only, never cached) containing `EBALIK-HANDOVER:<PIN>`; the guard's scanner (`ScanPinButton.tsx`, jsQR) fills the PIN and runs the same lookup. A scan never releases anything by itself.
- **Handover receipt:** releasing an item (by PIN or by marking the claim collected) emails the owner `send_handover_receipt_email`.
- **Pickup reminders and expiry (`Server/app/utils/housekeeping.py`):** approval sets `claims.pickup_deadline` (now plus `CLAIM_PICKUP_DAYS`, default 14). A reminder goes out `CLAIM_REMINDER_DAYS` (7) after approval (once, `pickup_reminder_sent_at`). At the deadline the claim is closed as `rejected` with the reason "Not collected by the pickup deadline", the PIN is wiped and the claimant is told; the item stays in custody. Approved claims that predate deadlines get a fresh deadline on first sight instead of being closed.
- **Smart Tag expiry reminders:** 30 days before `valid_until`, one email and one notification (`expiry_reminder_sent_at`, cleared on renewal). Renewing is done by staff, so the email tells the owner to visit the office.
- **Evidence retention:** ID documents and proof photos (`claim-id-documents`, `claim-proof-images`) leave the claim `EVIDENCE_RETENTION_DAYS` (default 30; `0` off) after it is collected or rejected; account verification documents the same after review. They are first copied into the recycle bin (see above), then removed; paths are cleared and `evidence_purged_at` set; a failure at any step leaves the record to retry. The bin then keeps them `RECYCLE_BIN_DAYS` more days. All of this waits for migrations 20261013 and 20261014. The public page is `/privacy` (`pages/privacy/PrivacyPage.tsx`; keep its numbers in step with the settings).
- **Email preferences (`Server/app/utils/email_prefs.py`, `Users/Backend/email_prefs/routes.py`):** `user_profiles.email_preferences` has two optional categories, `reminders` (pickup and Smart Tag reminders) and `announcements` (admin broadcasts); everything else is always sent. `GET|PUT /api/email/preferences` (signed in) feeds the Profile card; optional emails carry a signed unsubscribe link and `List-Unsubscribe` headers; `/api/email/unsubscribe` shows a confirm button on GET and applies on POST (so a mail scanner opening the link changes nothing). The link base is `PUBLIC_API_URL` or Render's `RENDER_EXTERNAL_URL`.
- **Scheduler:** now also runs `housekeeping.run_housekeeping`. It is **on by default in production only**; locally `SCHEDULER_ENABLED=true` is needed, because a developer machine usually points at the live database.
- **Analytics ranges and hotspots:** `GET /api/admin/dashboard/analytics?range=30d|90d|12m|all` or `?start=&end=` (400 on bad dates); `hotspots` merges lost and found locations (top 8). The dashboard section has range chips, a custom range, CSV export (formula-safe) and a printable report (browser "Save as PDF").
- **Auctions ready to list:** `GET /api/admin/auctions/eligible-items?summary=1` returns `{count, oldest_days}`; the dashboard shows "Items ready to auction".

## Handover PINs, premium emails, auction deadlines and dashboard analytics

Run `Server/manual_migrations/20261012_handover_pins_and_auction_timeouts.sql` after `20261011` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **Handover PIN (`Server/app/utils/handover.py`):** approving a claim (`PATCH /api/admin/claims/<id>/status` with `approved_for_pickup`) draws a 6 character PIN from a 31-symbol alphabet without look-alikes (no 0, O, 1, I, L). The row stores `handover_pin_hash` (HMAC with the app key, used for lookup; unique) and `handover_pin_encrypted` (AES-GCM, so the owner can read it again); the plain PIN exists only in the email and the owner's own claim card (`get_claims_by_account` adds `handover_pin` for approved claims). The admin API never returns a PIN. The guard types it on the Admin Dashboard (`pages/dashboard/HandoverPinCard.tsx`): `POST /api/admin/claims/handover/lookup` shows claimant name, campus ID, item and claim reference; `POST .../release` calls the same `admin_update_claim_status('collected')` function as the claims page (claim `collected`, found item `returned`) and clears the PIN, so a used PIN never works twice. Both are admin or super admin only and rate limited to 12 tries a minute per admin. `POST /api/admin/claims/<id>/handover-pin` creates a fresh PIN for an approved claim (claims approved before PINs existed, or a lost email) and re-sends the approval email. A PIN failure never undoes an approval: the response carries `handover_pin_issued` and `approval_email_sent`.
- **Premium emails (`Server/app/utils/email_templates.py`):** one layout for every message: navy page and glass-style card, UMak seal and wordmark header, gold hairline, large PIN/code panel, a large gold button, reassurance notes and a footer, built from tables and inline styles with `bgcolor` fallbacks so it works in Outlook and Gmail. `render_email()` returns HTML plus a plain-text part, and escapes every value. `EmailService` now sends OTP (registration and reset), welcome, claim approved (`send_claim_approved_email`), announcement, test, and every `send_reference_email` message (claims received, reports, Smart Tags, AI matches, auctions) through it; `send_notice_email` is the generic sender. The logo and buttons use `PUBLIC_SITE_URL`.
- **Auction deadlines (`AuctionService.process_overdue_pickups`):** the clock starts at `winner_notified_at` (a resend of the winner email does not restart it). After 48 hours with no pickup the winner gets a 24-hour final warning (in-app plus email, once, `pickup_warning_sent_at`). After 72 hours the win is forfeited automatically: `fulfillment_status = forfeited`, `auto_forfeited_at`, the item returns to `unclaimed`, the winner gets `bidding_banned_until = now + 30 days` (staff are never banned), is told by notification and email, and every admin gets an in-app notification and an email "Ready for Re-Auction". The ban is enforced in `AuctionService.place_bid` (403 `bidding_banned`, also covers Buy Now). The admin Auctions page marks such auctions "Ready for re-auction" (`reauction_ready`, stat `reauction_ready`, a Dashboard work-queue row), and `reauction()` accepts them without another forfeit; each can be listed again once.
- **Scheduler (`Server/app/utils/scheduler.py`):** an in-process timer thread (every `SCHEDULER_INTERVAL_MINUTES`, default 15; on by default in production and OFF in development (a laptop pointed at the live database must never run these jobs by accident), override with `SCHEDULER_ENABLED=true|false`; off in tests), `POST /api/cron/run` with header `X-Cron-Secret` (503 until `CRON_SECRET` is set; exempt from maintenance mode), and `python Server/scripts/run_cron.py`. A free Render service sleeps when idle, so use the HTTP trigger from an outside timer for reliability (`DEPLOYMENT_GUIDE.md`). Steps claim their rows with conditional updates, so overlapping runs never double-send.
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

## Naming, handover log, receipts, daily summary, startup checks and the migration log

Run `Server/manual_migrations/20261017_custody_log_receipts_and_migration_log.sql` after `20261016` (the code degrades without it, see `Server/DATABASE_SETUP.md`). The word list is `docs/STATUS_GLOSSARY.md`: **Completed** is the one word for a finished report, claim or auction everywhere people read; the database keeps `returned` / `collected`.

- **Handover log (`Server/app/utils/custody_log.py`, table `custody_log`):** one row per fact about a found item: `turned_over` (finder submits), `registered` (office registers), `received` (guard confirms), `tag_matched`, `claim_filed/approved/rejected/expired`, `released`, `completed`, `auction_listed/confirmed/cancelled/completed/forfeited`, `returned_to_custody`. `record()` never raises, so a missing table can never block the action it describes. `timeline(client, reference)` returns `{item, events}` oldest first and **rebuilds** turned over, received, claim filed/approved/rejected and released from timestamps already stored when the log has no event of that kind, so items from before the log have a history too. Shown by `GET /api/admin/found-items/<reference>/history` and the **History** button on each row of Reports > Items in custody (`CustodyHistoryModal.tsx`, with Print or save as PDF). This replaced the Chain of custody page, whose timeline was invented from the item row; the old `chain-of-custody` bookmark opens the Items in custody tab. `custody_log` rows are captured and restored by the Recycle bin with their found item.
- **Guard receipts:** `POST /api/admin/claims/handover/received {reference}` (guard level). A guard confirms only items handed to **them**; administrators can confirm any. Sets `found_items.received_at/received_by` once (a second call answers `already: true` and tells nobody again), logs `received` and notifies the finder (`guard_received`). The guard's Release desk shows **Mark received** or a Received chip (`AssignedItemsCard.tsx`) and a **New notices** card (`GuardNoticesCard.tsx`) reading `/api/notifications`, so the "an item was handed to you" notice reaches a role that has no other page. Items still unconfirmed show "Not confirmed yet" in Items in custody and are counted in the summary (`awaitingReceipt`). `PATCH /api/notifications/<id>/read` now only changes the signed-in person's own notice (404 otherwise).
- **Smart Tag match:** Reports > Found reports > Register has an optional **Smart Tag code**. `POST /api/admin/found-items` validates the code before saving (400 not a tag, 404 unknown), stores `found_items.smart_tag_id`, tells the owner in the app and by email (`SmartTagService.link_found_item`, notification `smart_tag_found`, link to Claims) and logs `tag_matched`. A tag that is not active still registers the item and answers `smart_tag_owner_notified: false`.
- **Claims and auctions:** approving a claim (`PATCH /api/admin/claims/<id>/status`) cancels every open auction of that item (`AuctionService.cancel_open_for_item`; the leading bidder is told, the log records it) and answers `cancelled_auctions`. The claims list carries `inAuction` (the approve dialog warns first), the auction list carries `pending_claim` (a chip, and a warning before **Confirm winner**), and `POST /api/claims` answers `auction_notice` so the claimant knows the item is in an auction. Nothing is auto-rejected: a claim and an auction can coexist until an administrator decides. `GET /api/admin/auctions` is a pure read now (the scheduler settles ended auctions every 15 minutes, and **Confirm winner** settles first).
- **Stale claims and the daily summary (`Server/app/utils/admin_digest.py`):** a claim waiting 7 days (`CLAIM_REVIEW_STALE_DAYS` in `custody.py`) is flagged in Items in custody (`claimWaitingDays`, `claimOverdue`). Each morning (`ADMIN_DIGEST_HOUR`, default 8, Makati time) the scheduler emails active administrators what is waiting (claims, IDs, tags, auction results, approved claims expiring in 3 days, items a guard has not confirmed for 2 days, items old enough to auction). It is sent at most once per Makati day (the day is claimed by inserting `system_settings.admin_digest:<date>`, unique), only when something is waiting, and only to administrators who have not turned it off (Admin profile > Daily summary email, stored as `email_preferences.admin_digest`, a staff-only preference outside the user's own list).
- **Analytics:** the Analytics page now holds the summary cards and the visual charts (the Dashboard keeps a link card). All of it counts days in **Philippine time** (`Server/app/utils/localtime.py`: a plain date stays, a timestamp is converted from UTC, so a report filed at 18:30 UTC on the 1st is the 2nd in Makati).
- **Startup checks (`Server/app/utils/startup_checks.py`):** a production server (`FLASK_ENV=production`, not testing) refuses to start without `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET_KEY` (not the development default, at least 24 characters), `APP_ENCRYPTION_KEY` and `CORS_ORIGINS`, and lists every problem in the error. `ALLOW_INSECURE_START=true` is an emergency override that logs a critical warning instead; remove it once the settings are fixed.
- **Complete list reads (`Server/app/utils/paging.py`):** Supabase silently returns at most 1000 rows per request, so the admin claim list (and other full-table reads) page with `.range()` up to `ADMIN_LIST_MAX` (default 10000, minimum 1000) instead of hiding older rows.
- **Migration log (`Server/app/utils/migrations.py`, table `migration_log`):** every migration file ends with `INSERT INTO public.migration_log ... ON CONFLICT DO NOTHING`; 20261017 creates the table and records the older files from what the database already contains. System control > health check compares the log with `Server/manual_migrations/*.sql` and warns about a forgotten migration.
- **AI matching and status:** confirming a match sets the lost report to `found` (never reopens a completed one); rejecting a match that was confirmed earlier supersedes the old confirmation and returns the report to `missing` unless another match is still confirmed. A lost report an administrator completes by hand notifies its owner (`notify_completed_by_hand`).

## Round 2: guards as users, auction pickup PIN, Smart Tag contact methods, health check

Run `Server/manual_migrations/20261018_auction_handover_pin.sql` and then `20261019_tag_contact_links.sql` after `20261017` (the code degrades without them, see `Server/DATABASE_SETUP.md`).

- **Guards are also users.** A guard signing in lands on the **Release desk** (`/admin/`, `GuardDesk.tsx`), whose header has **Report or browse items** (opens the user app with the same sign-in). The user app's menu has **Release desk** for guards and **Admin console** for administrators (`UserHeader.tsx`). `isDesk()` in `Users/Frontend/src/app/utils/system.ts` (admin, super admin, guard) is what "never needs ID verification" and "keeps working in maintenance mode" mean in the user app; `isStaff()` stays admin-only. The server agrees (`DESK_LEVELS` in `system_control.py`): the verification gate and maintenance lock skip guards, so a guard can file a found report like anyone. The profile shows no "Not verified yet" banner to guards or administrators.
- **Force logout includes guards.** `enforce_request` now exempts only administrators and super administrators (`STAFF_LEVELS`) from the sign-out cut-off; guards (and users) with a session older than `sessions_valid_after` get 401 `session_revoked`. A guard can also be suspended, and a suspended guard cannot sign in. Both apps' `EXPIRED_MESSAGE` now recognises "session was ended by an administrator", so an open guard desk is sent to the sign-in page. The user app's sign-out also clears the staff copy of the token.
- **Auction pickup PIN.** A winner waiting to collect gets a 6 character Handover PIN exactly like an approved claim (`auctions.handover_pin_hash/encrypted/issued_at`, `HandoverService.issue_for_auction`). It is created when the winner is notified (`AuctionService._send_winner_notice`), emailed with the winner email, and shown to the winner in the Auction Hall with a QR code (`viewer.handover_pin`, `GET /api/auctions/<id>/handover-qr`). The guard types or scans it into the same release-desk box: `HandoverService.find` looks among approved claims first and then among auctions waiting for pickup (a PIN never exists in both: each side redraws on a clash) and shows the winner, their campus ID, the item and **the amount to collect**; releasing completes the auction through `set_fulfillment('collected')` (the found report becomes Completed, the finder is told, the handover log records it) and forgets the PIN. **Manual override:** **Mark as picked up** on every Awaiting pickup row of the Auctions page (and in the auction dialog) completes the auction without a PIN, administrators and super administrators only (`POST /api/admin/auctions/<id>/fulfillment`; a guard gets 403). **Send PIN / New PIN** (`POST /api/admin/auctions/<id>/handover-pin`) creates a fresh PIN for a win that never got one and emails it; the list says whether the winner has one. Before the migration a sale simply has no PIN and is completed by hand.
- **Smart Tag contact methods.** Profile > **Smart Tags** (`SmartTagSettings.tsx`) saves up to six contact methods once (`user_profiles.tag_contacts`: alternate phone, Messenger, Facebook, Instagram, Telegram, WhatsApp; `GET/PUT /api/tags/contacts`) and embeds the owner's tag list. In a tag's edit form (`TagDetailsForm.tsx`) the owner switches on, tag by tag, which saved methods a finder sees (`smart_tags.shown_contacts`). Values are validated and every link is **built by the server** from the username (`contact_url` in `smart_tags.py`: only `https://m.me/`, `facebook.com`, `instagram.com`, `t.me`, `wa.me` and `tel:`), never copied from user text; the public scan page renders only `https` and `tel` links (`safeLink`). Nothing is shown unless switched on; deleting a saved method removes it from the tags that showed it. **(Round 6:** the settings now open in a window from Profile, `shared/tags/SmartTagContactModal.tsx`, and email and X were added; see "Round 6" below.)
- **System control health check crash.** The suspensions check returns status `info`, which the page did not know, so the whole app unmounted ("plain blue" screen) whenever a suspended account existed. `HEALTH_LOOK` now has `info` and falls back to the warning look for any unknown status. `components/PageErrorBoundary.tsx` wraps every admin page, so a render error in one page shows a message with **Try again** while the menu and header keep working.
- **Admin logo.** `src/imports/UMak Logo.png` was renamed to `umak-logo.png`: a file name with a space is served as `UMak%20Logo-hash.png`, which the static host did not match, so the `/admin/:path*` rewrite answered with the page instead of the image.

## Round 3: code abuse limits, the home feed, comments and reactions

Run `Server/manual_migrations/20261020_otp_attempts.sql` and `20261021_report_comments_and_reactions.sql` after `20261019` (the code degrades without them, see `Server/DATABASE_SETUP.md`).

- **One-time codes (`Server/app/utils/otp_guard.py`, `Users/Backend/home/routes.py`).** Register, forgot password and the new `POST /api/auth/resend-otp {email, type: registration|password_reset}` share these rules, all answered as `429 {error, code, retry_after}` with a `Retry-After` header: a **60 second cooldown** per email and **5 codes per email per 24 hours** (both counted from `otp_tokens`, so every server and every restart agrees; a database that cannot be read falls back to an in-memory limiter), a burst limit of **12 code requests per 10 minutes per network address**, and **disposable email domains refused** for registration (400 `disposable_email`; the list is `DISPOSABLE_DOMAINS` in `otp_guard.py`, subdomains count). A new code retires every older unused code (`SupabaseDB.invalidate_otps`), and a code that could not be emailed is removed again (`discard_otp`) so a mail problem never uses up the daily limit. **Five wrong guesses retire the code** (`register_failure`: counted in `otp_tokens.attempts`, or in memory until migration 20261020 is run; the answer says how many attempts are left, the fifth is 429 `otp_locked` and the person must ask for a new code), on `verify-otp` and `reset-password`; the comparison is constant time and there is a per-address guess limit. Password reset answers identically whether or not the account exists: its cooldown and daily limit are kept per email in memory, and the database-counted daily limit only decides whether a code is sent, never what is said. `OTPModal.tsx` has a working **Resend** button with a live countdown (`Resend in 0:42`, hours for the daily limit), shows the server's message, resets the 10 minute expiry and clears the box when a new code arrives; `useAuth().resendOtp` and `authApi.resendOtp` call the route. The unverified-account gate is unchanged.
- **Feed backend (`Server/app/utils/report_social.py`, `Users/Backend/feed/routes.py`, `/api/feed`).** `GET /api/feed?kind=all|found|missing&limit&before` returns open reports (found: `unclaimed`, missing: `missing`) newest first with only the fields already public on the lists (no reporter name, email, campus ID, contact details or internal ids), comment and helpful counts, whether you reacted, and the last two comments; the first page also carries `stories` (open reports from the last 7 days that people need back fast: category Documents & Cards, Electronics, Keys or Valuables, or a name with wallet, ID, phone, laptop, key and similar) and `counts`. `GET/POST /api/feed/<kind>/<reference>/comments`, `DELETE /api/feed/comments/<id>` (your own only), `PUT/DELETE /api/feed/<kind>/<reference>/reaction` ("helpful", one per person, idempotent). A commenter shows as "First name + last initial". Rules: up to 500 characters of plain text (angle brackets removed), foul language refused (the same filter as auctions), **email addresses and phone numbers refused** (contact goes through a claim or a Smart Tag), the same comment twice within a minute refused, comments and reactions only on **open** reports (taking your reaction back always works), 5 comments per minute and 40 per hour and 40 reactions per minute per account, and posting or reacting needs a **verified account** (`VERIFICATION_GATED`; reading does not). The report's owner gets an in-app notice for a comment by someone else (at most 3 per report per hour). `PATCH /api/admin/report-comments/<id> {hidden}` hides or restores a comment (admins; there is no admin screen for it yet). Tables `report_comments` and `report_reactions` point at exactly one report (found or missing) and are deleted with it; before migration 20261021 the feed still loads with zero counts and comment or reaction requests answer 503 `setup_required`.
- **Home page (`Users/Frontend/src/app/pages/dashboard/Dashboard.tsx` and `dashboard/feed/`).** A three column feed in the Gallery Glass look: left, a profile snippet (name, verified state, campus ID) and campus shortcuts (`LeftRail.tsx`); centre, the item search, the "What did you find or lose?" composer (`ComposerCard.tsx`), the urgent stories bar (`StoriesBar.tsx`), the possible-matches nudge, All / Found / Missing / Auctions tabs, and the post cards (reports and live auctions mixed by time) (`PostCard.tsx`: photo, Helpful, Comment, comment thread with "View all", delete your own comment, and the action that fits: **This is mine** for found items, **See matches** for your own missing report, **I found this** for someone else's); right (`RightRail.tsx`), the Lost and Found Office (hours, place, hotline, email), urgent bulletins (the campus announcement, urgent count, campus numbers) and safety tips. Below the `xl` breakpoint the right column becomes a compact office card inside the feed column and the left column is hidden (the app menu already has the shortcuts). Opening a photo needs a verified account as before. The office text is in `dashboard/feed/officeInfo.ts`: the address and the hotline are the ones already used in the claim screens; **the opening hours are a placeholder** until `VITE_OFFICE_HOURS` is set.

## Round 4: typed-text checks, the notification menu, phone polish

No migration. Nothing here changes the database.

- **Text checks (`Server/app/utils/text_guard.py`, browser copy `Users/Frontend/src/app/utils/textGuard.ts`).** Every free text goes through `clean_field(value, kind, field, label, required)` on the server: tags and `<script>`/`<style>` blocks are stripped (entities are decoded first so an escaped tag cannot slip through), spaces are tidied, a length for the kind of field is enforced, keyboard mash and spam are refused, then foul language (`app.utils.profanity`). A refusal raises `TextRejected` (deliberately **not** a `ValueError`, because several routes turn `ValueError` into a 401) and the route answers `400 {error, code: invalid_text | profanity, field}`; `field` is the form field so the browser can mark it. Kinds and lengths: `title` 3 to 120, `description` 15 to 1000, `place` 3 to 150, `marks` 3 to 500, `reason` 15 to 1000, `comment` 2 to 500, `name` 2 to 60 (letters, spaces, hyphens, apostrophes, dots). The mash rules look at patterns only, never at word lists, so real items are not refused: five of one letter in a row, eight of one digit, a two or three letter chunk repeated four times, five keys in a row from a keyboard row (forward or backward), a word of six or more letters with no vowel (y counts), six consonants in a row, one word four times in a row, text made of two or fewer different letters. A description or reason also needs at least half of its characters to be letters.
- **Where it is applied.** Found report (`item_name`, `location`, `turnover_location`, `description` optional but 15+ when given, the typed guard name is only stripped and capped at 80), missing report (`item_name`, `description`, `distinctive_marks` optional, `last_location`), claim (`claim_reason`), report edits in My Reports (only the fields that were sent), profile save and registration (`fname`, `mname` optional, `lname`; checked before a code is emailed), report comments (`report_social.clean_comment` keeps its messages, codes `profanity` and `contact_details`, and adds `invalid_text`, status 422) and auction comments (`auction_db.add_comment`, same). The found form joins description and marks into one `description`, so it is checked in the browser as parts and by the server as a whole (1000 characters together).
- **Browser hints.** `shared/forms/FieldHint.tsx` (`useFieldHint`, `FieldHint`, `focusFirstInvalid`) and `shared/forms/NameField.tsx`. A hint appears when the person leaves the field, or at once when the text looks like random typing; "too short" is never shown while they are still writing. After a failed submit every hint shows, the page scrolls to the first bad field and the form's own error banner repeats the message. Foul language is now checked in the browser too (round 5, below), so the warning appears while typing. `Server/tests/text_guard_cases.json` holds cases both sides must agree on: `Server/tests/test_text_guard.py` runs them in Python and `node scripts/check-text-guard-parity.mjs` runs them against the TypeScript copy. When a rule changes, change both files and the cases.
- **Notification menu (`Users/Frontend/src/app/shared/NotificationMenu.tsx`, used by `UserHeader.tsx`).** The bell toggles a glass menu instead of opening the page: "Notifications" with a count of new ones and **Mark all as read**, an All / Unread switch, the latest 20 notices with a kind icon (claim, auction, match, Smart Tag, verification, rejection, report, announcement), unread dot and tint, relative time ("5m ago"), and **View full notifications** which opens the page (the page is unchanged). Clicking a notice marks it read and goes where the notice points (`utils/notifications.ts` `notificationTarget`, shared with the page). It closes on an outside press, Escape (focus returns to the bell), and when the page changes. Marking all is optimistic and put back with a message if the server fails. New API: `POST` (or `PATCH`) `/api/notifications/read-all` changes only the signed-in person's unread notices and answers `{updated, unreadCount: 0}` (`SupabaseDB.mark_all_notifications_as_read`, `notificationsAPI.markAllAsRead`). The unread badge still refreshes through the `ebalik-user-notifications-updated` event.
- **Phone polish.** The menu spans the screen under the header on phones and stops above the bottom bar (`100dvh` minus the bar and the safe areas), a popover under the bell from `sm`; its list scrolls on its own (`overscroll-contain`). Header and bottom bar respect the left and right safe areas (landscape notch). The item viewer uses `dvh`, scrolls on its own and keeps its action bar above the home indicator. Touch targets on the feed (comment box, send, delete, tabs, refresh) and the menu are 44px on phones.

## Round 5: social post cards, one profanity filter, the polished home page

No migration. One new read route, nothing written to the database.

- **Post cards (`pages/dashboard/feed/PostCard.tsx`).** Header: avatar, poster, a clock with the relative time, and a status badge ("In custody" for found items, "Still missing" for lost ones). The poster is never named: found items are posted by the **Custody Desk** (shield avatar, verified tick), missing reports by a **Verified member**, and your own shows "You" with your initials; no reporter name, email or campus ID is added to the feed. Body: title, description (See more), chips for place, date, category and the reference, then the photo. Action bar: **Helpful** (active state glows gold, the count is a badge on its icon), **Comment** (count badge), **Share**, and below it the one action that fits the report (**This is mine**, **See matches**, **I found this**). Comments are bubbles with a coloured avatar, name, a "You" pill on your own, time ago and Delete (with a Keep/Delete confirmation); the comment box has the send button inside it.
- **Share and shared links.** Share copies `<site>/?report=FP1001` and shows a toast (`shared/toast/toastStore.ts`, `ToastHost.tsx`, mounted in `App.tsx`; `showToast(message, tone)` works from anywhere). `utils/shareReport.ts` holds the link, the copy (Clipboard API with a hidden-box fallback; when both are blocked the toast shows the link) and `kindOfReference` (FP = found, MP = missing). `Dashboard.tsx` reads `?report=` once, removes it from the address bar and shows that report at the top of the feed as "Shared with you" (dismissable). Signing in first and arriving afterwards still works because the reference is kept until the page has tried to open it. New route `GET /api/feed/<kind>/<reference>` (`ReportSocial.post`) returns one **open** report as a feed post (404 unknown, 409 closed, same fields as the feed).
- **One profanity filter.** The word lists are in `Server/app/utils/profanity_terms.json` (English and Filipino), read by `app/utils/profanity.py` and by the browser (`Users/Frontend/src/app/utils/profanity.ts`, the same steps: letter swaps, repeated letters, spaced-out letters, joined words). Every refusal uses one sentence, `PROFANITY_MESSAGE`: "Please rewrite respectfully. Inappropriate language is not permitted." (server codes `profanity`; the browser shows it live under the field, before submit, through `utils/textGuard.ts`). It covers every comment (feed and auction) and every report field (title, description, place, marks, claim explanation, names, and the typed guard name). `Server/tests/profanity_cases.json` holds the shared cases; `node scripts/check-text-guard-parity.mjs` bundles the two browser files with esbuild and checks them against both case files. To add a word, edit the JSON only.
- **Auctions in the home feed (`dashboard/feed/AuctionFeedCard.tsx`).** The old "Live auctions" shelf is gone (`AuctionShelf.tsx` deleted); live auctions are posts in the same feed. In **All posts** they sit between the reports by the time they opened; while more reports are still to load, only auctions newer than the oldest loaded report are mixed in, so nothing jumps in front of reports that are not shown yet. A fourth tab, **Auctions** (with the live count; hidden until the auction migration has run), shows only auctions and ends with "Open the Auction Hall". The card has the same layout as a report post: header (UMak seal, "Auction Hall" with an official tick, time since it opened, lot number, a "Live auction" badge), title, description, chips (place, category, Buy Now), the photos (`Gallery`, swipeable) with the closing clock on them, a bid panel (current or starting bid, leader alias, bid count, next bid), then **Watch** (the existing heart, `useWatchlist`, count badge), **Comment** and **Share**, and the step that fits: **Place a bid**, **You were outbid** (bid again) or **You're leading**. Bidding, the bid list and the comments open in the existing `AuctionDetail` window (`focus="comments"` for Comment), so bids, anti-snipe, Buy Now, the verification gate and the `Bidder_XXX` aliases all work as before; the card only shows state and never names a person. Share copies `/?auction=<id>`; `Dashboard.tsx` reads it once, cleans the address bar and opens that auction (a closed or unknown one shows a toast). Shared pieces for both cards live in `feed/postParts.tsx` (`ACTION`, `CountBadge`, `PrimaryAction`, `Chip`). No backend change: it uses `GET /api/auctions`, `/api/auctions/<id>`, `/watching` and `/reaction` as the Auction Hall does.
- **Home page.** `feed/feedStyle.ts` gives every card the same frosted-glass look (`FEED_CARD`, `FEED_CARD_LIFT`, `GOLD_GRADIENT`, `NAVY_GRADIENT`); the search bar, composer, stories, tabs, post cards and both side columns use it. The composer has icon chips (I found, I lost, Browse all). Stories have gradient-ringed icons, a count and hover zoom. The feed tabs use a sliding pill. A layout fix: the middle column is `min-w-0` inside a `minmax(0,1fr)` grid, because the horizontally scrolling stories row used to be able to widen the phone layout beyond the screen.

## Round 6: two-row header, premium Auction Hall, Smart Tag settings window, My Smart Tags and the scan page

No migration (the new settings live in the existing `user_profiles.tag_contacts` JSON column).

- **Header (`shared/UserHeader.tsx`).** From 1024 px the header has two rows: the brand and the actions (Report item, theme, the bell menu, the account menu), then a pages strip with the seven links as icon + label tabs. The open page has a navy fill and a gold underline that slide between tabs (`motion` layout ids `user-nav-active` and `user-nav-underline`). Between 1024 and 1280 px the strip scrolls sideways with soft edges and keeps the open tab in view; above 1280 px it is centred. Phones and tablets keep the one-row header, the drawer and the bottom bar. The header is 118 px tall on desktop and 64 px below: `--app-header-h` in `styles/theme.css`, used by every sticky toolbar (`top-[calc(var(--app-header-h)+12px+env(safe-area-inset-top))]`) and the Dashboard and Auction Hall side columns. Change both together. The sliding indicators use the gradient `#2e4687 -> #1f3160`, because the dark theme turns the button gradient `#2b4282 -> #1f3160` gold for primary actions (white text on gold otherwise).
- **Auction Hall (`pages/auction-hall/`).** Hero on a `#0e1830 -> #1f3160` gradient with a slow gold glow, "University of Makati · Lost & Found" and "Auction Hall", live count, sold count and the next closing time. Dark control bar (tabs, search, watched filter). Live lots are a 2-column grid of dark cards (`AuctionPost.tsx`): photos with a LIVE / ENDING SOON (under 1 hour) / ENDED ribbon and the heart, the highest bid in gold numerals, the bid count and a ticking clock, then two tabs. **Place bid** is `shared/auction/QuickBid.tsx`: the same rules as the lot window (exact steps with the nearest valid bid, Buy Now left to the lot window, a binding-bid confirmation, the same result messages); unverified accounts get "Verify my account" instead; the leader sees "You have the highest bid". **Comments** is `shared/auction/InlineComments.tsx`: the latest 3 comments loaded on first open, a box with the live text checks, and "View all" to the lot window. Empty Live tab: an illustration and buttons to upcoming lots and past results. The aside (Ending soon, How bidding works) sits beside the grid from 1280 px and below it otherwise.
- **Smart Tag contact settings (`shared/tags/SmartTagContactModal.tsx`).** Profile shows one card button (`SmartTagContactCard`, with a summary of what is saved) instead of the inline block; `SmartTagSettings.tsx` was removed. The window has a preview of what a finder sees, the name taken from the profile with **Show my full name / Show initials only**, the contact methods (phone, **email (new)**, Facebook, Messenger, **X (new)**, and under "More ways" Instagram, Telegram, WhatsApp), and preferences: notification sound (this device, `utils/notificationSound.ts`, a short Web Audio chime when the unread count goes up, off by default), the language of your tag page (English or Filipino) and the theme (Light, Dark, System; `useThemePreference` in `utils/theme.ts`, System follows the device). Saving is optimistic for the Profile card, rolls back on a refusal and shows a toast. Server: `CONTACT_LABELS` gains `email` (validated, `mailto:` built by the server) and `twitter` (handle, `https://x.com/<handle>`); `name_display` (`full | initials`) and `language` (`en | fil`) are stored in the same JSON as reserved keys, never returned as contact methods, and saved in the same request (`PUT /api/tags/contacts {..., settings: {...}}`; `GET` returns `{contacts, settings}`). The scan page shows initials (`M. S.`) when chosen and returns `language`. The Name is read-only (from the profile) on purpose, so a tag cannot show a made-up name.
- **My Smart Tags (`pages/my-tags/MyTagsPage.tsx`, `shared/tags/MyTags.tsx`).** Hero with the stats on a slowly turning gold ring and a 3-step guide (Register, Stick, Get notified). The tags are a card grid with the tag's own QR code (`GET /api/tags/<code>/qr`, owner only, never cached; `ownerQrUrl` in `utils/tags.ts` fetches it once per visit), the code, the item name or "Unnamed", a colour-coded status (Active, Lost, Expired, Awaiting approval, Disabled) and the days left; filters All / Active / Lost / Expiring (30 days) / Expired. **Manage** opens one window with the large QR, Download QR, Copy link, the tag's state and every action (Mark as lost / I found it, Edit details, Add or retake photo). No tags yet: an illustration, the 3 steps and "Register your first tag". Phones get a floating Register button above the bottom bar.
- **Scan page (`pages/tag/TagPage.tsx`).** Full screen on a `#0e1830 -> #1f3160` gradient, no app header or menu, a centred glass card (max 28 rem): the E-Balik logo and a Smart Tag badge, the owner's initials in a gold ring (or an icon), "This item belongs to" with the name the owner shares (or "A verified UMak member"), Active or Lost, the item and photo, the ways to reach the owner as large buttons (Call, Email, Message, Facebook, X, and Instagram, Telegram, WhatsApp when shared) that fade in one after another, and "I found this item". After the owner is notified the finder sees the guard-post steps and **Log in or register** (or **File a found report** when signed in). Only `https`, `tel` and plain `mailto` links are ever rendered (`safeLink`). The finder's view is in English or Filipino as the owner chose (the guard-post steps from the server stay English). Footer: "Powered by E-Balik · University of Makati".
- **NFC and RFID:** `docs/NFC_RFID_FEASIBILITY.md` (recommendation: NTAG213 NFC stickers carrying the same tag link, locked read-only; UHF RFID later, for the office's own inventory).

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

Tables added by migrations rather than the base schema include `auctions`, `auction_bids`, `auction_comments`, `auction_reactions`, `smart_tags`, `system_settings`, `recycle_bin`, `custody_log` and `migration_log`. Found items also carry `handover_guard_id`, `received_at`, `received_by` and `smart_tag_id`.

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


- Add reverse matching for a user's found reports and possible missing owners.
- AI match suggestions are still computed on demand; only the administrator's confirm or reject is stored (`ai_matches`).
- The user app still has about 120 pre-existing TypeScript errors (mostly untyped API responses). `npm run build` passes because Vite does not type-check; reduce the count before adding a type-check step to CI.
- `ReportsAnalytics` and `AnalyticsSection` are two components inside one Analytics page with two data calls; merge them into one when the analytics endpoints are next touched.
- Add system-wide public missing-report endpoint if Dashboard should show all users' missing reports rather than the current user's reports.
- Add automated tests for image upload, carousel rotation, modal flows, edit confirmation, delete confirmation, and match navigation.
- Consider React Router when browser back/forward and deep links become important.
- Update `docs/DATABASE_SCHEMA.txt` to match the canonical SQL schema.

## Round 7: report dates, one dialog design, income tracking

Run `Server/manual_migrations/20261022_income_ledger.sql` (the code degrades without it, see `Server/DATABASE_SETUP.md`).

- **Report dates (`Server/app/utils/report_dates.py`, `Users/Frontend/src/app/utils/reportDates.ts`).** A lost or found report date must be a real day, not after today and not more than a year back, judged by the campus day (Manila, UTC+8). Enforced on user create (`found_item`, `missing_item`), user edit (`my_reports`, through `TextRejected` with `field` and code `invalid_date`), and admin create and edit (`lost_items`, `found_items`, 400 `invalid_date`). The forms use `shared/forms/DateField.tsx` (picker capped with `min`/`max`, message under the field); the admin forms cap the picker at the campus day.
- **Dialogs.** Every dialog panel carries `ui-modal-panel` (user) or `admin-modal-panel` (admin) and gets the same signature from CSS in both `theme.css` files: a gold hairline across the top, inner edge, deep shadow, ruled header (`ui-modal-header--ruled`), ringed tone icon (`ui-modal-icon`), glass close button (`ui-modal-close`) and a raised footer (`ui-modal-footer`, buttons at least 46 px). The header wash follows the tone (a danger dialog is never gold). `Modal.tsx`, `AdminModal.tsx`, both `InfoModalHost.tsx`, `ConfirmActionDialog.tsx`, the OTP and login dialogs and the auction detail use it; the admin panel slides up on phones.
- **Income (`Server/app/utils/income.py`, table `income_ledger`, `Admin/Backend/income/routes.py`).** One ledger for money received. Sales are written by the workflows, never typed: an auction when it is paid and collected (`AuctionService.set_fulfillment('collected')`, also the guard's PIN release), a Smart Tag when staff approve its first registration at the office (`SmartTagService.approve` -> `_record_tag_sale`, sets `smart_tags.paid_at`). A unique index allows one sale per auction or tag. Super admins add `other` sales, refunds (stored negative) and adjustments with a required reason; nothing is edited or deleted. Endpoints: `GET /api/admin/income/summary?start&end` (totals by source, by month, this month vs last, refunds, and what is owed: auctions awaiting pickup, priced tags awaiting approval, unsold stock value), `GET /api/admin/income/entries`, `POST /api/admin/income/entries` (super admin), `GET /api/admin/income/export` (CSV). Before the migration they answer 503 `setup_required` and recording is skipped quietly.
- **Smart Tag prices.** `POST /api/admin/smart-tags/batch` takes `price` (0 to 100,000 pesos, stored on each tag). `POST /api/admin/smart-tags/batches/<batch_id>/price` (super admin) re-prices only the batch's unsold tags. Batches report `price`, `sold` and `revenue`; admin tag rows carry `price` and `paid_at`. Users see the price on a blank tag's scan page and in the claim message, and My Smart Tags reminds them to pay at the office while awaiting approval.
- **Admin console.** New **Income** page (`pages/income/Income.tsx`, `utils/incomeApi.ts`, Overview group in the sidebar): period filter, headline total with this month vs last and the split by source, owed and unsold-stock cards, a stacked monthly chart, the ledger with source filter and paging, CSV export, and the super-admin entry form. The Smart Tags page has a price field in Generate batch, price and earnings on each batch, and Set price. The Dashboard shows an income strip that links to the page.

## Email provider (Brevo or SendGrid)

`Server/app/utils/email_service.py` sends every email through one `_send`. `provider_key()` picks, at call time, `brevo` when `BREVO_API_KEY` is set (HTTPS call to `https://api.brevo.com/v3/smtp/email`, sender `BREVO_FROM_EMAIL` or `SENDGRID_FROM_EMAIL`, name `EMAIL_FROM_NAME`), else `sendgrid` when `SENDGRID_API_KEY` is set. Failures never raise out of a notice (best effort) and are logged as errors; the Mission Control email test names the provider and explains a 401. `config.py` trims stray spaces, line breaks and quotes from the keys. Setup steps: `DEPLOYMENT_GUIDE.md` "Sending email with Brevo". Tests: `Server/tests/test_brevo_email.py`.

## Round 8: role access, page isolation, settings center, Smart Tag revenue and removal, fonts

No migration (role access and page locks live in `system_settings` under `rbac` and `page_locks`).

- **Role access (`Server/app/utils/access_control.py`, Users > Role access (RBAC)).** `ADMIN_PAGES` lists every console page with the admin API prefixes it needs. `rbac` = {admin: [...], guard: [...]}; defaults keep today's behaviour (admins: every page except System control and Recycle bin; guards: Release desk). Super admins always have everything; super-only pages cannot be granted; administrators always keep Dashboard and My profile; guards always keep the Release desk. `_require_admin` (`Admin/Backend/shared/admin_access.py`) now calls `admin_path_problem`: an admin API is allowed when at least one page that needs it is granted and not locked, and a guard may use an admin-level API only when a page granted to guards owns it (`guard_may_use`). Endpoints: `GET /api/admin/access/me` (any staff: pages and admin locks), `GET|PUT /api/admin/access` (super admin). Console: `utils/accessApi.ts` (`useMyAccess`), `App.tsx` gates pages (`components/PageGate.tsx`: No access, Locked, and a "locked for others" strip for super admins), `Sidebar.tsx` hides pages and shows a lock; a guard granted more than the desk gets the full console with only those pages. UI: `pages/users/RoleAccessTab.tsx`.
- **Page isolation (System control > Page isolation, `pages/system-control/PageIsolation.tsx`).** `GET|PUT /api/admin/system/page-locks {area: user|admin, page, locked, message}` (super admin). A locked user page: `system_control.enforce_request` answers its API calls with 423 `{page_locked}` (`USER_PAGES` patterns; the public Smart Tag scan page and "I found this item" stay open), `GET /api/system/status` returns `locked_pages`, and the user app shows `shared/system/PageLockedNotice.tsx`. A locked admin page refuses admins and guards through `admin_path_problem`. Super admins are never locked out. Dashboard, My profile and System control cannot be locked.
- **Settings center (`Users/Frontend/src/app/shared/settings/UserSettingsModal.tsx`).** Five tabs: Appearance (theme, text size, reduce motion, high contrast, underline links), Home feed (first tab, feed only, "Urgent this week" row), Notifications (sound with test, unread count on the installed app icon via the Badging API, email reminders and announcements saved to the account), Privacy & Smart Tags (contact settings window, privacy notice, clear saved choices on this device), Account & security (profile, change password through the emailed code, sign out). `utils/preferences.ts` gained `showStories`, `highContrast`, `underlineLinks`, `appBadge` and `clearDeviceChoices`; CSS hooks `data-contrast="high"` and `data-links="underline"` in `theme.css`. The Profile page no longer holds settings: it links to the right tab with `openSettings(tab)` (event `ebalik-open-settings`, handled by `UserHeader.tsx`). `shared/profile/EmailPreferencesCard.tsx` now exports the email rows used by Settings.
- **Smart Tags (admin).** `SmartTagService.revenue_summary()` (from `income_ledger`, source smart_tag: total, this month, sold, average, unsold priced stock) is returned by the list as `revenue` and shown in a revenue strip. Super admins delete unused tags: `DELETE /api/admin/smart-tags/<code>` (blank or deactivated only; a deactivated tag linked to a found item is kept) and `DELETE /api/admin/smart-tags/batches/<batch_id>` (removes the batch's blank and deactivated tags, keeps the rest); photos are removed from storage; recorded income stays. The tag window shows the registration photo large (4:3, blurred fill) with a full-size viewer.
- **Income on the dashboard.** The dashboard income section shows this month, totals by source, what is owed and a six-month stacked chart, or the migration step when the ledger is missing. The Income page is in the Overview menu group.
- **Fonts.** User site: Source Serif 4 headings and Public Sans text. Admin console: Public Sans throughout (bold, tight headings, tabular figures). Outfit and Inter are gone.
- **Admin logo.** The sidebar, header and tab icon use the square transparent seal `Admin/Frontend/src/imports/umak-seal.webp` shown whole (`object-contain`); the cropped `umak-logo.png` was removed.
- **Tests never send real email.** `config.UNDER_TEST` (true under unittest or pytest) blanks `BREVO_API_KEY` and `SENDGRID_API_KEY`, and `auction_email` reads the provider through `Config`.

## Round 9: fonts, system controls, Google button

- **Fonts.** User site: Fraunces (headings, `--font-heading`), Hanken Grotesk (text, `--font-body`), DM Mono (`font-mono`). Admin console: Bricolage Grotesque, Geist, Geist Mono. Tailwind `--font-sans/serif/mono` are overridden in each `@theme`; the only fallbacks are the bare generic keywords. Emails keep web-safe stacks on purpose (mail apps ignore web fonts).
- **Scheduled maintenance (`system_control.py`).** `system_settings.maintenance_windows` = `{items: [{id, start, end, message}]}` (UTC ISO). `effective_maintenance(settings)` (manual switch OR a running window) drives `public_status`, `login_block`, `enforce_request`; a window starting within 48 h becomes the public banner (`upcoming_notice`, shown when no live announcement). Rules: start not in the past, end after start, at most 72 h, no overlap, at most 12. Routes: `GET|POST /api/admin/system/maintenance-windows`, `DELETE .../<id>`.
- **Role-based session wipe.** `system_settings.role_session_wipes` = `{role: {ts, by}}` for `user`, `guard`, `admin`; `enforce_request` revokes sessions issued before the role's `ts` (401 `session_revoked`) before the staff exemption; super admins are never affected. `GET|POST /api/admin/system/session-wipe` (counts per role).
- **Monitoring tab (System control).** `system_ops.admin_health`: per guard/admin/super admin, flags for no authenticator, locked, failed sign-ins, never signed in, dormant (45 d warn, 120 d fail), suspended. `email_health`: provider, sender, in-process `email_service.STATS`, and a live key check (`check_provider`: Brevo `GET /v3/account`, SendGrid `GET /v3/scopes`; sends nothing). `audit_csv`: `user_activity_logs` for Manila days, up to 50,000 rows, formula-safe cells, the export is itself logged. Routes `GET /api/admin/system/{admin-health,email-health,audit-export}`; all super admin only and rate limited.
- **Google button (`Users/Frontend/src/app/shared/auth/GoogleButton.tsx`).** One shared component for Login and Register: draws once (callback via ref), wrapper `color-scheme: light` + clipped pill + exact width, English. Fixes the white rectangle that appeared after re-renders on the dark theme.
- **Admin logo.** `components/BrandSeal.tsx` embeds the seal (`?inline`) with a "UM" fallback.

## Round 10: match alerts, digital receipts, photo search, monthly report, backups

- **Match alerts (`Server/app/utils/match_alerts.py`).** When a found item is created (user `found_item`, admin `found_items`) or a lost report is filed (user `missing_item`, admin `lost_items`), the opposite side is scored with `matching.match_percentage`. At 55%+ the owner gets an in-app notice (`notification_type='match_alert'`, `link_page='matches'`); at 72%+ also an email (`email_prefs` category `matches`, unsubscribe link). At most 30 recipients per event. Email preferences now have three keys: `reminders`, `announcements`, `matches`. Notice button opens Matches with the report selected (`notificationTarget`).
- **Digital receipts (`Server/app/utils/receipts.py`, `Users/Backend/receipts/routes.py`, `/api/receipts`).** No QR and no table: a receipt is derived from a collected claim (`HR-<YYYYMMDD>-<claim_reference>`) or a collected auction (`AR-<YYYYMMDD>-<AUCTIONID8>`) plus a 10-character HMAC code (`CryptoService._get_key()`). `GET ''` and `GET /<no>` are the owner's; `POST /verify` is public, rate limited (20 per 10 min per IP) and returns only `{valid, kind, item_name, released_on}`. The release email and a `receipt` notice carry the number and code. User UI: `shared/claims/ReceiptsModal.tsx` (My receipts, printable receipt, Check a receipt), opened from Claims ("My receipts", "View receipt" on a completed claim) or the notice (`openReceipts` navigation option). `utils/receipts.ts` builds the print window.
- **Search by photo (`Server/app/utils/image_match.py`, `POST /api/found-items/photo-search`).** Pillow fingerprint (difference hash, 4x4 colour grid, hue histogram) kept in `found_items.image_features` (migration `20261023`, optional); items from before are fingerprinted lazily (20 per search) and cached in memory. Results are suggestions ranked by similarity (min 42%, max 12). 12 searches per 10 min per account, 6 MB, JPG/PNG/WEBP with signature check. The browser shrinks the photo to 1024 px first. UI: `pages/browse-items/PhotoSearchModal.tsx`; the empty state points to filing a lost report (which then triggers match alerts).
- **Monthly report (`Server/app/utils/monthly_report.py`, `GET /api/admin/reports/monthly[/export]`).** Manila months, compared with the month before; each section is `null` if its table is missing. Admin UI: Analytics page now has two views (Live analytics, Monthly report: `pages/reports-analytics/MonthlyReport.tsx`) with month picker, CSV export (logged as "Export Monthly Report") and print or PDF. Same access as the Analytics page (`/reports`).
- **Backups (Supabase Free has none you can download).** `.github/workflows/backup.yml`: nightly pg_dump (use the pooler URL) gzipped, gpg-encrypted with `BACKUP_PASSPHRASE`, uploaded to Google Drive, size-checked, 30-day prune, status written to `system_settings.last_backup`; Sundays a portable job (`Server/scripts/backup_database.py --with-files`, always encrypted, AES-256-GCM chunks, scrypt) is kept 60 days. `Server/scripts/restore_database.py` is dry-run by default, `--apply` needs the project name typed. `system_ops.backup_status` (ok within 36 h and encrypted, warn up to 7 days or unencrypted, fail after) feeds `GET /api/admin/system/backup-status`, the health scan check `backups` and the Monitoring "Database backups" card. Guide: `docs/BACKUP_GUIDE.md`.
- **Design.** Shared admin `components/ui/EmptyState.tsx`; sticky, opaque table headers (tables scroll inside their card, max 74vh); admin skip-to-content link and focus target; System Control cards stack their action under the title on phones.
- **Tests.** `test_office_features.py` (alerts, receipts, photo search, monthly report), `test_backup_scripts.py` (encryption round trip, tamper and truncation, fake-Supabase backup and restore), `BackupStatusTests` in `test_system_ops.py`.
- **Migration.** `20261023_image_features.sql` (adds `found_items.image_features`), run by the user. Until then photo search works but rebuilds fingerprints after every restart, and the health scan lists the migration as not recorded.
