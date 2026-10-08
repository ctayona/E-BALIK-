# E-BALIK DATABASE SCHEMA SETUP GUIDE

## Overview
This document describes the database schema for the E-Balik Lost & Found System at the University of Makati.

## Tables

### 1. user_profiles
**Purpose**: Store user account information
**Primary Identifiers**: account_id, campus_id, email

| Column | Type | Constraints | Description |
|--------|------|-----------|-------------|
| account_id | UUID | PRIMARY KEY | Unique account identifier (auto-generated) |
| campus_id | VARCHAR(50) | NOT NULL, UNIQUE | Student/Employee ID from input |
| fname | VARCHAR(100) | NOT NULL | First name |
| mname | VARCHAR(100) | - | Middle name (optional) |
| lname | VARCHAR(100) | NOT NULL | Last name |
| email | VARCHAR(255) | NOT NULL, UNIQUE | University email |
| password_hash | VARCHAR(255) | NOT NULL | Hashed password (bcrypt) |
| user_role | VARCHAR(50) | - | User role (empty initially, for future use) |
| created_at | TIMESTAMP | DEFAULT now() | Account creation timestamp |
| last_login_at | TIMESTAMP | - | Last successful login |
| is_active | BOOLEAN | DEFAULT true | Account active status |
| updated_at | TIMESTAMP | DEFAULT now() | Last update timestamp |

**Indexes**:
- email (for login queries)
- campus_id (for user lookup by ID)
- created_at DESC (for listing recent registrations)

### 2. otp_tokens
**Purpose**: Store OTP codes for registration verification and password reset

| Column | Type | Constraints | Description |
|--------|------|-----------|-------------|
| id | UUID | PRIMARY KEY | OTP token identifier |
| email | VARCHAR(255) | NOT NULL | Email associated with OTP |
| otp_code | VARCHAR(6) | NOT NULL | 6-digit OTP code |
| otp_type | VARCHAR(50) | NOT NULL | Type: 'registration' or 'password_reset' |
| expires_at | TIMESTAMP | NOT NULL | OTP expiration time (10 minutes) |
| is_used | BOOLEAN | DEFAULT false | Whether OTP has been used |
| created_at | TIMESTAMP | DEFAULT now() | OTP creation timestamp |

**Indexes**:
- (email, otp_type) - for finding relevant OTPs
- expires_at - for cleaning expired OTPs
- is_used - for finding valid unused OTPs

### 3. found_items (Future Use)
**Purpose**: Store information about found items
- Tracks items found on campus
- Includes item details, location, and status

### 4. missing_items (Future Use)
**Purpose**: Store information about missing items
- Tracks items reported as missing
- Includes item details and last seen information

### 5. claims (Future Use)
**Purpose**: Store claims made on found items
- Tracks when users claim found items
- Includes approval workflow status

## Setup Instructions

### Method 1: Using Supabase Web Console (Recommended)
1. Go to https://app.supabase.com
2. Select your project (E-Balik)
3. Click "SQL Editor" in the sidebar
4. Create a new query
5. Copy and paste the SQL from `database_schema.sql`
6. Click "Run" to execute all commands

### Claim completion and linked report closeout

After the base schema and claim lifecycle migrations are applied, run
`manual_migrations/20261004_claim_report_closeout.sql` in the Supabase SQL
Editor. Recording an approved claim's in-person collection then closes its
claim, the found-item listing, confirmed matching missing reports belonging to
the claimant, and any competing claims for that found item. Resolved item
reports remain available in the admin registries and are excluded from active
public search.

### Auction Hall

Run `manual_migrations/20261005_auction_hall.sql` in the Supabase SQL Editor once.
It adds the `auctions`, `auction_bids` and `auction_comments` tables and the
`auction_place_bid` and `auction_settle_due` functions. It is additive and safe
to rerun, and it does not change any existing table. Until it is applied, the
Auction Hall endpoints answer 503 and the admin Auctions page shows the setup
steps. Verify with:

```sql
SELECT to_regclass('public.auctions'), to_regclass('public.auction_bids'), to_regclass('public.auction_comments');
SELECT proname FROM pg_proc WHERE proname IN ('auction_place_bid', 'auction_settle_due');
```

Optional env var: `AUCTION_EMAIL_MODE` (`mock` logs the winner email, `sendgrid` sends it).

### System control, verification roles and suspensions

