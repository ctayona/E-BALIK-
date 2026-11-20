# Master prompt: BuildTrack admin features (for Codex to refine, then hand to Claude)

How to use: paste everything below the line into Codex **inside the BuildTrack project folder**. Codex inspects BuildTrack, rewrites this into a final, project-specific prompt, and shows it to the owner. The owner then gives that final prompt to Claude.

---

## Role
You are the prompt engineer and technical lead for **BuildTrack**. Do **not** change any code in this step. Your job is to turn this master prompt into a precise, BuildTrack-specific implementation prompt for another AI coding session (Claude). The owner reviews your result before anything is built.

## Context
The features below were built and proven in a different project, **E-Balik** (a lost-and-found system). BuildTrack is a **separate project with a different framework, database, folder layout and design**. Only the *behaviour* of the features is wanted, never E-Balik code, file names, tables or branding. Anything specific to E-Balik (lost items, claims, auctions, Smart Tags, campus IDs, payments, income) is out of scope. Backup and restore is also out of scope.

## Step 1: Inspect BuildTrack (read only)
Find out by reading the code, never by guessing, and record the answers:
1. Frontend and backend frameworks, language, package manager, how to run, test, type-check and build.
2. Database, how migrations are written and run, and whether a migration log table exists.
3. How admins sign in, which roles exist, how routes are protected on the server, and how the frontend hides pages.
4. How emails are sent, how background jobs run, how files are stored, how notifications work.
5. The design system, shared components and styling rules already in use.
6. Project rules files (CLAUDE.md, AGENTS.md, README, contributing notes). These override this prompt.
7. For **each** feature in the list below: does BuildTrack already have it fully, partly, or not at all? Give the file paths as proof.

## Step 2: Write the final prompt for Claude
The final prompt must contain, per feature: status (exists / partial / missing), exactly what to add or change, the files likely involved, the data needed, the tests to add, and how to verify it. Keep it short enough to follow and specific enough that nothing is left to guesswork. Split the work into small phases. Each phase must leave the program fully working and be reviewable on its own.

## Safety protocol (must appear in the final prompt, unchanged in spirit)
**Existing work is protected.**
- If a feature already exists (for example **user management is already implemented**), the job is to **enhance** it: keep its routes, data, behaviour and look, and add only what is missing. Never rebuild, rename, move or replace it.
- Do not remove or change existing endpoints, database columns, settings keys, environment variables or UI that other code might use. Additions only, unless the owner approves a change in writing.
- Do not reformat, reorganise or "clean up" code that the task does not need. Surgical edits only.
- Read the code that will be touched before editing it. Grep before reading. Never assume names, columns or endpoints.

**The program must not break.**
- Work on a new git branch, never directly on the main branch. Commit and push only when the owner says so.
- Before the first change, run the existing tests, type check and build, and record the result as the baseline. After every phase run them again. The result must be equal or better. If something that passed before now fails, fix it or revert the phase, then report it.
- Every new server rule gets a test. Every new database-dependent feature must degrade safely: if its migration has not run, show a clear "not set up yet" message and let the rest of the app work. Never crash on a missing table or column.
- Database changes are **new, additive, re-runnable migration files** (create if not exists, add column if not exists), each with a verify query and an undo note. **The owner runs migrations; the AI never does.** No destructive changes (drop, truncate, rewrite of existing data) without explicit approval.
- Never touch production data, real user data, secrets or `.env` files. Never put secrets in files, logs or commits. Never copy personal data anywhere.
- If something is unclear or risky, stop and ask the owner. Do not guess.

**Security rules for every feature.**
- Every admin-only feature is enforced **on the server** for each request. Hiding a button is not security. Super-admin-only features refuse ordinary admins.
- Every state-changing admin action is written to the activity log (who, what, when) and rate limited per admin.
- Far-reaching actions (force logout, message to everyone, page lock, empty recycle bin, storage cleanup) need a confirm dialog; the biggest need typing CONFIRM.
- Admin-typed text is stored and shown as plain text: strip angle brackets, escape in emails, never render raw HTML.
- Search text and any value that reaches a database filter is sanitised.
- CSV exports prefix cells starting with `=`, `+`, `-`, `@` so spreadsheets show them as text.

## Features (behaviour to deliver, adapted to BuildTrack)

