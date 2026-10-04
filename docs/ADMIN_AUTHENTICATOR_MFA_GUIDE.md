# Admin Authenticator App MFA Guide

**Status:** Implemented for Admin and Super Admin accounts. Database setup is still required before deploying the MFA-enabled backend.

## Enable It

1. Run `backend/manual_migrations/20260929_admin_totp_mfa.sql` in Supabase SQL Editor after the claims/admin-access migration.
2. Configure a stable, randomly generated `APP_ENCRYPTION_KEY` in the backend environment and keep it in the deployment secret store. Do not rotate it without a planned re-encryption of saved MFA secrets.
3. Install the backend requirements with `pip install -r backend/requirements.txt` (the additions are `pyotp` and `qrcode[pil]`).
4. Deploy/restart the backend, then build/deploy both frontends.
5. Sign in as an admin, open **My Profile**, enter the account password, and select **Enable Google Authenticator**.
6. Scan the QR code in Google Authenticator, enter the displayed six-digit code, then save the one-time recovery codes somewhere private and separate from the phone.
7. Sign out and sign in again to confirm that the login challenge works.

MFA is opt-in per admin account. Once enabled, the backend requires it for every new Admin API session. Password and Google sign-in both lead to the same TOTP challenge.

## Recommended Approach

Use time-based one-time passwords (TOTP, RFC 6238) with an authenticator app. Google Authenticator can scan the setup QR code, as can compatible apps such as Microsoft Authenticator or 1Password. The feature should support the standard TOTP format rather than depend on Google-specific APIs.

Require TOTP for both `admin` and `super_admin` accounts. Consider requiring it for all accounts with administrative access, and make it mandatory for super admins. A password or Google sign-in alone should not create an admin session until the second factor is verified.

## What You Need

- An MFA enrollment secret for each administrator.
- The Flask backend uses `pyotp` for TOTP and `qrcode[pil]` to render enrollment QR codes.
- Encrypted server-side storage for the TOTP secret. Use a dedicated encryption key kept in a secret manager or protected environment setting, not the database or frontend bundle.
- One-time recovery codes, stored only as hashes and shown once at creation.
- Login states for password accepted, MFA required, MFA verified, and recovery flow.
- Rate limits, audit events, time-window tolerance, and a safe account recovery procedure.
- Authenticator app installed on the administrator's phone. Google Authenticator is available through the official Apple App Store and Google Play Store.

## Enrollment Flow

1. An authenticated admin opens Security Settings and re-enters their password.
2. The backend generates a random TOTP secret, encrypts it, and stores it as **pending enrollment**.
3. The backend returns an `otpauth://` provisioning URI as a QR code and a manual setup key. Display the key only once and warn the admin not to share it.
4. On the phone, open Google Authenticator, choose **Add a code** (or the plus button), and scan the QR code. Manual setup-key entry is the fallback if scanning is unavailable.
5. The admin enters the current six-digit code from the app.
6. The backend validates that code and only then activates MFA. Generate recovery codes and show them once for secure storage.
7. Record the enrollment in the audit log. Never log the TOTP secret, QR provisioning URI, or submitted verification code.

Do not enable MFA merely because a QR code was displayed; require successful code verification first.

## Login Flow

1. The admin submits email/password, or completes Google sign-in.
2. The backend verifies the first factor and loads the account's current `access_level` from `user_profiles`.
3. If the account has admin access and TOTP is enabled, return a short-lived, single-purpose MFA challenge instead of an application JWT.
4. The user enters the six-digit code from Google Authenticator.
5. The backend checks the TOTP, enforces attempt limits, and issues the normal admin JWT only after success.
6. The challenge expires quickly, can be used once, and cannot call normal application/admin APIs.

Google OAuth is an identity provider, not a replacement for the required admin second factor. If the user signs in with Google and the account is admin, continue to the TOTP step.

## Security Requirements

- Encrypt each TOTP secret at rest using a dedicated key, and restrict access to backend service code.
- Do not store TOTP secrets in local storage, browser cookies, or plaintext database columns.
- Require HTTPS in production; enrollment QR codes reveal the secret.
- Rate-limit code attempts and temporarily throttle repeated failures.
- Accept only a small clock-drift window; synchronize server clocks with NTP.
- Track recently accepted time steps to prevent replay of the same code.
- Use single-use, high-entropy recovery codes. Store hashes, invalidate a code after use, and allow regeneration only after reauthentication.
- Audit enrollment, disablement, recovery-code use, failed MFA checks, and security-sensitive account changes without logging secrets or codes.
- Do not provide an easy email-only bypass for admins. Recovery should require an approved, audited identity-verification process.
- Revoke existing sessions when MFA is enabled, disabled, or reset. Require the password and a recent MFA code to disable MFA or replace the device.
- Keep an emergency break-glass procedure for loss of the authenticator, protected by organizational approval and audit logging.

## Suggested Data Model

Keep MFA data separate from campus identity and `access_level`. For example, an admin security table could contain:

```text
account_id
totp_secret_ciphertext
 totp_enabled_at
 totp_pending_secret_ciphertext
 last_accepted_totp_step
 recovery_code_hashes
 updated_at
```

A separate `admin_mfa_challenges` table or a short-lived server-side cache can hold challenge identifiers, account IDs, expiration timestamps, and attempt counts. Never put the secret or code in a JWT.

## Current Safeguards and Remaining Operations

Implemented: pending enrollment expires after 10 minutes; login challenges expire after 5 minutes and are single-use; five failed codes trigger a 10-minute lock; accepted TOTP time steps cannot be replayed; recovery codes are hashed, one-time, and shown only once; changing MFA state requires the account password and a current TOTP code. MFA-verified admin sessions expire after 12 hours. Enablement, disablement, and failed verification attempts are written to the activity log without recording secrets or codes.

Before production, test clock drift, invalid/replayed codes, expired and reused challenges, brute-force throttling, lost-device recovery, and password/Google sign-in for both admin levels. Confirm the activity-log retention policy and keep `APP_ENCRYPTION_KEY` backed up securely.

## Important Design Note

TOTP increases assurance but is not phishing-resistant. For stronger protection later, consider WebAuthn/passkeys or hardware security keys. Do not build an authenticator flow that issues the normal JWT before the second factor has passed; the client-side screen alone is not a security boundary.
