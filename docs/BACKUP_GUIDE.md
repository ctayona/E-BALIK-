# E-Balik backup guide (Supabase Free plan)

Supabase Free does **not** give you backups you can download or restore from the dashboard (daily backups and point-in-time recovery are paid features). If the project is deleted, paused for too long, or a bad migration wipes a table, nothing comes back unless you made your own copy. This guide sets up two copies that cost nothing.

| | Nightly database dump | Weekly portable backup |
|---|---|---|
| What | The whole Postgres database (`pg_dump`), including the sign-in accounts | Every table as readable rows, plus the uploaded photos |
| Made by | GitHub Actions, every day 08:00 Manila | GitHub Actions on Sundays, or by hand on your computer |
| Restores into | A Postgres database (`psql`) | Any Supabase project, with `Server/scripts/restore_database.py` |
| Kept in | Google Drive, 30 days | Google Drive, 60 days |
| Encrypted | Yes, with `BACKUP_PASSPHRASE` | Always |

Both are encrypted because they contain every user's name, email and campus ID. **Keep the passphrase somewhere other than this repository and your laptop** (a password manager, plus a printed copy with the adviser). A backup you cannot decrypt is worth nothing.

The admin console shows the result under **System Control > Monitoring > Database backups**, and the health scan warns when a backup is missing or older than a day and a half.

---

## 1. One-time setup (about 20 minutes)

### 1.1 Use the pooler connection string
GitHub's runners cannot reach the "Direct connection" host (`db.<project>.supabase.co`) because on the Free plan it only has an IPv6 address.

1. Supabase dashboard > **Connect** > **Session pooler**.
2. Copy the URI (it looks like `postgresql://postgres.<project>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`) and put your database password in place of `[YOUR-PASSWORD]`.

### 1.2 Google Drive through rclone
1. On your computer install [rclone](https://rclone.org/downloads/) and run `rclone config`.
2. `n` (new remote), name it **`gdrive`**, storage type **drive**, leave client id/secret empty, scope **drive** (or `drive.file`), then sign in with the Google account that will own the backups. Use a dedicated account, not a personal one.
3. Print the config with `rclone config show gdrive`. Copy everything from `[gdrive]` to the end. This is the value of `RCLONE_CONFIG_DATA`.
4. In Google Drive create a folder (for example `E-Balik backups`). Open it: the long id at the end of the address is `GDRIVE_FOLDER_ID`.

### 1.3 Repository secrets
GitHub > the repository > **Settings > Secrets and variables > Actions > New repository secret**.

| Secret | Value | Needed for |
|---|---|---|
| `SUPABASE_DB_URL` | the pooler URI from 1.1 | nightly dump |
| `RCLONE_CONFIG_DATA` | the rclone config text from 1.2 | both |
| `GDRIVE_FOLDER_ID` | the folder id from 1.2 | both |
| `BACKUP_PASSPHRASE` | a long passphrase, at least 12 characters, ideally 4+ random words | encryption (strongly recommended; required for the portable backup) |
| `SUPABASE_URL` | the project URL (`https://xxxx.supabase.co`) | reporting to the admin console, portable backup |
| `SUPABASE_SERVICE_KEY` | the `service_role` key | reporting to the admin console, portable backup |

Never put any of these in a file in the repository.

### 1.4 First run
GitHub > **Actions > Backup Supabase Database > Run workflow**, tick "Also run the portable backup with photos". Both jobs should turn green, two files should appear in the Drive folder (`ebalik-db-....sql.gz.gpg` and `ebalik-backup-....zip.enc`), and Monitoring in the admin console should say **Backups are running**.

If the nightly job fails with "Network is unreachable", the connection string is the direct one: use the pooler (1.1).

---

## 2. Making a backup by hand (before a risky migration, or any time)

From the repository folder, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `Environment_Configs/backend/.env`:

```bash
pip install cryptography
python Server/scripts/backup_database.py --with-files
```

It asks for a passphrase, writes `backups/ebalik-backup-<date>.zip.enc` and tells the admin console. Useful options: `--out <folder>`, `--no-record` (do not update the console), `--include-all` (also keep one-time codes). Check `backups/` is not committed (it is for your machine only).

To open one of these files yourself: `python Server/scripts/backup_database.py --decrypt backups/<file>.zip.enc`. Inside, `tables/<name>.jsonl` holds one row per line and `storage/<bucket>/` holds the photos.

---

## 3. Restoring

**Practise this once on an empty test project before you ever need it.** A backup that has never been restored is a hope, not a backup.

### 3.1 From the weekly portable backup (recommended; works on any Supabase project)
1. Make a new Supabase project (or empty the broken one) and run the SQL files in `Server/manual_migrations` as in `Step-by-Step Setup.md`, so the tables exist. The restore puts back data, not table definitions.
2. Put the **new** project's `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `Environment_Configs/backend/.env`.
3. Download the `.zip.enc` file from Drive into `backups/`.
4. Look first (nothing is written):
   ```bash
   python Server/scripts/restore_database.py backups/ebalik-backup-<date>.zip.enc
   ```
5. Then restore (you must type the project's name to confirm), adding `--with-files` for the photos:
   ```bash
   python Server/scripts/restore_database.py backups/ebalik-backup-<date>.zip.enc --apply --with-files
   ```
   Rows are upserted by primary key in several passes, so parent tables fill first. Running it twice is safe. Use `--tables claims,found_items` to restore only some tables.
6. Update `SUPABASE_URL` / keys in Render and Vercel if the project is new, then redeploy.

Sign-in accounts live in Supabase's own `auth` area, which the portable backup does not contain. After a restore into a new project, users sign in with "Forgot password", or restore the nightly dump (3.2), which does include them.

### 3.2 From the nightly dump
1. Download `ebalik-db-<id>.sql.gz.gpg` from Drive.
2. Decrypt and unpack:
   ```bash
   gpg --output dump.sql.gz --decrypt ebalik-db-<id>.sql.gz.gpg
   gunzip dump.sql.gz
   ```
3. Load it into the target database with the **session pooler** URI of that project:
   ```bash
   psql "<target pooler URI>" -f dump.sql
   ```
   The dump drops and recreates objects (`--clean --if-exists`), so use it on a new project or when you really mean to overwrite. Supabase may print permission warnings for its own system schemas; those are expected.

---

## 4. Things to know

- **Free projects pause after a week with no activity.** The nightly job touches the database every day, which also keeps the project awake.
- **GitHub disables scheduled workflows in a repository with no activity for 60 days.** If the console says backups stopped, open the Actions tab and press *Enable workflow*, or push any small change.
- **Do not store backups as GitHub "artifacts"** in a public repository: anyone can download them. The workflow uploads to Drive instead.
- **Rotate the passphrase** by choosing a new one, updating the secret, and keeping the old one for as long as old backups exist.
- **Check once a month** that Drive holds recent files and that Monitoring is green. A green card means the job reported in, not that a restore has been proven.
- The weekly portable job does not overwrite the nightly status in the console, so a failure there only shows in the GitHub Actions tab.