### Phase 1: Control and communication
1. **Maintenance mode and forced logout** (super admin). Public app answers "under maintenance" with an optional message and expected return time; admins still get in. Forced logout signs out every non-admin session at once.
2. **Announcement banner.** One banner with tone (info, success, warning, critical), title and message; on or off. Shown above every user and admin page, refreshed about every 30 seconds, paused in hidden tabs. A visitor who closed it sees it again if edited; critical cannot be closed. The public status endpoint carries it only while live.
3. **Communications hub.** Admin searches users, then sends a message to one person or all, as an in-app notification, an email, or both. Skip suspended accounts for "all". Insert in-app copies in batches, send bulk email in a background job with a recipient cap, rate limit per admin, log every send.
4. **Page isolation** (super admin). Lock one page for users or for admins with a message. The server answers that page's API calls with HTTP 423 and the frontend shows a "page locked" notice. Super admins are never locked out; sign-in and the lock page itself stay open.

### Phase 2: Health and operations
5. **Health scan and startup check** (super admin). Checks database reachable, required tables and columns present, **migrations applied** (repo migration files versus a migration log table), email configured, storage reachable, background job last-run times. Each check shows ok / warning / failed with a plain fix. At boot, log missing configuration without crashing or leaking secrets.
6. **Email test.** Sends a message to the signed-in super admin and shows the provider's real answer (key missing, key rejected, sender unverified, accepted).
7. **Scheduler and daily admin digest.** A scheduled job emails admins a morning summary of what needs attention, with per-admin opt-out. Use what BuildTrack already has. It must be safe if the host runs more than one worker.
8. **Storage scan and cleanup.** Usage per bucket or folder; find orphaned files (referenced nowhere, older than 24 hours); delete only after a confirm; if any reference table cannot be read, delete nothing; never touch private document folders.
9. **Audit data export.** JSON or CSV of allow-listed columns only (never password hashes, tokens, ID documents or private notes), formula-injection safe.

### Phase 3: Data handling and everyday admin
10. **Recycle bin and archive.** Delete moves records to a recycle bin; restore returns them; permanent delete and emptying are super admin only with typed confirmation. Old finished records can be archived out of the main lists without being lost.
11. **Admin dashboard and menu badges.** KPI tiles and trend charts for BuildTrack's own key numbers. Each menu item shows a count of things needing attention, computed on the server, cached briefly, never shown for pages that admin cannot open.
12. **Monthly report and analytics.** Report for a chosen month: totals, comparison with the previous month, tables, safe CSV export. Only data BuildTrack actually has.
13. **User management: ENHANCE ONLY.** BuildTrack already has user management. Keep it exactly as it works. Compare it with this checklist and add **only what is missing**, without changing existing routes or data: search and filter; profile view; suspend with a required reason (the person is notified and signed out; admins cannot suspend themselves or a super admin); reactivate; identity verified or not (only if BuildTrack has a verification step); every change in the activity log; confirm dialogs. Report what was already there and what was added.
14. **In-app notifications and email preferences.** Bell with unread count, mark read and mark all read, a notifications page, links that open the right page. Email templates share one branded layout. Users can switch off reminder and announcement emails; security and password emails always send. Extend any existing notification system instead of adding a second one.
15. **Reusable UI.** Confirm-action dialog, loading skeletons, a page error boundary (one broken page does not blank the app), and a page gate for locked or unauthorised pages. Reuse BuildTrack's existing components first.

## What the final prompt must tell Claude to do
1. Read BuildTrack's rules files, then confirm the baseline (tests, type check, build) before any change.
2. Work on a new branch, one phase at a time, and stop for the owner's review after each phase.
3. For every feature, state whether it was reused, enhanced or newly built, and why.
4. After each phase report: what changed (grouped, short), migrations the owner must run (in order, each with verify and undo notes), test and build results versus baseline, and anything chosen by default that the owner may want to change.
5. Add a short entry to BuildTrack's audit or changelog if it has one.
6. Never commit or push without the owner's explicit instruction.

## Output of this step (Codex)
Return only:
1. A table of the inspection answers (Step 1), including the status of each of the 15 features.
2. The final prompt for Claude, ready to copy.
3. A short list of risks or open questions for the owner.
Do not modify any file in BuildTrack.
