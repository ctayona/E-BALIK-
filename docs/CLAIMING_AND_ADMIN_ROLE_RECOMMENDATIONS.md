# Claiming Process and Admin Role Recommendations

**Prepared:** 2026-09-28  
**Scope:** Recommendations only. No application code was changed.

## 1. Current Claiming Process

The current user flow is:

1. The user enters a found-item reference.
2. The user writes an ownership explanation.
3. The user uploads one ownership proof image.
4. The frontend sends a multipart request to `POST /api/claims`.
5. The backend validates the reference, reason, image type, and 10 MB limit.
6. The backend stores the image in the `claim-proof-images` Supabase bucket.
7. A claim is created with status `pending`.
8. An admin can change the claim to `approved` or `rejected`.
9. The user can view the claim history and cancel a pending claim.

Relevant implementation locations:

- `src/app/pages/Claim.tsx`
- `src/app/utils/api.ts`
- `backend/app/routes/claims.py`
- `backend/app/routes/admin.py`
- `backend/database_schema.sql`

The current claim form does **not** yet include:

- A government or school ID upload specifically attached to the claim.
- A five-second confirmation dialog before claim submission.
- A dedicated official pickup or release state.
- A final office verification record showing who released the item and when.
- User-facing instructions for visiting the University of Makati Lost and Found Office.

## 2. Recommended Claim Lifecycle

Use separate review and physical-release stages. Admin approval should mean “eligible for official verification,” not “the item has already been released.”

Recommended statuses:

```text
pending
under_review
approved_for_pickup
rejected
cancelled
collected
expired
```

Suggested meaning:

- `pending`: Submitted and waiting for review.
- `under_review`: An admin is actively checking the claim and documents.
- `approved_for_pickup`: Admin found the evidence sufficient; the user must visit the office.
- `rejected`: Evidence was insufficient or the claim was invalid.
- `cancelled`: User withdrew the claim before completion.
- `collected`: The office completed the official handover.
- `expired`: The user did not claim the item within the stated pickup period.

A simpler first version can keep `pending`, `approved`, `rejected`, and `collected`, but the UI should clearly label `approved` as **Approved for office verification**, not as completed ownership transfer.

## 3. Recommended Claim Submission Experience

### Before submission

Show a short instruction panel beside or above the form:

- Enter the found-item reference exactly as shown in the listing.
- Explain identifying details that are not publicly visible.
- Upload a clear ownership proof image.
- Upload a valid school ID, government ID, or other approved identification document.
- Do not upload passwords, payment details, or unrelated private documents.
- The submitted information is visible to authorized administrators for verification.
- Approval in the system does not complete the physical handover.

### Five-second confirmation

A five-second confirmation dialog is reasonable as a user-attention safeguard. It should say, in substance:

> Please review your claim carefully. After submission, it will be reviewed by an administrator. Confirmation becomes available in 5 seconds.

Then require both:

- The countdown to reach zero.
- A checkbox confirming that the information is truthful and the claimant understands that final claiming happens at the UMAK Lost and Found Office.

This timer is only a UX safeguard. It is not a security control and must not be trusted by the backend. The backend should still validate every claim independently.

### After submission

Show a clear receipt containing:

- Claim reference.
- Found-item reference.
- Submission date and time.
- Current status: `Pending admin review`.
- Expected next step.
- A link to claim history.

Do not immediately imply that the item is reserved or guaranteed to be released.

## 4. Recommended ID Handling

The claim should have a dedicated ID document upload rather than mixing the ID with the ownership-proof image.

Recommended fields:

```text
claim_id
claimant_account_id
found_item_id
claim_reason
proof_image_url
identity_document_url
identity_document_type
identity_document_name
status
reviewed_by
reviewed_at
rejection_reason
approved_at
pickup_deadline
collected_at
released_by
```

Recommended storage design:

- Use a private Supabase Storage bucket for identity documents.
- Keep ownership proof and identity documents in separate folders or buckets.
- Use a path such as `claim-id-documents/<account_id>/<claim_id>/<filename>`.
- Do not expose identity-document URLs in public listings.
- Avoid storing unnecessary ID numbers if visual verification is sufficient.
- Restrict access to authorized admins and the claimant where necessary.
- Define a retention period and delete documents after the institutional retention period.
- Log document access and admin decisions.

The current claim proof upload is already sent as actual file bytes to `claim-proof-images`. That approach should be reused for the ID upload. Do not use a browser-only `blob:` URL as the permanent document URL.

## 5. Recommended UMAK Lost and Found Office Instructions

After an admin approves a claim, show a dedicated instruction state rather than only a generic success message.

Include:

- Office name: **UMAK Lost and Found Office**.
- Exact building or location.
- Office hours and days.
- Contact number or official email.
- Claim reference and found-item reference to present.
- Valid original ID to bring.
- Any additional proof required for distinctive or high-value items.
- Pickup deadline, if applicable.
- Statement that only the office can complete the official handover.
- Statement that approval may be rechecked against the original documents at pickup.

