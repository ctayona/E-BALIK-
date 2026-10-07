# E-Balik Deployment Guide (free tier)

This puts E-Balik online for free.

| Part | Host | What runs there |
| --- | --- | --- |
| Database and file storage | **Supabase** | Postgres, image buckets |
| API (Flask) | **Render** (free web service) | `Server/`, `Users/Backend`, `Admin/Backend` |
| Website | **Vercel** (Hobby plan) | The user app at `/` and the admin console at `/admin/`, from one project |

Both apps share one Vercel site on purpose. The admin sign-in hands its session from the user app to the console, and that only works on one origin.

Files this guide relies on, already in the repo: `vercel.json`, `render.yaml`, `Procfile`, `scripts/merge-admin-build.mjs`, `scripts/check-deploy-env.mjs`, `Environment_Configs/backend/production.env.example` and `Environment_Configs/frontend/production.env.example`.

**You will need:** a GitHub login, your Supabase project, and about 30 to 40 minutes. Do the phases in order. Each one ends with a check, so do not move on until it passes.

---

## Phase 0. Gather your values

Open `Environment_Configs/backend/.env` on your computer. It is your reference for the values below. Do not paste its contents anywhere except the dashboards named in this guide.

Write these in a notepad and fill them in as you go:

```text
SUPABASE_URL            =
SUPABASE_KEY (anon)     =
SUPABASE_SERVICE_KEY    =
APP_ENCRYPTION_KEY      =   (copy from your local .env)
GOOGLE_CLIENT_ID        =   (only if you use Google sign-in)
GOOGLE_CLIENT_SECRET    =   (only if you use Google sign-in)
SENDGRID_API_KEY        =   (only if you send real emails)
SENDGRID_FROM_EMAIL     =   (only if you send real emails)
RENDER URL              =   (filled in at Phase 2)
VERCEL URL              =   (filled in at Phase 3)
```

**Why reuse `APP_ENCRYPTION_KEY`:** admin authenticator (MFA) secrets are encrypted with it. A different key means admins can no longer sign in with their authenticator codes.

If your local `.env` has no `APP_ENCRYPTION_KEY`, generate one and keep a copy somewhere safe:

```bash
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
```

---

## Phase 1. Supabase

### 1.1 Get your keys

1. Go to <https://supabase.com/dashboard> and open your E-Balik project.
2. Click the gear icon (**Project Settings**), then **API Keys** (older dashboards call it **API**).
3. Copy the **Project URL**, which looks like `https://abcdxyz.supabase.co`.
4. Copy the **anon** key and the **service_role** key.
   - If the page only shows new-style keys (`sb_publishable_...` and `sb_secret_...`), look for a tab called **Legacy API keys** and copy the `anon` and `service_role` keys from there. The app was built with the legacy ones.
   - The service_role key is a secret with full database access. It goes only into Render, never into Vercel or GitHub.

### 1.2 Run the migrations

Open **SQL Editor > New query**, paste a file's full contents, and click **Run**. Every file is safe to run again. Run them in this order (skip any you have already run):

```text
Server/database_schema.sql                      (only for a brand-new project)
Server/manual_migrations/20260928_claim_identity_and_admin_access.sql
Server/manual_migrations/20260929_admin_totp_mfa.sql
Server/manual_migrations/20260930_account_verification_review.sql
Server/manual_migrations/20260930_admin_item_management.sql
Server/manual_migrations/20260930_claim_history_reference_and_superadmin_delete.sql
Server/manual_migrations/20261003_superadmin_delete_user.sql
Server/manual_migrations/20261004_claim_report_closeout.sql
Server/manual_migrations/20261005_auction_hall.sql
Server/manual_migrations/20261005b_auction_awaiting_admin_baseline.sql   (new databases only; your live one already has it)
Server/manual_migrations/20261006_system_control_verification.sql
Server/manual_migrations/20261007_report_integrity_and_reactions.sql
Server/manual_migrations/20261008_smart_tags.sql
Server/manual_migrations/20261009_tag_expiry_and_auction_buyout.sql
Server/manual_migrations/20261010_tag_photo_and_mission_control.sql
Server/manual_migrations/20261011_tag_staff_verification.sql
Server/manual_migrations/20261012_handover_pins_and_auction_timeouts.sql
Server/manual_migrations/20261013_guard_role_reminders_and_retention.sql
Server/manual_migrations/20261014_recycle_bin.sql
Server/manual_migrations/20261015_report_lifecycle_and_guard_handover.sql
Server/manual_migrations/20261016_archive_and_bid_steps.sql
```

