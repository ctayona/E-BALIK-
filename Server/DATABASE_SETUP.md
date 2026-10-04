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
