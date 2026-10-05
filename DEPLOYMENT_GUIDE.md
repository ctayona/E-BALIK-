# E-Balik Deployment Guide (free tier)

This puts E-Balik online for free:

| Part | Host | What runs there |
| --- | --- | --- |
| Database and file storage | **Supabase** (already set up) | Postgres, image buckets |
| API (Flask) | **Render** (free web service) | `Server/`, `Users/Backend`, `Admin/Backend` |
| Website | **Vercel** (Hobby plan) | The user app at `/` and the admin console at `/admin/`, from one project |

Both apps share one Vercel site on purpose. The admin sign-in hands its session from the user app to the console, and that only works on one origin.

Files this guide relies on, already in the repo: `vercel.json`, `render.yaml`, `Procfile`, `requirements.txt`, `scripts/merge-admin-build.mjs`, `Environment_Configs/backend/production.env.example` and `Environment_Configs/frontend/production.env.example`.

Allow about 30 minutes. Do the steps in order, because each one gives you a value the next needs.

---

## Step 0. Put the code on GitHub

1. Create an empty repository on <https://github.com/new> (private is fine). Do not add a README.
2. In the project folder run these, with your own URL:

```bash
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git branch -M main
git push -u origin main
```

3. Check that `Environment_Configs/backend/.env` and `Environment_Configs/frontend/.env.local` are **not** on GitHub. They are git-ignored, so they should not be.

---

## Step 1. Supabase (database)

You already have a Supabase project. Keep using it.

1. Open the project at <https://supabase.com/dashboard> and go to **Project Settings > API**. Copy these three values for later:
   - **Project URL** (`SUPABASE_URL`)
   - **anon public** key (`SUPABASE_KEY`)
   - **service_role** key (`SUPABASE_SERVICE_KEY`). This one is a secret. Only the backend may hold it.
2. Open **SQL Editor** and make sure every migration has been run, in this order. Each one is safe to run again:

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
Server/manual_migrations/20261006_system_control_verification.sql
```

3. Check the last two ran: `SELECT to_regclass('public.auctions'), to_regclass('public.system_settings');` should return two names, not nulls.
4. If this is a new database, make yourself the first Super Admin. Register on the site, then run:

```sql
UPDATE public.user_profiles SET access_level = 'super_admin' WHERE email = 'you@umak.edu.ph';
```

> Supabase free projects pause after 7 days without activity. If the site stops responding after a quiet week, open the dashboard and press **Restore**.

---

## Step 2. Render (API)

### 2a. Create the service from the Blueprint

1. Sign in at <https://dashboard.render.com> with GitHub.
2. Click **New > Blueprint**, pick your repository and press **Connect**.
3. Render reads `render.yaml` and shows a service called `ebalik-api`. It asks for the secret values (next table). Fill them in, then press **Apply**.

### 2b. Environment variables

Paste these into Render (during Blueprint setup, or later under **ebalik-api > Environment**). Items marked *auto* are already set by `render.yaml`.

| Variable | Value | Notes |
| --- | --- | --- |
| `FLASK_ENV` | `production` | *auto* |
| `PYTHON_VERSION` | `3.13.4` | *auto*. If Render rejects it, use `3.12.8`. |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | From Step 1 |
| `SUPABASE_KEY` | the **anon public** key | From Step 1 |
| `SUPABASE_SERVICE_KEY` | the **service_role** key | From Step 1. Secret. |
| `JWT_SECRET_KEY` | a long random string | *auto-generated* by Render. Changing it later signs everyone out. |
| `APP_ENCRYPTION_KEY` | 32 random bytes as base64 | Generate: `python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"`. **If admins already enrolled in MFA, paste the same value from your local `.env`**, or their authenticator codes stop working. |
| `CORS_ORIGINS` | `https://YOUR-SITE.vercel.app` | Leave a placeholder now and fix it in Step 4. No trailing slash. |
| `GOOGLE_CLIENT_ID` | your Google OAuth client ID | Optional. Needed only for Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | your Google OAuth client secret | Optional. |
| `AUCTION_EMAIL_MODE` | `mock` | *auto*. `mock` only logs winner emails. Use `sendgrid` to send real ones. |
| `SENDGRID_API_KEY` | your SendGrid key | Optional. Needed for real emails and OTP mail. |
| `SENDGRID_FROM_EMAIL` | a verified sender address | Optional. |
| `OTP_EXPIRATION_MINUTES` | `10` | *auto* |

The same list, as a file you can read side by side, is `Environment_Configs/backend/production.env.example`.

### 2c. Check it

1. Wait for the first deploy to say **Live** (a few minutes).
2. Copy the service URL at the top, for example `https://ebalik-api.onrender.com`.
3. Open `https://ebalik-api.onrender.com/api/system/status`. You should see `{"maintenance":false,...}`.

### 2d. Doing it by hand instead of the Blueprint

**New > Web Service**, choose the repo, then set:

