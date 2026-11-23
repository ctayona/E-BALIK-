# Smart Tag recovery release

The user authorized deployment testing and a rollback checkpoint on November 23, 2026.

## Source checkpoints

- Previous source is `aa33206`, tagged `safety/pre-smart-tag-recovery-20261123`.
- `release/smart-tag-recovery-20261123` identifies the feature commit.
- Both tags and the feature commit are pushed to GitHub. Hosting status is recorded separately in the release audit.

## Deployment

Ship the complete backend and user/admin bundle, including `shared/`. The two Nov 23 migrations are verified user-applied. No further SQL execution is needed. The new tables deny browser access, service functions are invokers and the installed function bodies match these migration files.

Render's blueprint now sets `CAMPUS_VENUES_ENABLED=true` and `SMART_TAG_RECOVERY_ENABLED=true`. Existing dashboard-managed services may need their Blueprint synchronized or those two values entered in Render and the API redeployed. Keep the existing permanent `PUBLIC_SITE_URL`, CORS, provider secrets and Vercel HTTPS API URL. Maintain the production cleanup scheduler. Source defaults remain off when the new flags are absent.

## Acceptance

Use a dedicated approved tag and test owner. Scan with the HONOR, submit a manual report, then test GPS denial/share/removal. Verify private owner history, bell and signed-out email links, a second account's denial and staff flag review. Test room additions and retirement. Follow existing office intake, claim, PIN and receipt to confirm verified return erases the point. Event entry QR remains separate from campus Smart Tags.

## Immediate rollback

Set `SMART_TAG_RECOVERY_ENABLED=false` in Render and redeploy the API. Also set `CAMPUS_VENUES_ENABLED=false` if venue choices cause problems. Reflect these values in the blueprint before synchronizing it again. This restores legacy finder/venue options while keeping the retention worker and backup exclusions.

## Source rollback

Start from a clean checkout. Preserve later changes and inspect conflicts. Create a normal revert commit; keep the cleanup and backup protections while precise reports may exist.

```powershell
git switch main
git pull --ff-only origin main
git revert --no-commit release/smart-tag-recovery-20261123
git restore --source=release/smart-tag-recovery-20261123 --staged --worktree -- Server/app/utils/tag_recovery.py Server/app/utils/campus_catalogue.py shared/campus.json Server/app/utils/scheduler.py Server/app/utils/backup_restore.py Server/scripts/backup_database.py Server/scripts/restore_database.py
git commit -m "Revert recovery UI and venue changes while retaining privacy cleanup"
git push origin main
```

The revert removes the new blueprint flags, so absent dashboard overrides both features return to off. Explicitly set dashboard flags false as well. This sequence preserves additive tables and their records, the existing printed URLs, expiry deletion and coordinate backup exclusions. A raw redeployment of the old checkpoint requires equivalent retention handling for existing precise reports first. No database teardown or force-push is required.

## Verification

The release review passed 1,241 network-blocked backend tests, disposable PostgreSQL tests covering the combined migrations/replays/management/custody, the combined Node 22 Vercel package and admin types. The user type ratchet stays at its pre-existing 108 errors. Nine finder/owner/admin browser cases and two venue management browser cases passed during implementation; physical tags and actual mailbox acceptance remain user-run.

Secret-pattern and staged reverse-patch checks are recorded in the daily audit. Unrelated paper artifacts remain local.
