# Supabase backup: the setup we actually did, step by step

This is the record of how the E-Balik backup was set up on 2026-10-20 (Supabase Free plan, GitHub Actions, Google Drive), including every problem we hit and its fix. Use it to repeat the setup for E-Balik or for another project. The day-to-day reference (what it does, how to restore) is `docs/BACKUP_GUIDE.md`.

---

## 1. What the backup does

Supabase Free has no backups you can download. A GitHub Actions workflow (`.github/workflows/backup.yml`) makes them for you and stores them in Google Drive.

### Nightly job: "backup" (every day 08:00 Manila time)
| | |
|---|---|
| **What it saves** | A full `pg_dump` of the Postgres database: every table and its rows, the table structure, indexes, policies (RLS), functions and triggers, the sign-in accounts (including password hashes), and the list of stored files (the storage table rows). |
| **What it does NOT save** | The photo files themselves, Supabase project settings, API keys, Edge Functions, your app's code (that is in GitHub), and Render or Vercel settings. |
| **How** | `pg_dump` over the Supabase **Session pooler** > gzip > a size check (refuses a dump under 2 KB) > encrypted with `gpg` (AES-256) using `BACKUP_PASSPHRASE` > uploaded to Google Drive > checked that the uploaded size matches > files older than 30 days deleted. |
| **File name** | `ebalik-db-<run number>.sql.gz.gpg` |
| **Why it matters** | Restore everything, including user accounts, into a fresh Postgres/Supabase project with `psql`. |