| Field | Value |
| --- | --- |
| Runtime | Python 3 |
| Region | Singapore |
| Build Command | `pip install --upgrade pip && pip install -r Server/requirements.txt` |
| Start Command | `gunicorn --chdir Server run:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120` |
| Health Check Path | `/api/system/status` |
| Instance Type | Free |

Then add the variables from the table above.

---

## Step 3. Vercel (website)

1. Sign in at <https://vercel.com> with GitHub and click **Add New > Project**.
2. Import your repository.
3. Leave **Root Directory** as the repository root. Vercel reads `vercel.json`, so the install command, build command and output folder are already set. Do not change them. (They should read: build `npm run build:vercel`, output `Users/Frontend/dist`.)
4. Open **Environment Variables** and add these (apply to Production, Preview and Development):

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | your Render URL from Step 2c, no trailing slash, e.g. `https://ebalik-api.onrender.com` |
| `VITE_API_TIMEOUT` | `60000` (the free API needs time to wake up) |
| `VITE_ENV` | `production` |
| `VITE_ENABLE_OTP_VERIFICATION` | `true` |
| `VITE_ENABLE_PASSWORD_RESET` | `true` |
| `VITE_GOOGLE_CLIENT_ID` | your Google client ID (optional) |

   Do **not** set `VITE_ADMIN_URL`. The admin console is served at `/admin/` automatically. The same list is in `Environment_Configs/frontend/production.env.example`.

   These values are public in the built site. Never put the Supabase service key or any secret here.

5. Press **Deploy**. When it finishes, copy your site address, for example `https://ebalik.vercel.app`.
6. Open it. The user app loads at `/` and the admin console at `/admin/`.

---

## Step 4. Tell the API about your site (CORS)

The browser blocks calls to the API until the API trusts your site.

1. In Render open **ebalik-api > Environment**.
2. Set `CORS_ORIGINS` to your Vercel address: `https://ebalik.vercel.app`. Use no trailing slash. If you also use a custom domain, add it after a comma: `https://ebalik.vercel.app,https://ebalik.example.com`.
3. Save. Render redeploys by itself.

Preview deployments on Vercel have different addresses and will not be trusted. Test on your main address.

---

## Step 5. Google sign-in (skip if you do not use it)

In <https://console.cloud.google.com/apis/credentials>, open your OAuth client and under **Authorized JavaScript origins** add `https://ebalik.vercel.app` (your Vercel address). Save, and wait a few minutes.

---

## Step 6. Check everything

- [ ] `https://YOUR-API.onrender.com/api/system/status` returns JSON.
- [ ] The site loads and the landing page shows the live board.
- [ ] You can register or sign in as a normal user.
- [ ] Signing in as a Super Admin takes you to `/admin/`.
- [ ] In the admin console, **System control** loads without a setup warning.
- [ ] Uploading a report photo works (this proves Supabase storage and CORS).

---

## Keeping it fast and awake

- **Render free** puts the API to sleep after 15 idle minutes. The next visit waits about 30 to 60 seconds. To avoid it, create a free monitor at <https://uptimerobot.com> that requests `https://YOUR-API.onrender.com/api/system/status` every 10 minutes. Free instances have a monthly hour limit, so a ping every 10 minutes is the most you need.
- **Vercel Hobby** is for personal and non-commercial use.
- **Supabase free** pauses after 7 days idle (see Step 1).

---

## Updating the site later

Push to `main`. Vercel and Render both redeploy on their own. If you change a `VITE_` value you must trigger a new Vercel deploy, because it is baked into the build. When a new SQL migration is added, run it in the Supabase SQL Editor before (or right after) deploying the code that needs it.

---

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Browser console shows a CORS error | `CORS_ORIGINS` on Render does not exactly match your site address (check `https`, no trailing slash, no typo). Save and wait for the redeploy. |
| Everything says "Request timeout" on first visit | The API is waking up. Wait a minute and retry, and set `VITE_API_TIMEOUT=60000`. |
| Render build fails on a package | Set `PYTHON_VERSION` to `3.12.8` and redeploy. |
| Render says the service failed to bind a port | Make sure the start command uses `$PORT` exactly as written above. |
| `/admin/` shows a blank page | The Vercel build must run `npm run build:vercel`. Check **Settings > Build & Development** matches `vercel.json`. |
| Admin sign-in loops back to the user app | `VITE_ADMIN_URL` is set. Remove it and redeploy. |
| Sign-in says maintenance mode | A Super Admin turned on maintenance. Sign in at the user site with an admin account and open **System control**. |
| Features like auctions return 503 `setup_required` | The migrations in Step 1 have not all been run. |
| Admin MFA codes stopped working | `APP_ENCRYPTION_KEY` on Render differs from the key used when MFA was set up. |

---

## Security reminders

- `SUPABASE_SERVICE_KEY`, `JWT_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET` and `SENDGRID_API_KEY` belong **only** in Render. If one ever leaks, rotate it in its own dashboard and update Render.
- Keep the GitHub repository private if it ever contains anything you would not publish.
- Do not commit `.env` files. The `*.example` files in `Environment_Configs/` hold placeholders only.