Run `manual_migrations/20261006_system_control_verification.sql` in the Supabase
SQL Editor **after** `20261005_auction_hall.sql` (it changes the auction status
rules). It adds `user_profiles.user_category`, `suspended_until`,
`suspension_reason` and `suspended_by`, the `system_settings` table, the
"awaiting admin" auction status and the `auction_finalize` function. It is
additive and safe to rerun, and it backfills `user_category` for accounts that
were already verified. Verify with:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'user_profiles' AND column_name IN ('user_category', 'suspended_until', 'suspension_reason', 'suspended_by');
SELECT to_regclass('public.system_settings');
SELECT setting_key FROM system_settings;
SELECT proname FROM pg_proc WHERE proname = 'auction_finalize';
```

Note: once the gate is live, every existing account that is not verified can no
longer report items, file claims or bid until an admin verifies it.

### Archive and exact bid steps

Run `manual_migrations/20261016_archive_and_bid_steps.sql` after `20261015`. It is additive and safe to re-run. It adds `archived_at` and
`archived_by` to `missing_items`, `found_items`, `claims` and `auctions` (the **Archive** action on the admin pages) and replaces the database
function `auction_place_bid` so a bid between two steps is refused (starting bid 100 with an increment of 100 allows 100, 200, 300, never 150;
the Buy Now price is always allowed). **The app works without it**: the Archive buttons answer "run the latest database update" and change
nothing, the Archived tabs are empty, and the server already refuses off-step bids before they reach the database. Verify with:

```sql
SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'archived_at'
  AND table_name IN ('missing_items', 'found_items', 'claims', 'auctions');                                       -- 4 rows
SELECT pg_get_functiondef('public.auction_place_bid(uuid,uuid,numeric)'::regprocedure) LIKE '%bid_not_on_step%';   -- true
```

### Handover log, guard receipts, Smart Tag link and migration log

Run `manual_migrations/20261017_custody_log_receipts_and_migration_log.sql` after `20261016`. It is additive and safe to re-run. It creates
`migration_log` (and records the older migration files from what the database already contains), adds `found_items.received_at`,
`received_by` and `smart_tag_id`, and creates `custody_log` (the per-item handover log). **The app works without it**: Mark received answers
"run the latest database update", the handover history is rebuilt from existing timestamps only, a Smart Tag code on a new found item is accepted
but not stored, and the health check on System control says the migration log does not exist yet. Verify with:

```sql
SELECT count(*) FROM public.migration_log;                                                                  -- 23 on a fully migrated database (21 plus 20261018 and 20261019)
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_items'
  AND column_name IN ('received_at', 'received_by', 'smart_tag_id');                                         -- 3 rows
SELECT to_regclass('public.custody_log');                                                                   -- custody_log
```

**Every new migration file must end with** `INSERT INTO public.migration_log (name, note) VALUES ('<file name without .sql>', 'applied') ON CONFLICT (name) DO NOTHING;`

### Auction pickup PIN

Run `manual_migrations/20261018_auction_handover_pin.sql` after `20261017`. It adds `handover_pin_hash` (unique), `handover_pin_encrypted` and `handover_pin_issued_at` to `auctions`. **The app works without it**: a confirmed winner simply has no PIN, the winner email has none, and an administrator completes the sale with **Mark as picked up**. Verify with:

```sql
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auctions'
  AND column_name IN ('handover_pin_hash', 'handover_pin_encrypted', 'handover_pin_issued_at');                 -- 3 rows
```

### Smart Tag contact methods

Run `manual_migrations/20261019_tag_contact_links.sql` after `20261018`. It adds `user_profiles.tag_contacts` (the owner's saved Messenger, Facebook, Instagram, Telegram, WhatsApp and alternate phone, as JSON) and `smart_tags.shown_contacts` (which of them a tag shows). **The app works without it**: the Profile section says contact methods switch on after the next database update and tags behave as before. Verify with:

```sql
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  AND ((table_name = 'user_profiles' AND column_name = 'tag_contacts') OR (table_name = 'smart_tags' AND column_name = 'shown_contacts'));   -- 2 rows
```

### Report lifecycle and guard handover

Run `manual_migrations/20261015_report_lifecycle_and_guard_handover.sql` after `20261014`. It is additive and safe to re-run. It adds
`claims.missing_report_id` and `found_items.handover_guard_id`, lets a **guard** record a collection (before this, the database refused a guard
account that scanned a Handover PIN, so the release desk only worked for administrators), lets **administrators** (not only super administrators)
make someone a guard, and makes the collection trigger close the claimant's named lost report and tell its owner. **The app works without it**:
claims are saved without the lost-report link, found reports without the guard link, and the "Items handed to you" list shows a notice, but a
guard account cannot release items and administrators cannot assign the guard role until it runs. Verify with:

```sql
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
  AND ((table_name = 'claims' AND column_name = 'missing_report_id') OR (table_name = 'found_items' AND column_name = 'handover_guard_id'));   -- 2 rows