The last twelve are required for auctions, maintenance mode, verification roles, suspensions, saved auction hearts, duplicate-claim protection, Smart Tags, tag expiry, the auction Buy Now price, the Smart Tag registration photo, the Mission Control storage tools staff approval of Smart Tags, Handover PINs, the automatic auction pickup deadlines, the guard role, email preferences, claim and Smart Tag reminders, evidence retention and the recycle bin. Run them in order (`20261005`, `20261006`, `20261007`, `20261008`, `20261009`, `20261010`, `20261011`, `20261012`, `20261013`, `20261014`, `20261015`, then `20261016`). **Until `20261014` is run, no admin delete works** (the app refuses to delete anything it cannot archive first) and the file-retention rule waits. The tag photo camera needs the site to be served over https (Vercel does this); on plain http a phone falls back to its camera app. Then check them:

```sql
SELECT to_regclass('public.auctions') AS auctions,
       to_regclass('public.system_settings') AS settings,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='user_profiles' AND column_name IN ('user_category','suspended_until')) AS new_columns;
```

Expected: `auctions` and `settings` show table names, and `new_columns` is `2`.

### 1.3 Confirm you are a Super Admin

```sql
SELECT email, access_level FROM public.user_profiles WHERE email = 'you@umak.edu.ph';
```

If `access_level` is not `super_admin`:

```sql
UPDATE public.user_profiles SET access_level = 'super_admin' WHERE email = 'you@umak.edu.ph';
```

**What changes for existing users:** once the API is live, any user who is not verified can no longer report items, file claims or bid. Admins are not affected. Verify trusted users in the admin Users page after deploying.

**Phase 1 is done when** the check query returns both table names and `2`.

---

## Phase 2. Render (the API)

### 2.1 Create the service

1. Go to <https://dashboard.render.com> and choose **Sign in with GitHub**. Allow access to the repository when asked.
2. Click **New +**, then **Blueprint**.
3. Select your repository and click **Connect**.
4. Render reads `render.yaml` and shows a service named `ebalik-api`. It asks for the values that are not stored in the file.

### 2.2 Fill in the variables

| Variable | What to enter |
| --- | --- |
| `SUPABASE_URL` | Project URL from Phase 1.1 |
| `SUPABASE_KEY` | the anon key |
| `SUPABASE_SERVICE_KEY` | the service_role key |
| `APP_ENCRYPTION_KEY` | your local value (see Phase 0) |
| `CORS_ORIGINS` | `https://placeholder.vercel.app`. Temporary; you fix it in Phase 4. |
| `PUBLIC_SITE_URL` | `https://placeholder.vercel.app`. Temporary; set it to your exact VERCEL URL in Phase 4, and **before printing any Smart Tag stickers**, because every QR code opens `<this>/tag/<code>`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | your Google values, or leave blank if unused |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | your SendGrid values, or leave blank if unused |
| `CRON_SECRET` | a long random string you invent. Optional: it switches on `POST /api/cron/run`, so an outside timer can wake the free service and run the auction deadlines (see below). |

Render fills in `JWT_SECRET_KEY` itself, and `render.yaml` already sets `FLASK_ENV`, `PYTHON_VERSION` and `AUCTION_EMAIL_MODE=auto`. Leave those alone. With `auto`, auction winner emails (and AI-match emails) are really sent as soon as `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` are set. The same list as a checklist file is `Environment_Configs/backend/production.env.example`.

#### Automatic auction deadlines (48h warning, 72h forfeit)

The backend checks pickup deadlines itself every 15 minutes (`SCHEDULER_INTERVAL_MINUTES`; it runs by default in production only; `SCHEDULER_ENABLED=false` turns it off, and `true` forces it on elsewhere), but a **free Render service sleeps when nobody visits**, and a sleeping service cannot keep time. To make the deadlines reliable, set `CRON_SECRET` and let a free outside timer call the API every 15 minutes, for example on cron-job.org:

```text
POST https://<your-api>.onrender.com/api/cron/run      header  X-Cron-Secret: <CRON_SECRET>
```

On a paid plan you can instead add a Render Cron Job running `python Server/scripts/run_cron.py`. All three ways are safe to combine: each warning and forfeit is claimed with a conditional database update, so nothing is ever sent twice.

#### Sessions, reminders and file retention (all optional tuning, the defaults are sensible)