### Weekly job: "portable" (Sundays 09:00 Manila time, or when started by hand with the box ticked)
| | |
|---|---|
| **What it saves** | Every table in the `public` schema as readable rows (one JSON row per line), plus the photos from the storage buckets `found-item-images` and `missing-item-images`. One-time codes (`otp_tokens`) and admin sign-in challenges are left out on purpose. |
| **What it does NOT save** | Sign-in accounts (they live in Supabase's own auth area), table structure (you recreate it by running the SQL migrations), and any other storage bucket unless you add it with `--buckets`. |
| **How** | `Server/scripts/backup_database.py --with-files`: reads through the Supabase REST API with the service key, zips it, encrypts it (AES-256-GCM in 1 MB pieces, key from your passphrase via scrypt). Always encrypted. |
| **File name** | `ebalik-backup-<date>.zip.enc` (kept 60 days) |
| **Why it matters** | Restores into any Supabase project with `Server/scripts/restore_database.py`, including the photos, and can restore single tables. |

### Reporting
After a successful nightly run the workflow writes the result to the `system_settings` table (`setting_key = last_backup`). The admin console shows it under **System Control > Monitoring > Database backups**, and the health scan warns if the last backup is older than 36 hours, 7 days, or unencrypted.

---

## 2. What you need

- A Supabase project, and its database password.
- A GitHub repository with the workflow file (already in this repo).
- A Google account to hold the backups (a dedicated one is best).
- A computer with `rclone` (installed once, only to create the Google login).
- A passphrase you will not lose.

---

## 3. Step by step

### Step 1: The Supabase connection string (Session pooler)
GitHub's servers cannot reach Supabase's "Direct connection" host on the Free plan (it is IPv6 only).
1. Supabase dashboard > **Connect** > **Connection string** > method **Session pooler**.
2. Copy the URI. It must look like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`. The user part is `postgres.<project-ref>`, not plain `postgres`.
3. Replace `[YOUR-PASSWORD]` with the database password and **delete the square brackets**.
4. If you do not know the password: **Project Settings > Database > Reset database password**. Use only letters and numbers (characters like `@ # / %` break the string). This does not affect the app, which uses API keys.
5. Save the finished string. It is `SUPABASE_DB_URL`.

### Step 2: The Supabase URL and service key
1. **Project Settings > API Keys** (or **Data API**).
2. **Project URL**, e.g. `https://abcdefgh.supabase.co`. It is `SUPABASE_URL`. (It is also `https://<project-ref>.supabase.co`, and the project ref is in the dashboard address.)
3. The **service_role** key: open the tab **Legacy anon, service_role API keys** and copy `service_role` (starts with `eyJ`). It is `SUPABASE_SERVICE_KEY`. Do not use the publishable or anon key.
4. This key can read and change everything. Never put it in a file in the repo, a chat or a screenshot.

### Step 3: Connect Google Drive with rclone
1. Install rclone (Windows: `winget install Rclone.Rclone`, then reopen the terminal). Check with `rclone version`.
2. Run `rclone config`, then answer:
   - `n` (new remote), name: **`gdrive`** (exactly)
   - Storage: the number for **drive** (Google Drive)
   - client_id and client_secret: blank (see the note below about your own client ID)
   - scope: **`1`** (full access). Not `drive.file`: it cannot see a folder you made by hand.
   - service_account_file: blank. Advanced config: `n`. Web browser sign-in: `y`.
   - Sign in with the backup Google account and allow it. Shared Drive: `n`. Keep the remote: `y`. Quit: `q`.
3. Run `rclone config show gdrive` and copy from `[gdrive]` to the end of the `token = ...` line.
4. **The copied text must be four separate lines** (`[gdrive]`, `type = drive`, `scope = drive`, `token = {...}`). In our first try the secret was one line (`[gdrive] type=drive, scope=drive, token = ...`) and rclone failed with "didn't find section in config file". If it pastes onto one line, type the first three lines by hand and paste only the token line.
5. This text is a login to that Drive: treat it like a password. It is `RCLONE_CONFIG_DATA`.

> **Google's notice about the shared client ID.** rclone's built-in Google client ID is being retired in 2026. It still worked on 2026-10-20, and the admin console card turns red if uploads stop. To replace it: Google Cloud Console > new project > enable the **Google Drive API** > **Google Auth Platform**: Branding (app name, support email, developer contact email; do **not** upload a logo, which triggers verification) > Data Access (add scope `https://www.googleapis.com/auth/drive`) > Audience > **Publish app** (so the login does not expire after 7 days in "Testing") > Clients > Create client > **Desktop app**. Then `rclone config` > `e` > `gdrive`, paste the Client ID and secret, sign in again, and replace the `RCLONE_CONFIG_DATA` secret. The Publish button stays grey until Branding is saved with a developer contact.

### Step 4: The Drive folder
1. drive.google.com (same account as rclone) > **New > New folder** > `E-Balik backups`.
2. Open it. The address is `.../drive/folders/<ID>`. The ID is `GDRIVE_FOLDER_ID`.
3. Optional check (type it exactly; plain `rclone lsd <id>` fails because rclone treats a bare id as a folder on your computer):
   ```
   rclone lsd "gdrive,root_folder_id=<ID>:"
   ```
   Nothing printed and no error means success.

### Step 5: The passphrase
1. Make a long passphrase (at least 12 characters, several random words).
2. Store it in a password manager **and** on paper somewhere safe. **If it is lost, the backups cannot be opened by anyone.** It is `BACKUP_PASSPHRASE`.

### Step 6: Add the six secrets in GitHub
Repo > **Settings > Secrets and variables > Actions > New repository secret**. Names are case sensitive. If a name already exists, use the pencil icon to replace the value.

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | the Session pooler string from Step 1 |
| `RCLONE_CONFIG_DATA` | the four-line `[gdrive]` block from Step 3 |
| `GDRIVE_FOLDER_ID` | the folder id from Step 4 |
| `BACKUP_PASSPHRASE` | the passphrase from Step 5 |
| `SUPABASE_URL` | from Step 2 |
| `SUPABASE_SERVICE_KEY` | from Step 2 |

### Step 7: Run it
1. **Actions** tab > **Backup Supabase Database**. If it shows "Disabled", press **Enable workflow** first (GitHub disables workflows that keep failing, or repos with no activity for 60 days).
2. **Run workflow**, tick **Also run the portable backup with photos**, press the green **Run workflow**.
3. Wait 1 to 3 minutes. Both jobs (**backup** and **portable**) should show a green tick.
4. If a job is red, open it, open the red step, and read the last lines (see section 4).
5. If you re-run after changing a secret, use **Re-run all jobs**.

### Step 8: Check the result
1. The Drive folder holds `ebalik-db-....sql.gz.gpg` and `ebalik-backup-....zip.enc`.
2. Admin console > **System Control > Monitoring > Database backups > Check again**: "Backups are running", encrypted, saved to Google Drive.
3. After this it runs by itself every night and every Sunday.

### Step 9: Practise a restore (once)
On an empty test Supabase project (never on the real one). The restore steps are in `docs/BACKUP_GUIDE.md`, section 3. A backup that has never been restored is only a hope.

---

## 4. Problems we hit and how they were fixed

| What we saw | Cause | Fix |
|---|---|---|
| The old workflow had 72 red runs and showed "Disabled" | Old secrets and the old direct connection | Replace the secrets, press **Enable workflow**, run again. Old red runs can be ignored. |
| `password authentication failed for user "postgres"` | Wrong password, or a connection string whose user was not `postgres.<project-ref>` | Reset the DB password to letters and numbers only, copy a fresh **Session pooler** string, remove the brackets, update `SUPABASE_DB_URL`. |
| `didn't find section in config file` (rclone) | `RCLONE_CONFIG_DATA` was one line, or not the `[gdrive]` block | Paste it as four separate lines starting with `[gdrive]` (Step 3, point 4). |
| `BACKUP_PASSPHRASE repository secret is required` (portable job) | The secret was missing or misspelled | Add `BACKUP_PASSPHRASE` exactly. Without it the nightly job warns "NOT encrypted". |
| `rclone lsd <id>` says "directory not found" | rclone read the id as a local folder | Use `rclone lsd "gdrive,root_folder_id=<id>:"`. |
| Google "Publish app" button grey | Branding incomplete | Save Branding with app name, support email and developer contact email, leave the logo empty, reload Audience. |
| "Network is unreachable" | Direct connection string (IPv6 only) | Use the Session pooler string. |
| rclone `invalid_grant` / token errors | The Google login expired or was revoked | Redo Step 3 and replace `RCLONE_CONFIG_DATA`. |

---

## 5. Using this for another project

The nightly dump is not specific to E-Balik.

1. Copy `.github/workflows/backup.yml` into the other repo.
2. In that repo add the same secrets. You can reuse `RCLONE_CONFIG_DATA` and the Drive account; use a **different** `GDRIVE_FOLDER_ID` (a new folder per project) and a **different** `BACKUP_PASSPHRASE`. `SUPABASE_DB_URL` comes from that project's own Supabase.
3. Change the file names in the workflow if you want (`ebalik-db-` appears in the prune step and `BACKUP_BASENAME`; `ebalik-backup-` appears in the portable job).
4. The steps "Report success/failure to the admin console" write to E-Balik's `system_settings` table. For another project either delete those two steps, or leave `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` unset: the steps then skip themselves.
5. The portable job needs `Server/scripts/backup_database.py` and `restore_database.py` in the repo, and its bucket names (`found-item-images`, `missing-item-images`) are E-Balik's. For another project copy both scripts and pass its buckets with `--buckets name1,name2`, or delete the `portable` job and use the nightly dump only.
6. Run it by hand once (Step 7), check the Drive, and practise one restore.

---

## 6. Keeping it healthy

- Monthly: confirm the Monitoring card is green and Drive has a file from this week.
- GitHub turns off scheduled workflows after 60 days with no activity in the repo. If backups stop, open the Actions tab and press **Enable workflow**.
- If you reset the database password, update `SUPABASE_DB_URL` the same day.
- If you rotate the service key, update `SUPABASE_SERVICE_KEY`.
- Never commit secrets, the `backups/` folder or any `.enc` / `.gpg` file. `backups/` and `portable/` are in `.gitignore`.