SELECT position('''guard''' in pg_get_functiondef(oid)) > 0 AS guards_allowed FROM pg_proc WHERE proname = 'admin_update_claim_status';           -- true
```

### Recycle bin

Run `manual_migrations/20261014_recycle_bin.sql` after `20261013`. It is additive and safe to re-run. It creates the table `recycle_bin` (RLS on,
backend only) and the private storage bucket `recycle-bin`. **Until it runs, admin deletes of claims, found items, lost reports, accounts and
auctions are refused with a clear message (nothing is deleted), and the file-retention rule waits.** Verify with:

```sql
SELECT to_regclass('public.recycle_bin');
SELECT id, public FROM storage.buckets WHERE id = 'recycle-bin';   -- public must be false
```

### Guard role, email preferences, reminders and evidence retention

Run `manual_migrations/20261013_guard_role_reminders_and_retention.sql` after `20261012`. It is additive and safe to re-run. It allows
`user_profiles.access_level = 'guard'` (and re-creates `admin_set_user_access_level` so a super admin can assign it), adds
`user_profiles.email_preferences`, `claims.pickup_reminder_sent_at` and `evidence_purged_at`, and `smart_tags.expiry_reminder_sent_at`.
Until it runs: guards cannot be assigned, saving email choices answers "not set up yet", and the reminder, claim expiry and file
deletion steps log a warning and change nothing (nothing is ever sent or deleted by guesswork). Verify with:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_profiles_access_level_check';   -- includes 'guard'
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'email_preferences';
SELECT column_name FROM information_schema.columns WHERE table_name = 'claims' AND column_name IN ('pickup_reminder_sent_at','evidence_purged_at');
SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name = 'expiry_reminder_sent_at';
```

**Before the first production run after this migration:** approved claims from before pickup deadlines existed are given a fresh 14-day
deadline (nobody is closed retroactively), but ID documents and proof photos of claims that closed more than 30 days ago will be deleted on
the first run. If you want a different period, set `EVIDENCE_RETENTION_DAYS` first (`0` turns deletion off).

### Handover PINs, auction pickup deadlines and the bidding ban

Run `manual_migrations/20261012_handover_pins_and_auction_timeouts.sql` after `20261011`. It is additive and safe to re-run. It adds
`claims.handover_pin_hash`, `handover_pin_encrypted` and `handover_pin_issued_at` (plus a unique index so a PIN always points at one claim),
`auctions.pickup_warning_sent_at` and `auto_forfeited_at` (skipped with a notice if the Auction Hall tables do not exist yet), and
`user_profiles.bidding_banned_until` and `bidding_ban_reason`. Until it runs, approving a claim still works but no PIN is created (the email
says to bring ID instead), and the auction deadline job reports an error in the log and changes nothing. Verify with:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'claims' AND column_name LIKE 'handover_pin%';   -- 3 rows
SELECT column_name FROM information_schema.columns WHERE table_name = 'auctions' AND column_name IN ('pickup_warning_sent_at','auto_forfeited_at');
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name LIKE 'bidding_ban%';
```

### Smart Tag staff approval (fraud prevention)

Run `manual_migrations/20261011_tag_staff_verification.sql` after `20261010`. It is guarded, transactional and safe
to re-run. It widens `smart_tags.status` to `VARCHAR(24)` and adds `pending_verification` to the status check, adds
`pending_image_url`, `prior_status`, `review_requested_at`, `verified_at`, `verified_by` and `verification_note`,
and a partial index `idx_smart_tags_pending`. Existing tags keep their status, so nothing already working is paused.
Verify with:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'smart_tags_status_check';  -- lists pending_verification
SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name IN ('pending_image_url','prior_status','verified_at');
```

### Smart Tag live photo and Mission Control storage tools

