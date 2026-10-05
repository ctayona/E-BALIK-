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

**Rules enforced in Postgres:**
- `auction_place_bid(auction, bidder, amount)` locks the auction row and checks: account active, auction open, item still `unclaimed`, bidder isn't already leading, amount at least the starting bid or the current price plus the increment. It inserts the bid, updates the price, and extends the end time when a bid lands inside the anti-snipe window (capped by `max_extensions`). It returns `{ok, error, min_bid, extended, previous_bidder_id, auction}` rather than raising.
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
GET  /api/system/status                    public: {maintenance, message, since}
```

Cleanup only ever touches `user_notifications` (read ones by default), `otp_tokens` and `admin_mfa_challenges` older than the chosen age (minimum 30 days). The health scan checks environment variables (names only, never values), database latency, schema, unverified users with high activity, admin MFA coverage, the verification backlog, suspensions, table bloat, auctions waiting too long and the system controls. Frontend: `Admin/Frontend/src/pages/system-control/SystemControl.tsx` with `utils/systemApi.ts`; the sidebar item and route are super-admin only.

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