Recommended user-facing wording:

> Your claim was approved for office verification. Please visit the UMAK Lost and Found Office during office hours. Bring your claim reference, found-item reference, original valid ID, and any ownership evidence requested by the administrator. The item is officially released only after Lost and Found Office personnel complete the in-person verification.

The actual office address, hours, and contact information should come from a configurable source, not be hard-coded into multiple components.

## 6. Separate Approval from Physical Release

The office workflow should have its own final action:

1. Admin reviews the claim and documents.
2. Admin marks the claim `approved_for_pickup`.
3. The user receives instructions and a notification.
4. The user visits the UMAK Lost and Found Office.
5. Staff checks the original ID and claim reference.
6. Staff verifies the item and records the handover.
7. Staff marks the claim `collected` and the found item `returned`.
8. The system records the staff member, timestamp, and any release note.

This prevents the database from reporting an item as returned merely because an admin clicked Approve online.

## 7. Admin Role Recognition in This Program

This project does not use Supabase Auth's built-in user role as the primary admin check. It uses the custom `user_profiles` table.

The relevant logic is:

1. Login reads the account from `user_profiles` using the email.
2. The stored `user_role` value is included in the JWT as `user_role`.
3. The Admin frontend checks that the value is `admin`.
4. Backend admin routes decode the JWT and require:

```python
str(payload.get('user_role') or '').lower() == 'admin'
```

5. The Admin login request also sends `admin_only: true`, and `/api/auth/login` rejects accounts whose database `user_role` is not `admin`.

Therefore, the authoritative field for this application is:

```text
user_profiles.user_role
```

The value should be exactly `admin` in lowercase. Values such as `Admin`, `administrator`, or a role stored only in Supabase Auth metadata will not reliably satisfy the current checks.

## 8. How to Convert an Account to Admin

First identify the exact row in the custom `user_profiles` table:

```sql
SELECT account_id, email, fname, lname, user_role, is_active
FROM public.user_profiles
WHERE lower(email) = lower('person@example.com');
```

Then update the role:

```sql
UPDATE public.user_profiles
SET user_role = 'admin',
    is_active = true,
    updated_at = now()
WHERE lower(email) = lower('person@example.com');
```

Verify it:

```sql
SELECT account_id, email, user_role, is_active
FROM public.user_profiles
WHERE lower(email) = lower('person@example.com');
```

After changing the row, the person must:

1. Log out completely from the user app.
2. Clear the old user/admin browser session if necessary.
3. Log in again so the backend issues a new JWT containing `user_role: admin`.
4. Open the Admin app through the configured Admin path or the root login redirect.

An already-issued JWT still contains the old role until it expires or the user signs in again. The current JWT lifetime is 30 days, so relying on an old token can make the role change appear not to work.

## 9. Why a Supabase Role Change May Not Work

Common causes:

- The change was made in `auth.users` or Supabase Auth metadata instead of `public.user_profiles.user_role`.
- The email matched a different account row.
- The value was not exactly `admin`.
- The account is still using an old JWT in local storage.
- The account's profile was edited through the normal profile endpoint afterward. That endpoint currently infers a role from the email domain and may overwrite a manually assigned `admin` role with `Faculty`, `Student`, or `Others`.
- The backend is connected to a different Supabase project or environment.
- The account is inactive (`is_active = false`).
- The browser is opening the Admin app with stale `ebalik_admin_token` and `ebalik_admin_user` values.
- The user profile was changed after login but the frontend still displays cached user data.

The quickest diagnostic is to compare these three things:

```text
Database:       user_profiles.user_role
Login response: user_role
JWT payload:    user_role
```

All three should say `admin`.

## 10. Operational Recommendations

Before enabling real claims, decide and document:

- Which ID types are accepted.
- Who can view identity documents.
- How long claim documents are retained.
- What happens when a claim is rejected.
- Whether users can appeal or resubmit.
- How long an approved claim remains valid.
- Who is authorized to mark an item as collected.
- What happens when multiple users claim the same item.
- What happens for minors, representatives, or proxy pickups.
- The exact office location, hours, and official contact channel.

## Recommended Implementation Order

1. Confirm and document the office instructions and accepted IDs.
2. Add a dedicated claim ID upload stored in private storage.
3. Add the five-second confirmation dialog and truthfulness checkbox.
4. Add claim statuses for approval versus physical collection.
5. Add admin fields for reviewer, rejection reason, pickup deadline, and collection record.
6. Add user notifications for submitted, approved, rejected, and collected states.
7. Add audit logging for document review and physical release.
8. Test duplicate claims, invalid files, stale JWTs, rejected claims, and two claimants for one item.

The safest conceptual model is: **online claim submission -> admin document review -> approval for office verification -> in-person UMAK Lost and Found Office verification -> recorded collection**.