Run `manual_migrations/20261010_tag_photo_and_mission_control.sql` after `20261009`. It is additive and
safe to re-run: it adds `smart_tags.item_image_url`, creates the PRIVATE storage bucket `smart-tag-images`
(5 MB, jpeg/png/webp) and two service-role-only read functions, `storage_bucket_stats()` and
`storage_list_objects()`, used by the Storage card in System Control. Nothing is deleted or changed. Verify with:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name = 'item_image_url';
SELECT id, public FROM storage.buckets WHERE id = 'smart-tag-images';   -- public must be false
SELECT proname FROM pg_proc WHERE proname IN ('storage_bucket_stats', 'storage_list_objects');
```

Expected: 1 row, `false`, 2 rows. Until it runs, registering a tag fails with a clear message (the photo cannot be
stored) and the Storage card shows the setup notice.

### Smart Tag expiry, tag types and auction Buy Now

Run `manual_migrations/20261009_tag_expiry_and_auction_buyout.sql` after `20261008`. It is
additive and safe to re-run: it adds `tag_type`, `validity_months`, `valid_until`, `batch_id`,
`scan_count` and `last_scanned_at` to `smart_tags` (and allows the `expired` status), adds
`buyout_price` and `bought_out` to `auctions`, and replaces the `auction_place_bid` function so a
bid at or above the Buy Now price ends the auction. Existing tags are grouped into one batch per
label so they can be deactivated as a batch. Verify with:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'smart_tags' AND column_name IN ('tag_type','validity_months','valid_until','batch_id','scan_count','last_scanned_at');
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name IN ('buyout_price','bought_out');
SELECT pg_get_functiondef('public.auction_place_bid(uuid,uuid,numeric)'::regprocedure) LIKE '%is_buyout%';
```

Expected: 6 rows, 2 rows, `true`.

### Smart Tags

Run `manual_migrations/20261008_smart_tags.sql` after the one below. It creates the
`smart_tags` table (RLS on, backend-only) and changes nothing else. Verify with:

```sql
SELECT to_regclass('public.smart_tags');
SELECT status, COUNT(*) FROM public.smart_tags GROUP BY status;
```

### Duplicate-claim protection and auction hearts

Run `manual_migrations/20261007_report_integrity_and_reactions.sql` after the one
above. It creates `auction_reactions` (saved hearts) and a partial unique index
that allows only one open claim per person per found item. It deletes nothing: if
duplicate open claims already exist the index is skipped with a notice, and the
file contains a read-only query to find them. Verify with:

```sql
SELECT to_regclass('public.auction_reactions');
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_claims_one_open_per_claimant_item';
```

### Method 2: Using Python Script
```bash
cd backend
source venv/Scripts/activate  # On Windows: venv\Scripts\activate
python setup_database.py
```

## Database Design Principles

1. **Data Integrity**: Primary keys on account_id, campus_id, and email ensure unique users
2. **Security**: 
   - Passwords stored as bcrypt hashes (salted)
   - OTP codes expire after 10 minutes
   - Row Level Security (RLS) enabled on all tables
3. **Performance**: Strategic indexing on frequently queried columns
4. **Scalability**: UUID primary keys for distributed system support

## Security Considerations

1. **Password Hashing**: Passwords are hashed using bcrypt with 12 rounds
2. **OTP Security**: 
   - 6-digit OTP codes generated randomly
   - Expire after 10 minutes
   - Marked as used after verification
3. **RLS Policies**: Users can only view/update their own data
4. **Email Verification**: Required for registration and password reset

## Maintenance

### Cleanup Old OTPs
```sql
DELETE FROM otp_tokens WHERE expires_at < now() AND is_used = false;
```

### User Statistics
```sql
SELECT COUNT(*) as total_users FROM user_profiles;
SELECT COUNT(*) as active_users FROM user_profiles WHERE is_active = true;
SELECT DATE(created_at), COUNT(*) as registrations 
FROM user_profiles 
GROUP BY DATE(created_at) 
ORDER BY created_at DESC;
```

### Find Unused OTPs
```sql
SELECT * FROM otp_tokens WHERE is_used = false AND expires_at > now();
```

## Environment Variables

Required for backend to work:
```
SUPABASE_URL=https://onwlvwqauptstemmvyhz.supabase.co
SUPABASE_KEY=sb_publishable_Hsg85D0CSUQvfT3Z_J3crg_4WsyBmmr
SUPABASE_SERVICE_KEY=<service_key>
```

Optional tuning (defaults are sensible): `ADMIN_DIGEST_HOUR` (default 8, Makati time: the earliest hour the daily administrator summary is emailed),
`ADMIN_LIST_MAX` (default 10000: the most rows an admin list reads before stopping; Supabase returns only 1000 per request, so lists are paged),
`ALLOW_INSECURE_START` (emergency only: lets a production server start with missing or default secrets; leave unset).

## Future Enhancements

1. Add audit logging table
2. Add user profile images
3. Add notification preferences
4. Add messaging system between users
5. Add item categories lookup table
6. Add campus locations lookup table
