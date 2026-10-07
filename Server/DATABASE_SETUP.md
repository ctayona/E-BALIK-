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

## Future Enhancements

1. Add audit logging table
2. Add user profile images
3. Add notification preferences
4. Add messaging system between users
5. Add item categories lookup table
6. Add campus locations lookup table
