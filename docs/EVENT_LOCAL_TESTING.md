# Event Drafts — Local Testing

2026-11-15. Local work only; no commit, push, or deployment authorized.

Historical 2026-11-16 update: Draft setup was followed by Review/lifecycle, attendee reporting, staff intake and the claims/release/receipt and workspace-management milestone. [EVENT_RECOVERY_CHECKPOINT.md](EVENT_RECOVERY_CHECKPOINT.md) records that milestone's migration and acceptance checklist. The instructions below cover the earlier draft setup; use the Nov 19 update for current migration status.

## Setup

Migration 20261115_event_foundation was verified as applied using read-only metadata. Both tables have RLS enabled and no browser-role grants. Do not run the migration again; repeated execution deliberately refuses.

Nov 19 update: all seven event migrations through pilot completion are verified user-applied. Use EVENT_PILOT_COMPLETION.md for the current full acceptance run. The module is now explicitly enabled in the existing local `Environment_Configs/backend/.env`; restart the backend to read it. Drafts were not deleted. This flag enables the event module, while per-event portal/state and account checks remain authoritative.

For an explicit process override in another environment, use the PowerShell session that launches that backend:

```powershell
$env:EBALIK_EVENTS_FOUNDATION_ENABLED = 'true'
npm run dev
```

If servers are already running, restart the backend so it reads the flag. A process override takes priority over the local environment file. Normal campus development commands remain unchanged. Codex did not restart the live-connected application or its background jobs.

Sign in as a super administrator, then open System → Events. Other staff should not see or access this page. If event setup is unavailable, confirm that the current backend code is running, the flag is set in its process, and it points at the project where you applied the migration.

Local frontend/backend servers can still use the live Supabase project in your configuration. Saving a draft writes new event configuration and an activity-log entry there. Prefer a staging configuration for write-based testing; the appearance preview updates locally without saving. Codex has not performed those live writes.

## Checklist

- [ ] Existing campus pages, sign-in, reports, auctions, and tags still open normally.
- [ ] A super admin sees Events; regular admin/guard cannot access it directly.
- [ ] With draft management disabled, the page shows an unavailable state and no draft-save controls are active.
- [ ] Enter event details, organizer, venue and collection desk instructions.
- [ ] Change Classic/Festival/Sports, colors and phone/wide preview. Campus chrome retains its theme.
- [ ] Dates show Manila time even if the browser uses another timezone. Use all three dates or none; start < end <= claiming deadline.
- [ ] Save only in your intended test database; reload/select the draft and confirm details persist.
- [ ] Try saving the same slug twice; the second request reports a conflict.
- [ ] Edit the same draft in two sessions; the stale save is rejected with a reload option. Discarding/reloading intentionally loses that session's unsaved edits.
- [ ] Unsaved edits require save/discard before switching drafts; leaving the page or closing the tab warns before discarding.
- [ ] Attendee buttons in the appearance preview are disabled. No event is published and no campus report is created.
- [ ] Existing activity logs show Create Event Draft / Update Event Draft after successful saves.

## Coverage and next work

Automated admin build/type checking and offline backend tests are recorded in today's audit. No authenticated browser or visual acceptance session was run by Codex. The list has 50-record paging. Images/logo uploads, staff invitations, public pages, report integration, hub publication and billing are not implemented yet. No new migration is required for this UI slice.

## Campus-theme follow-up

Use the existing university venue dropdown. Enter an ordinary event name; no manual link/address formatting is required. Save generates the event reference and later renames preserve it. Try Heritage, Afterglow and Fieldhouse, then adjust individual colors. The staff-assignment API foundation is added but no staff-picker/console UI is enabled yet. No additional SQL migration is needed. Banner/logo uploads and public reporting remain pending.

## Setup checkpoint update

Staff-management UI and artwork uploads are now implemented. Use EVENT_SETUP_CHECKPOINT.md for the current complete test sequence and the additional user-run artwork migration. Earlier missing-feature notes in this file are historical. No production migration has been run by Codex.
