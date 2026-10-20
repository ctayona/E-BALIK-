# E-Balik: Step-by-Step Setup (run it on your own computer)

E-Balik is the University of Makati lost-and-found system. This guide takes you from an empty computer to the running system, one step at a time. Allow about 45 minutes, most of it waiting for downloads.

The system has four parts. Steps 1 to 5 prepare them and step 6 starts them.

| Part | What it is | Where it runs on your computer |
|---|---|---|
| Database | Supabase (a free online PostgreSQL database and file storage) | the internet, you create it in step 3 |
| Backend (API) | Python and Flask | http://localhost:5000 |
| User website | React (Vite) | http://localhost:5173 |
| Admin console | React (Vite) | http://localhost:5173/admin/ |

The commands below were run on a clean copy of the repository for this guide: the installs, both website builds and the backend start worked, and the 830 automated backend tests passed. The only part that needs your own account is Supabase (step 3), because the system stores its data there.

---

## 1. Install the tools

You need three free programs. Install them, then open a **new** terminal window and run the check commands.

| Tool | Version | Download | Check |
|---|---|---|---|
| Git | any recent | https://git-scm.com/downloads | `git --version` |
| Node.js (includes npm) | 22 (the project asks for 22.x; newer versions such as 24 also worked, with a harmless warning) | https://nodejs.org | `node --version` |
| Python | 3.13 (3.13 was used for development and for the live server) | https://www.python.org/downloads | `python --version` (on macOS or Linux use `python3 --version`) |

On Windows, tick **Add python.exe to PATH** in the Python installer.

You also need a web browser (Chrome, Edge or Firefox) and a free Supabase account (step 3).

---

## 2. Get the code and install it

Open a terminal (PowerShell or Command Prompt on Windows, Terminal on macOS or Linux).

```bash
git clone https://github.com/ctayona/E-BALIK-.git
cd E-BALIK-
```

The folder you are in now is called **the project folder** in the rest of this guide.

### 2.1 Website dependencies (about 5 minutes the first time)

```bash
npm install
cd Admin/Frontend
npm install
cd ../..
```

The first `npm install` serves the user website and is the slow one. A message about the Node version ("EBADENGINE") is only a warning.

### 2.2 Backend dependencies

Create a private Python environment inside the `Server` folder and install the requirements.

**Windows (PowerShell or Command Prompt):**

```bash
cd Server
python -m venv venv
venv\Scripts\python -m pip install --upgrade pip
venv\Scripts\python -m pip install -r requirements.txt
cd ..
```

**macOS or Linux:**

```bash
cd Server
python3 -m venv venv
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements.txt
cd ..
```

A line saying that `email-validator 2.1.0` is a "yanked version" is only a warning. The install is fine when the command finishes without the word `ERROR`.

---

## 3. Create the database (Supabase)

The system keeps accounts, reports, claims, auctions, Smart Tags and uploaded photos in Supabase.

### 3.1 Create the project

1. Go to https://supabase.com, sign up (free) and click **New project**.
2. Give it any name (for example `ebalik-local`), choose a database password (write it down) and the region closest to you, then click **Create new project**. Wait until it says the project is ready (about 2 minutes).

### 3.2 Copy the three values the backend needs

1. In the project, click the gear icon, **Project Settings**, then **API Keys** (older dashboards call it **API**).
2. Copy the **Project URL**. It looks like `https://abcdxyz.supabase.co`.
3. Copy the **anon** key and the **service_role** key.
   - If the page only shows keys starting with `sb_publishable_` and `sb_secret_`, open the tab named **Legacy API keys** and copy the `anon` and `service_role` keys there. They are long and start with `eyJ`. The system was built for these legacy keys.
   - The service_role key has full access to your database. Keep it private.

### 3.3 Create the tables

1. In Supabase click **SQL Editor**, then **New query**.
2. Open the files below **one at a time**, in exactly this order. For each file: open it in any text editor, copy **all** of its text, paste it into the SQL Editor and click **Run**. Wait for "Success" before the next file.
3. Every file is safe to run again, so if you are unsure whether one ran, run it again.

```text
Server/database_schema.sql
Server/manual_migrations/20260928_claim_identity_and_admin_access.sql
Server/manual_migrations/20260929_admin_totp_mfa.sql
Server/manual_migrations/20260930_account_verification_review.sql
Server/manual_migrations/20260930_admin_item_management.sql
Server/manual_migrations/20260930_claim_history_reference_and_superadmin_delete.sql
Server/manual_migrations/20261003_superadmin_delete_user.sql
Server/manual_migrations/20261004_claim_report_closeout.sql
Server/manual_migrations/20261005_auction_hall.sql
Server/manual_migrations/20261005b_auction_awaiting_admin_baseline.sql
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
Server/manual_migrations/20261017_custody_log_receipts_and_migration_log.sql
Server/manual_migrations/20261018_auction_handover_pin.sql
Server/manual_migrations/20261019_tag_contact_links.sql
Server/manual_migrations/20261020_otp_attempts.sql
Server/manual_migrations/20261021_report_comments_and_reactions.sql
Server/manual_migrations/20261022_income_ledger.sql
Server/manual_migrations/20261023_image_features.sql
```

