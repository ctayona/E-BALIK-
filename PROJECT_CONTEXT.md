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
  run.py, config.py, .env, venv/, requirements.txt
  app/__init__.py              App factory (adds the repo root to sys.path for Users/Admin imports)
  app/blueprints.py            Mounts every page blueprint (Users at /api, Admin at /api/admin)
  app/utils/                   Supabase DB, JWT/password, email, crypto, matching, claim status, admin MFA
  database_schema.sql, manual_migrations/, tests/, scripts/
Design/                        Design skill packs for AI tools (not loaded by the app)
docs/                          Guides, checklists, notes, archived exports
```

### Endpoint ownership

Each endpoint lives in the backend folder of the page that uses it. Where several pages call it, it lives with the page that owns the workflow.

| Endpoint | Backend page | Frontend callers |
|---|---|---|
| `/api/auth/{register,verify-otp,login,google-login,admin-mfa/verify,forgot-password,reset-password,verify-token}` | `home` | Landing/Login/Register/ForgotPassword, App session |
| `GET /api/found-items/public` | `home` | Landing |
| `/api/auth/profile`, `/api/auth/profile/document-upload` | `profile` | Profile |
| `POST/GET /api/found-items`, `GET /api/found-items/matches` | `found_item` | Found Item (list also My Reports) |
| `POST/GET /api/missing-items`, `GET /api/missing-items/matches` | `missing_item` | Missing Item (list also Dashboard, Matches, My Reports) |
| `PUT/DELETE /api/found-items/<id>`, `PUT/DELETE /api/missing-items/<id>` | `my_reports` | My Reports |
| `GET /api/found-items/search` | `matches` | Matches, Dashboard, Browse Items, Missing Item |
| `GET /api/missing-items/public` | `browse_items` | Browse Items |
| `/api/claims` | `claim` | Claim |
| `/api/notifications` | `notifications` | Notifications, UserHeader badge |
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

## Theme ("Campus Utility")

Swiss-modern and utilitarian: fast to scan, clear hierarchy, flat surfaces with a light elevation scale. Navy anchors structure, gold marks the primary action and brand moments, and tide (teal) is the complementary accent for matches and info.

Tokens are Tailwind v4 `@theme` variables, defined in `Users/Frontend/src/styles/theme.css` and mirrored in `Admin/Frontend/src/index.css`. Use the utilities, not raw hex:

```text
navy-50 … navy-950    brand navy = navy-800 (#1f3160)
gold-50 … gold-900    brand gold = gold-500 (#d1a153); use gold-700 for gold TEXT on white (contrast)
tide-50 … tide-700    complementary teal for matches / info
page, line, line-strong, ink, ink-soft, ink-muted   neutrals
shadow-card, shadow-raised, shadow-overlay          elevation scale
```

- Fonts: Lexend (headings, `--font-heading`) and Source Sans 3 (body), in both apps.
- User-app component classes live in `Users/Frontend/src/app/utils/clay.ts` (`CX.btnNavy`, `CX.btnGold`, `CX.input`, `CX.card`, `CX.badge*`, `CX.eyebrow`, `CX.pageTitle`…).
- Controls are at least 44px tall. Text is at least 12px. Focus uses a global gold `:focus-visible` ring.
- Hover changes color, border, or shadow only, never layout (no translate "lift"). Icons come from Lucide, never emoji.
- Labels are linked to inputs (`htmlFor`/`useId`). Required fields show a red asterisk.

Avoid:

- Replacing the navy/gold theme or adding off-palette accents (indigo, purple, bright #FBBF24 yellow).
- Gradient or "clay" buttons, double offset shadows, thick 2–3px borders.
- Auto-rotating carousels without pause controls.
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