| Variable | Default | What it does |
| --- | --- | --- |
| `SESSION_USER_HOURS` | 12 | Longest a student session lasts. The app also signs out after 60 minutes of inactivity. |
| `SESSION_STAFF_HOURS` | 8 | Longest an admin, super admin or guard session lasts. The app also signs out after 20 minutes of inactivity. |
| `CLAIM_PICKUP_DAYS` | 14 | An approved claim that is not collected closes after this many days. |
| `CLAIM_REMINDER_DAYS` | 7 | Days after approval when the pickup reminder is sent. |
| `TAG_EXPIRY_REMINDER_DAYS` | 30 | How many days before a Smart Tag expires its owner is reminded. |
| `EVIDENCE_RETENTION_DAYS` | 30 | ID documents and proof photos are deleted this many days after a claim closes or a verification is reviewed. **`0` switches deletion off.** Update the numbers on the data privacy page (`PrivacyPage.tsx`) if you change it. |
| `RECYCLE_BIN_DAYS` | 30 | How long a deleted record, and any ID document removed by the retention rule, waits in the recycle bin before it is deleted for good. The privacy page says 30: update it if you change this. |
| `PUBLIC_API_URL` | Render's own address | The address used in unsubscribe links. Render provides `RENDER_EXTERNAL_URL` itself, so you normally set nothing. |

Existing 30-day sign-ins stop working as soon as this is deployed (the server refuses any token older than the limits above), so everyone signs in once more.
Everything in this section runs only in production by default; locally the timer is off so a laptop never emails people or deletes files from the live database.

### 2.3 Deploy and watch the log

1. Click **Apply**. Render opens the service and starts building.
2. Open the **Logs** tab. A good build shows `pip install` finishing, then gunicorn starting, then "Your service is live".
3. The first build takes 3 to 6 minutes.

### 2.4 Check the API

1. Copy the service URL at the top, for example `https://ebalik-api.onrender.com`. Write it down as the RENDER URL.
2. Open `RENDER-URL/api/system/status` in your browser.
3. You should see JSON like `{"maintenance":false,"message":"","since":null}`.

**Phase 2 is done when** that page shows JSON.

**If the build fails**

- Error about a package or Python: go to **Environment**, change `PYTHON_VERSION` to `3.12.8`, then **Manual Deploy > Deploy latest commit**.
- "No open ports detected": go to **Settings** and check the Start Command is exactly `gunicorn --chdir Server run:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120`.
- Any other error: open the Logs tab and read the last 20 lines.

**Doing it by hand instead of the Blueprint:** New > Web Service, choose the repo, then set Runtime `Python 3`, Region Singapore, Build Command `pip install --upgrade pip && pip install -r Server/requirements.txt`, Start Command as above, Health Check Path `/api/system/status`, Instance Type Free. Then add the variables from the table.

---

## Phase 3. Vercel (the website)

### 3.1 Import the project

1. Go to <https://vercel.com> and choose **Continue with GitHub**.
2. Click **Add New... > Project**.
3. Find your repository and click **Import**. If it is not listed, click **Adjust GitHub App Permissions** and grant access to it.

### 3.2 The multi-service import screen

Your repository holds three deployable things: the website, the admin app and the Flask backend. Vercel may show **"Import multi-service project"** and say the repository needs a `vercel.json` to configure its services.

- **Do not paste the JSON Vercel suggests.** It would also try to deploy the Flask backend and the admin app as separate services. The API runs on Render, and the admin console is served from the same site.
- The repo's `vercel.json` already defines a single service called `web` with the right build. Click **Refresh** on that screen. Vercel should now show one service.
- If it still shows three services, make sure the latest commit is on GitHub (`git push origin main`), then click **Refresh** again.

### 3.3 Settings

Do not edit the build settings. `vercel.json` sets the install command, the build command (`npm run build:vercel`) and the output folder (`Users/Frontend/dist`).

### 3.4 Environment variables

Add these one by one, for Production, Preview and Development:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | your RENDER URL, no trailing slash |
| `VITE_API_TIMEOUT` | `60000` (the free API needs time to wake up) |
| `VITE_ENV` | `production` |
| `VITE_ENABLE_OTP_VERIFICATION` | `true` |
| `VITE_ENABLE_PASSWORD_RESET` | `true` |
| `VITE_GOOGLE_CLIENT_ID` | your Google client ID, or skip if unused |

Do **not** add `VITE_ADMIN_URL`. Do not paste any secret here: everything that starts with `VITE_` is visible to anyone who opens the site. The same list is in `Environment_Configs/frontend/production.env.example`.

### 3.5 Deploy

1. Click **Deploy** and open the build log.
2. In the first lines you should see `Deployment check passed: the site will call https://...`. If `VITE_API_URL` is missing, has a trailing slash or points at `localhost`, the build stops with a clear message (`scripts/check-deploy-env.mjs`). Fix it under **Settings > Environment Variables**, then **Deployments > Redeploy**.
3. When it finishes (2 to 4 minutes) click **Visit** and copy the address, for example `https://ebalik.vercel.app`. Write it down as the VERCEL URL.