That is 28 files. The first creates the base tables and the photo storage areas; the others add the later features (auctions, Smart Tags, comments and so on). If a file stops with an error, read the message and see the troubleshooting table at the end.

### 3.4 Check that it worked

In the SQL Editor run this and press **Run**:

```sql
SELECT to_regclass('public.auctions') AS auctions,
       to_regclass('public.report_comments') AS comments,
       (SELECT count(*) FROM public.migration_log) AS migrations_recorded;
```

You should see the names `auctions` and `report_comments`, and a number above 0 for migrations recorded. If a name shows empty, a file in 3.3 was skipped: run it, then run the check again.

---

## 4. Configure the backend

The backend reads its settings from one file that you create. It is never uploaded to GitHub.

1. Open the folder `Environment_Configs/backend`.
2. Create a new file named exactly `.env` (a dot at the start, no other extension). On Windows, create it in a text editor and choose **Save as**, type `.env` in quotes (`".env"`) so that no `.txt` is added.
3. Paste the following and replace the three Supabase values with the ones from step 3.2.

```text
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
JWT_SECRET_KEY=PASTE-VALUE-FROM-COMMAND-1
APP_ENCRYPTION_KEY=PASTE-VALUE-FROM-COMMAND-2
```

4. Make the two secret values. Run each command and paste what it prints after the `=` sign. Use `python3` instead of `python` on macOS or Linux.

   **Command 1** (for `JWT_SECRET_KEY`):

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

   **Command 2** (for `APP_ENCRYPTION_KEY`):

   ```bash
   python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
   ```

   Keep the same `APP_ENCRYPTION_KEY` for as long as you use this database; changing it makes saved administrator authenticator secrets unreadable.

5. Do **not** add `FLASK_ENV=production`. Leave it out for a local run.

Everything else in that file is optional (see "Optional features" at the end). The user website needs no settings file: it talks to `http://localhost:5000`, which is where the backend runs.

---

## 5. Create your first accounts

Normally a new user registers on the website and receives a six-digit code by email. Sending that email needs a SendGrid account, which this local setup does not use. So create the first accounts with the helper script instead. It writes the account straight into your Supabase database and marks it as verified.

Run these from the project folder. Choose your own passwords: they must have **at least 16 characters**. The script asks for the password when you press Enter, so it does not stay in your command history.

**Windows:**

```bash
cd Server
venv\Scripts\python scripts\create_local_account.py --email admin@umak.edu.ph --first Admin --last Teacher --level super_admin
venv\Scripts\python scripts\create_local_account.py --email student@umak.edu.ph --first Juan --last "Dela Cruz" --level user
cd ..
```

**macOS or Linux:**

```bash
cd Server
venv/bin/python scripts/create_local_account.py --email admin@umak.edu.ph --first Admin --last Teacher --level super_admin
venv/bin/python scripts/create_local_account.py --email student@umak.edu.ph --first Juan --last "Dela Cruz" --level user
cd ..
```

You should see `Created admin@umak.edu.ph with level super_admin (verified).` for each. Running the same command again for the same email resets that account's password.

| Level | What the account can do |
|---|---|
| `super_admin` | everything, including the admin console and system settings |
| `admin` | the admin console |
| `guard` | the security release desk |
| `user` | the normal user website (report items, claim, bid) |

---

## 6. Start the system

You need **three terminal windows**, all opened in the project folder, and all left running while you use the system.

**Terminal 1: the backend**

Windows:

```bash
cd Server
venv\Scripts\python run.py
```

macOS or Linux:

```bash
cd Server
venv/bin/python run.py
```

Wait until you see `Server: http://localhost:5000`.

**Terminal 2: the user website**

```bash
npm run dev:frontend
```

Wait until you see `Local: http://localhost:5173/`.

**Terminal 3: the admin console**

```bash
cd Admin/Frontend
npm run dev -- --port 8443
```

Wait until you see `Local: http://localhost:8443/`.

On Windows you can start all three with one command instead: run `npm run dev` in the project folder. It starts the backend, the user website and the admin console together (it needs steps 2.1 and 2.2 done first).

To stop the system press `Ctrl + C` in each terminal.

---

## 7. Use it

1. Open **http://localhost:5173** in your browser. You should see the E-Balik home page.
2. Click **Log in** and sign in with the student account from step 5. You land on the home feed.
3. Try the main features: **Report item** (Found or Lost, with a photo), **Browse**, **Claims**, **Smart Tags**, **Auction Hall**.
4. Open **http://localhost:5173/admin/** and sign in with the `super_admin` account to review reports, claims, verifications and auctions.

A new database starts empty: it has no items, auctions or Smart Tags until someone creates them. This is intended (the system uses real data, not sample data). A quick way to see everything work:

1. As the **student**: report a found item (Report item, then I found an item). Photos are uploaded to your Supabase storage.
2. As the **admin**: open the admin console, **Reports**, and see the report; open **Smart tags** and generate a batch of tags; open **Auctions** to create an auction from an eligible item.
3. As the **student**: open **Auction Hall** to see and bid on the auction; open **My Smart Tags** to register a tag.

Accounts that are not verified cannot report items, claim or bid. The accounts made by the script are already verified. A person who registers normally uploads an ID and an administrator verifies it in the admin console, **Users**.

---

## 8. Optional features

None of these are needed to run the system. Add them to `Environment_Configs/backend/.env` and restart the backend (Terminal 1).

| Feature | Settings | Note |
|---|---|---|
| Emails and the registration code by email | `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` | Needs a SendGrid account and a verified sender. Without it, new users cannot register through the website (use the script in step 5) and notification emails are not sent. The in-app notifications always work. |
| Sign in with Google | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and `VITE_GOOGLE_CLIENT_ID` in `Environment_Configs/frontend/.env.local` | Needs a Google Cloud OAuth client with `http://localhost:5173` as an allowed origin. |
| Administrator authenticator app | none | Optional for each administrator: open **My Profile** in the admin console and choose Enable Google Authenticator. Leave it off for a classroom demo. |
| Smart Tag QR codes that work on phones | `PUBLIC_SITE_URL` | Locally the QR code points to `http://localhost:5173`, which only works on this computer. Print real stickers only from a deployed site (see `SMART_TAGS_GUIDE.md`). |

For publishing the system on the internet (Vercel and Render) see `DEPLOYMENT_GUIDE.md`.

---

## 9. Run the automated tests (optional)

With the backend environment from step 2.2, from the project folder:

Windows:

```bash
cd Server
venv\Scripts\python -m unittest discover -s tests -p "test_*.py"
```

macOS or Linux:

```bash
cd Server
venv/bin/python -m unittest discover -s tests -p "test_*.py"
```

The last lines should read `Ran 830 tests` and `OK`. These tests use an in-memory database, so they do not touch Supabase and need no `.env` file.

---

## 10. Troubleshooting

| What you see | What it means and what to do |
|---|---|
| `python` or `node` is "not recognized" | The tool is not installed or the terminal was open before the install. Install it (step 1), then open a **new** terminal. On macOS or Linux use `python3`. |
| `npm install` is slow or seems stuck | The first install downloads about 300 packages and can take 5 minutes. Wait for it to return to the prompt. |
| `Invalid API key` in the backend window | A key in `Environment_Configs/backend/.env` is wrong. Use the **anon** and **service_role** keys (the long ones starting with `eyJ`, see "Legacy API keys" in step 3.2). There must be no spaces or quotes around the values. Restart the backend after editing. |
| The website loads but every action says it cannot reach the server | The backend (Terminal 1) is not running, or it stopped. Start it and look for `Server: http://localhost:5000`. |
| Port already in use (5000, 5173 or 8443) | Another program is using the port. Close it, or stop an earlier copy of E-Balik with `Ctrl + C`. |
| Browser shows a CORS error | Open the site at exactly `http://localhost:5173` (not another address). Do not set `CORS_ORIGINS` for a local run. |
| `could not find the table` or `relation ... does not exist` | A file from step 3.3 was not run. Run the check in step 3.4, then run the missing file. |
| An SQL file shows an error | Make sure the files were run in the order listed and that you pasted the **whole** file. Run the earlier file again, then the failing one. |
| The helper script says `SUPABASE_URL and SUPABASE_SERVICE_KEY are missing` | The `.env` file is in the wrong place or misnamed. It must be `Environment_Configs/backend/.env`. |
| `The password must have at least 16 characters` | Choose a longer password, for example three words and numbers. |
| Cannot sign in with the new account | Check the email and password, then run the step 5 command again for that email to reset the password. After several wrong tries an account is locked for a short time: wait a few minutes. |
| Registering a new user on the website fails | The registration code is sent by email (see "Optional features"). Create the account with the script in step 5 instead. |
| PowerShell says running scripts is disabled | The commands in this guide do not need to activate the environment: use them exactly as written (`venv\Scripts\python ...`). |

---

## Quick reference

| What | Command or address |
|---|---|
| Start the backend | `cd Server` then `venv\Scripts\python run.py` (Windows) or `venv/bin/python run.py` |
| Start the user website | `npm run dev:frontend` |
| Start the admin console | `cd Admin/Frontend` then `npm run dev -- --port 8443` |
| User website | http://localhost:5173 |
| Admin console | http://localhost:5173/admin/ |
| Backend | http://localhost:5000 |
| Create or reset an account | `python scripts/create_local_account.py --email ... --first ... --last ... --level ...` (from `Server`, with the venv Python) |
| Backend settings file | `Environment_Configs/backend/.env` |
| Run the tests | `cd Server` then `venv\Scripts\python -m unittest discover -s tests -p "test_*.py"` |