**Phase 3 is done when** the site opens and shows the landing page. Sign-in and data calls may fail with a CORS error until Phase 4.

---

## Phase 4. Connect the API to your site

1. In Render, open `ebalik-api`, then **Environment**.
2. Edit `CORS_ORIGINS` and `PUBLIC_SITE_URL` and set both to your exact VERCEL URL, for example `https://ebalik.vercel.app`. No trailing slash. To allow a second address later, separate with a comma.
3. Click **Save, rebuild and deploy** and wait for Live (2 to 3 minutes).
4. Reload your Vercel site. The landing page board should now show real data.

Preview deployments on Vercel have different addresses and are not trusted by default. Test on your main address.

### Google sign-in (skip if you do not use it)

1. Go to <https://console.cloud.google.com/apis/credentials> and open your OAuth client.
2. Under **Authorized JavaScript origins**, click **Add URI** and enter your VERCEL URL.
3. Save. It can take a few minutes to take effect.

---

> **Using Smart Tags?** Read `SMART_TAGS_GUIDE.md` before you print any QR stickers. The address you set in `PUBLIC_SITE_URL` is baked into every printed sticker and cannot be changed afterwards.

## Phase 5. Test every feature

**User app (your Vercel URL)**

- [ ] The landing page shows the live board with real reports.
- [ ] Register a test account, or sign in with an existing one. The OTP email arrives if SendGrid is set up.
- [ ] An unverified user sees the "Verify your account first" banner on the report forms.
- [ ] The Profile page shows the verification status card.
- [ ] Auction Hall loads without a "setup required" message.
- [ ] Browse items shows data.

**Admin console (`YOUR-VERCEL-URL/admin/`, or sign in as an admin on the main page)**

- [ ] A Super Admin sign-in lands in the admin console.
- [ ] The dashboard loads with numbers.
- [ ] Users > Account verification: approving a user requires picking a role (Student, Faculty, Staff or Visitor).
- [ ] Auctions loads.
- [ ] System control opens with no database warning. Click **Run check** and read the result.
- [ ] A found-item report with a photo uploads. This tests Supabase storage and CORS together.
- [ ] Do not turn on maintenance mode on the live site unless you mean to: it locks out every non-admin user.

**Verification flow end to end:** upload an ID on a test account, approve it in the admin console with a role, and check the user's Profile now shows Verified with the role badge.

---

## Phase 6. Keep it running

1. **Stop the API sleeping.** Render's free plan sleeps the API after 15 idle minutes, and the next visit waits 30 to 60 seconds. Create a free monitor at <https://uptimerobot.com>: type HTTP(s), URL `RENDER-URL/api/system/status`, interval 10 minutes.
2. **Supabase pauses after 7 days of no activity.** The monitor above keeps it active. If it does pause, press **Restore project** in the Supabase dashboard.
3. **Updates.** Push to `main` and Render and Vercel redeploy by themselves. If you change a `VITE_` value, trigger a new Vercel deploy, because it is built into the site. Run any new SQL migration in the Supabase SQL Editor before, or right after, deploying the code that needs it.
4. **Vercel Hobby** is for personal and non-commercial use.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Browser console shows a CORS error or the site shows network errors | `CORS_ORIGINS` on Render does not exactly match your site address. Check `https`, no trailing slash, no typo, and that the redeploy finished. |
| Everything says "Request timeout" on the first visit | The free API is waking up. Wait a minute and retry. |
| Auctions or System control say "setup required" or return 503 | The Phase 1.2 migrations did not all run. Run the check query again. |
| Admin MFA codes are rejected | `APP_ENCRYPTION_KEY` on Render differs from the key used when MFA was set up. Set it to the original value. |
| `/admin/` is blank | In Vercel, open the build log and confirm the build ran `npm run build:vercel`, then redeploy. |
| Admin sign-in loops back to the user app | `VITE_ADMIN_URL` is set. Remove it and redeploy. |
| Sign-in says the system is under maintenance | Maintenance mode is on. An admin account can still sign in and turn it off in System control. |
| Vercel build says "Deployment check failed" | Read the message. It names exactly what is wrong with `VITE_API_URL`. |
| Vercel still shows the multi-service screen | See Phase 3.2: push the latest commit, then click Refresh. |
| Render build fails on a package | Set `PYTHON_VERSION` to `3.12.8` and redeploy. |

---

## Security reminders

- `SUPABASE_SERVICE_KEY`, `JWT_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET` and `SENDGRID_API_KEY` belong **only** in Render. If one ever leaks, rotate it in its own dashboard and update Render.
- Do not commit `.env` files. The `*.example` files in `Environment_Configs/` hold placeholders only.
- Keep the GitHub repository private if it ever contains anything you would not publish.
