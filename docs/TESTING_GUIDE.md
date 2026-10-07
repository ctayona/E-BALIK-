# E-Balik Testing Guide

A step-by-step way to try out every feature of E-Balik and tick it off as it works. You do not need to read any code. Each test says **what to do** and **what you should see**.

> All names, emails, IDs and codes below are **samples**. Use your own test data. Never test with real students' information.

---

## 1. Before you start

### 1.1 Where to test

| Option | Good for | Warning |
|---|---|---|
| **Your laptop** (`npm run dev`) | Looking at screens | Your local settings point at the **live** database and the **live** email service. Everything you create is real, and emails really go out. Use only test accounts and your own email addresses. |
| **A staging copy** (separate Supabase project + Render service) | Everything, including the time-based rules in section 12 | Best choice. Recommended before you rely on a feature. |

### 1.2 Start the app (laptop)

```bash
npm run dev
```

| App | Address |
|---|---|
| User app | http://localhost:5173 |
| Admin app | http://localhost:8443/admin/ |
| Backend | http://localhost:5000 |

On a laptop the background timer is **off** on purpose (so test runs cannot send reminders or delete files by accident). To run the timed jobs on purpose, see section 12.

### 1.3 Make sure the database is ready

All migrations must have been run in the Supabase SQL Editor, in order, **ending with `20261014_recycle_bin.sql`** (the full list is in `DEPLOYMENT_GUIDE.md`). Check the last two quickly:

```sql
SELECT to_regclass('public.recycle_bin');
SELECT id, public FROM storage.buckets WHERE id = 'recycle-bin';   -- public must be false
```

> **If `20261014` has not been run:** every admin delete is refused with a "setup required" message. That is intentional (the app will not delete something it cannot archive first). Run the migration and try again.

### 1.4 The test accounts you need

Create these once. Registration is in section 2.

| Nickname | What it is | How to get it |
|---|---|---|
| **Student A** | Normal user who loses things | Register in the user app |
| **Student B** | Second normal user who finds things | Register in the user app (use a different email) |
| **Admin** | Staff who reviews claims and items | Register, then a super admin sets the role to Admin in **Users** |
| **Super admin** | Full control, Recycle bin, System control | Your existing super admin account |
| **Guard** | Release desk only | Register, then a super admin sets the role to Guard in **Users** |

Tips:
- A UMak student email (`name.k12345@umak.edu.ph` style) is detected as **Student** automatically; other `@umak.edu.ph` emails are **Faculty**; any other email is **Others**.
- You can use Gmail "plus" addresses to receive all test emails in one inbox, for example `yourname+studenta@gmail.com`, `yourname+studentb@gmail.com`. Check that your email provider accepts them.
- **Password rule:** at least 16 characters with an uppercase letter, a lowercase letter, a number and one of `! @ # $ % ^ & *`.
- Admin pages ask for Google Authenticator. Set it up first (section 3, test 3.3) so you have recovery codes saved.

### 1.5 How to read the tables

Each row is one test. Tick the **Pass** box in your own copy, or copy the results log in section 14.

---

## 2. Accounts and sign-in

| # | Do this | You should see | Pass |
|---|---|---|---|
| 2.1 | In the user app, choose Register. Enter first name, last name, email, campus ID and a password that follows the rule. | A code is emailed to you (valid 10 minutes). | ☐ |
| 2.2 | Enter the emailed code. | Account is created and you are signed in. | ☐ |
| 2.3 | Try a short password such as `abc123`. | A clear message that the password is too weak. Nothing is created. | ☐ |
| 2.4 | Sign out, then sign in with the wrong password 3 times. | After the third failed try you are locked out for about 2 minutes. | ☐ |
| 2.5 | Wait 2 minutes and sign in correctly. | Sign-in works again. | ☐ |
| 2.6 | Open **Profile**. | You see your verification status, role and what is unlocked. | ☐ |
| 2.7 | While **unverified**, try to submit a found report, a lost report, a claim, or a bid. | A message explains that you must be verified first. Submit is disabled. | ☐ |
| 2.8 | In Profile, upload a verification ID. In the admin app (**Users**), approve it and pick a role (Student, Faculty, Staff or Visitor). | Student A becomes verified and the features above unlock. | ☐ |

---

## 3. Sessions and staff security

| # | Do this | You should see | Pass |
|---|---|---|---|
| 3.1 | Sign in to the **user app**, leave it untouched for 60 minutes (or see the shortcut below), then click anything. | You are signed out and a notice says the session ended. | ☐ |
| 3.2 | Sign in to the **admin app**, leave it untouched for 20 minutes. | You are signed out sooner than a normal user. | ☐ |
| 3.3 | In admin **My profile**, set up Google Authenticator. Save the recovery codes. | Setup completes; the profile shows two-factor is on. | ☐ |
| 3.4 | Sign in as admin again. | After the password you are asked for the 6-digit code, and then you get in. | ☐ |
| 3.5 | Sign in as admin, close the browser, come back the next morning (or after 8 hours). | You are asked to sign in again. You are **never** sent into the user app with admin credentials. | ☐ |
| 3.6 | As a normal user, close the browser overnight and return after 12 hours. | You are asked to sign in again. | ☐ |

**Shortcut for 3.1 and 3.2 without waiting:** these limits are fixed in the code, so to test quickly, edit the stored sign-in time in your browser. Open the browser developer tools, go to Application, Local Storage, find `ebalik_last_activity`, set it to a number about 2 hours in the past (in milliseconds since 1970), then switch tabs or click the page. You should be signed out. This is optional; if you skip it, mark 3.1 and 3.2 as "not tested".

---

## 4. Reporting lost and found items

Sign in as **Student B** (the finder) and **Student A** (the owner).

| # | Do this | You should see | Pass |
|---|---|---|---|
| 4.1 | As Student A: **Dashboard**, then Report Item, then "I lost an item". Fill the form with a photo (for example a black wallet), category, place, date. Accept the privacy consent. | Report is saved with a report ID and appears under **My Reports**. | ☐ |
| 4.2 | As Student B: Report Item, then "I found an item". Fill in a similar item (a black wallet) with a photo. | Report is saved and appears under **My Reports**. | ☐ |
| 4.3 | Try an image in a wrong format or over the size limit. | A clear error. Nothing is saved. | ☐ |
| 4.4 | Create reports until you have 6 active ones, then try a 7th. | The 7th is refused with a message about the active report limit (6). | ☐ |
| 4.5 | Open **My Reports** and click a report. | A details window with image, category, place, date and status. | ☐ |
| 4.6 | Edit one of your reports. | A short countdown and a confirmation checkbox must be completed before it saves. | ☐ |
| 4.7 | Delete one of your own test reports. | Same countdown and checkbox. The report disappears from your list. | ☐ |
| 4.8 | Open **Browse**. Check both tabs (Missing Items and Items in Custody), search, filter by category, switch between tile and list. | Items show with photo, category, place. **No email or campus ID is visible anywhere.** | ☐ |
| 4.9 | Open the **Dashboard**. | Recent Found and Recent Missing panels load real data; clicking one opens its details. | ☐ |

---

## 5. AI matching

| # | Do this | You should see | Pass |
|---|---|---|---|
| 5.1 | As Student A: open **Matches** and choose your lost report. | Found reports are listed with a match percentage (strong 75%+, possible 55%+). | ☐ |
| 5.2 | Use the filters (all, strong, possible) and open a match. | The list filters and a detail window opens. | ☐ |
| 5.3 | As admin: open **AI matching**. | Suggested matches appear with the items side by side. | ☐ |
| 5.4 | Click **Confirm match** on a pair. | The match is marked confirmed and the owner is notified. | ☐ |
| 5.5 | On another pair click **Reject match**. | The pair is marked rejected and no longer suggested. | ☐ |

---

## 6. Claims, Handover PIN and the guard desk

This is the most important flow. Use the found wallet from section 4.

### 6.1 Claim an item

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.1.1 | As Student A: **Browse**, **Items in Custody**, note the found wallet's reference. Open **Claims**, stay on the **Submit claim** tab, enter the **Found item reference**, explain why it is yours, and add the proof photo (and ID if asked). Submit. | A claim is created with a claim reference and status **pending**. An email receipt arrives. | ☐ |
| 6.1.2 | Open the **Claim history** tab. | Your claim and its status are listed. | ☐ |

### 6.2 Review it as admin

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.2.1 | Admin app, **Claims and verification**. Open the claim. | You can see the proof, the ID, and the owner's description. | ☐ |
| 6.2.2 | Click approve. A box asks **"Approve this claim for pickup?"** Confirm. | Status becomes **approved for pickup**. A **Handover PIN** (6 characters) is created. | ☐ |
| 6.2.3 | Check Student A's inbox. | A styled email with the PIN and the pickup deadline (14 days). | ☐ |
| 6.2.4 | As Student A, open **Claims** and the claim. | You can see the PIN again, and a **QR code** for the guard to scan. | ☐ |
| 6.2.5 | Make another claim and **reject** it with a reason. | Status becomes **rejected**; the owner gets an email with the reason. | ☐ |

### 6.3 Release the item at the desk

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.3.1 | Sign in as **Guard**. | You land on the **release desk** only. No other admin page opens. | ☐ |
| 6.3.2 | Type a **wrong** PIN. | "Not found" style message. Nothing released. | ☐ |
| 6.3.3 | Type the **right** PIN (or use the scan button with the QR). | The item and the owner's name and campus ID appear, so the guard can check them against the person's ID card. | ☐ |
| 6.3.4 | Press **Release**. | The claim becomes **collected** and the item closes. | ☐ |
| 6.3.5 | Check Student A's inbox. | A handover receipt email. | ☐ |
| 6.3.6 | Try the same PIN again. | It no longer works. | ☐ |
| 6.3.7 | Try 13 wrong PINs within one minute. | After 12 attempts you are told to slow down. | ☐ |
| 6.3.8 | As Guard, try to open the admin page for Users or Claims by its address. | Refused. The guard role cannot see anything but the desk. | ☐ |
| 6.3.9 | In admin Claims, on another approved claim, use **Complete & close reports**. | The claim and the related reports close without needing the PIN. | ☐ |

Also check in admin that you can **reissue** a PIN for an approved claim (the old PIN stops working, the owner is emailed the new one).

---

## 7. Smart Tags (QR stickers)

Read `SMART_TAGS_GUIDE.md` first if `PUBLIC_SITE_URL` is not set. **Do not print real stickers** until the admin page stops showing "Do not print stickers yet".

| # | Do this | You should see | Pass |
|---|---|---|---|
| 7.1 | Admin app, **Smart tags**. Click **Generate batch**: 3 tags, a label, a validity in months. | 3 new blank tags are listed. | ☐ |
| 7.2 | Download a tag's QR image and open the batch CSV. | A PNG and a CSV of codes and addresses. | ☐ |
| 7.3 | Without signing in, open the tag's address (`/tag/<code>`). | "This E-Balik Smart Tag is unregistered! Log in to claim it." | ☐ |
| 7.4 | As Student A: **Smart Tags**, then register a tag. Type the code (or scan its QR). Choose an item from the dropdown, add details, take a **live photo**. | The tag is registered and its status is **pending verification**. | ☐ |
| 7.5 | Open the tag address while signed out. | It shows nothing about the item (pending tags are hidden from the public). | ☐ |
| 7.6 | Admin: approve the pending tag. | Status becomes **active**. The expiry date is set from the approval date. | ☐ |
| 7.7 | Try to rename the item on an approved tag. | The item name is locked. | ☐ |
| 7.8 | In the owner's Smart Tags page, switch on "show name", "show phone" and save. | The public page now shows only what you switched on. | ☐ |
| 7.9 | Signed out, open the active tag and click the finder button ("I found this"). | The owner gets an in-app notification and an email, and the finder sees the steps for the guard post. | ☐ |
| 7.10 | Click the finder button again within 5 minutes. | No second email is sent. | ☐ |
| 7.11 | Mark the tag as **lost**. | Status becomes lost; the public page shows the lost state. | ☐ |
| 7.12 | Super admin: deactivate a tag with a reason, then reactivate it. | While deactivated the public page shows nothing; the owner is told why. | ☐ |
| 7.13 | Try to register more than 25 tags on one account. | The 26th is refused. | ☐ |

(Expiry and expiry reminders are tested in section 12.)

---

## 8. Auctions

### 8.1 Create and bid

| # | Do this | You should see | Pass |
|---|---|---|---|
| 8.1.1 | Admin app, **Auctions**, then **New auction**. Pick an eligible found item, set Starting bid (for example 350), Bid increment, optional Buy Now price, and the Closes at time (set it 10 minutes ahead). | The lot appears with a lot number and a live preview while you type. | ☐ |
| 8.1.2 | As Student B: open **Auction Hall**. | The lot appears. Bidders are shown only as anonymous aliases. | ☐ |
| 8.1.3 | Bid below the minimum. | Refused with the minimum next bid. | ☐ |
| 8.1.4 | Place a valid bid. | You are now leading; the price updates. | ☐ |
| 8.1.5 | As Student A, outbid Student B. | Student B is told they were outbid. | ☐ |
| 8.1.6 | Add a comment and press the heart. | Both appear; the heart count changes. | ☐ |
| 8.1.7 | Try bidding while unverified. | Refused with the verification message. | ☐ |
| 8.1.8 | On a second auction with a Buy Now price, press **Buy Now** (or type a bid at or above that price). | The auction ends at once and you win. | ☐ |
| 8.1.9 | Back in admin, open the lot and edit it (live or scheduled lots only). | Starting bid and Buy Now are locked once bids exist; the end time can only move later. | ☐ |

### 8.2 After the auction

| # | Do this | You should see | Pass |
|---|---|---|---|
| 8.2.1 | Let the auction close. It moves to **awaiting** admin review. Open it and **Review result**. | You can approve the result. | ☐ |
| 8.2.2 | Approve. | The winner gets an email with the pickup deadline. | ☐ |
| 8.2.3 | Create a lot, let it close without bids. | You can re-auction it (re-auction window). | ☐ |
| 8.2.4 | Delete a test auction. | The dialog says it moves to the **Recycle bin**. | ☐ |

(The 48-hour warning and 72-hour forfeit are tested in section 12.)

---

## 9. Admin tools

Sign in to the admin app as **super admin** unless stated.

| # | Page | Do this | You should see | Pass |
|---|---|---|---|---|
| 9.1 | **Dashboard** | Open it. Change the date range between 30 days, 90 days, 12 months and All time. | Numbers and charts update for the range. | ☐ |
| 9.2 | Dashboard | Choose a custom start and end date. | Charts match the dates. | ☐ |
| 9.3 | Dashboard | Look at the location hotspots. | Busiest locations are listed. | ☐ |
| 9.4 | Dashboard | Download the CSV, and open the print report. | CSV opens in Excel with no formulas running; the print view is readable. | ☐ |
| 9.5 | **Reports and analytics** | Open it. | Reports load. | ☐ |
| 9.6 | **Lost items** and **Found items** | Search, filter, open an item, change status. | Lists respond; changes are saved. | ☐ |
| 9.7 | **Chain of custody** | Open an item's history. | Each handover step is listed in order. | ☐ |
| 9.8 | **Users** | Search a user; change a role; suspend a user for a number of days with a reason; lift it. | Role changes apply. A suspended user cannot sign in until the date. | ☐ |
| 9.9 | Users | Set a role to **Guard**. | That person can use only the release desk. | ☐ |
| 9.10 | **Notifications** | Open it. | Admin notifications are listed. | ☐ |
| 9.11 | **Activity logs** | Open it. | Your recent actions appear (claims approved, roles changed, deletes). | ☐ |
| 9.12 | Language switch | Switch the admin app to Tagalog, then back. | Labels change language. | ☐ |

### 9.13 System control (super admin only)

| # | Tab | Do this | You should see | Pass |
|---|---|---|---|---|
| 9.13.1 | Controls and health | Run the health scan. | A list of checks with pass/warn results (variable names only, never values). | ☐ |
| 9.13.2 | Controls and health | Turn **maintenance mode** on with a message. In another browser, sign in as Student A. | Student A sees the maintenance screen. Staff can still sign in. Turn it off after. | ☐ |
| 9.13.3 | Controls and health | Use **force logout**. | Normal users are signed out; staff stay signed in. | ☐ |
| 9.13.4 | Announcement | Publish a banner (choose a tone). | The banner shows on user and admin pages; closing it hides it until you edit it. | ☐ |
| 9.13.5 | Communications | Search a user and send a message by in-app and email. | The user gets the notification and email. | ☐ |
| 9.13.6 | Admin access | Open the list of admins. | Admins, two-factor status and last sign-in are shown. You cannot revoke yourself or the last super admin. | ☐ |
| 9.13.7 | Data and email | Send a test email to yourself. | The result says whether the email provider accepted it. | ☐ |
| 9.13.8 | Data and email | Export audit data (JSON or CSV). | A file downloads with no passwords, IDs or claim text. | ☐ |
| 9.13.9 | Data and email | Preview storage cleanup (do **not** run it on live data unless you mean it). | A preview of what would be cleared. | ☐ |

---

## 10. Emails and preferences

| # | Do this | You should see | Pass |
|---|---|---|---|
| 10.1 | Look at any email you received during the tests. | Same navy and gold layout, readable in Gmail on a phone. | ☐ |
| 10.2 | As Student A: **Profile**, email preferences. Switch **Reminders** off and save. | The setting is saved. | ☐ |
| 10.3 | Re-run a reminder test (section 12.1). | Student A does **not** get the reminder. Required emails (codes, claim decisions, receipts) still arrive. | ☐ |
| 10.4 | Open the unsubscribe link at the bottom of a reminder or announcement email. | A confirmation page; confirm it, and the preference is switched off. | ☐ |
| 10.5 | Send an announcement from System control while Student A has announcements off. | Student A gets the in-app copy but no email. | ☐ |

---

## 11. Recycle bin (super admin only)

Create **disposable test records** first (a found item, a lost report, an account, a claim, an auction) so you never delete something real.

| # | Do this | You should see | Pass |
|---|---|---|---|
| 11.1 | Delete a test **found item** in admin. | The dialog says it moves to the Recycle bin. It disappears from Found items. | ☐ |
| 11.2 | Open **Recycle bin**. | The item is listed with its type, who deleted it, and days left (30). | ☐ |
| 11.3 | Use the type filter and the search box. | The list narrows. | ☐ |
| 11.4 | Click **Restore**, type `CONFIRM`. | The item is back in Found items, with its photo and its claims. | ☐ |
| 11.5 | Delete it again, then click **Delete permanently**. Type `CONFIRM` and a **wrong** 6-digit code. | An error. The item stays in the bin. | ☐ |
| 11.6 | Repeat with the **right** current code from Google Authenticator. | The item is gone for good. | ☐ |
| 11.7 | Try the same code again on another item. | Refused: each code works once. Wait for the next code. | ☐ |
| 11.8 | Repeat 11.1 to 11.4 for a lost report, a claim, an account and an auction. | Each restores. Restoring an account lets that person sign in again. | ☐ |
| 11.9 | Restore an item after re-creating the same record, or after deleting its parent. | A clear refusal (already exists, or its parent is missing). Nothing is half-restored. | ☐ |
| 11.10 | Sign in as a normal admin (not super admin). | There is no Recycle bin in the menu. | ☐ |

---

## 12. Timed rules (reminders, expiry, retention)

These normally take days. On a **staging project only**, you can shortcut them. These commands change data, so **never run them on your live project.**

### 12.1 How to run the timed jobs

Pick one:

1. **Cron endpoint** (works anywhere that has `CRON_SECRET` set):

```bash
curl -X POST https://YOUR-API.onrender.com/api/cron/run -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

2. **Script** from the project folder: `python Server/scripts/run_cron.py`
3. **Laptop timer:** set `SCHEDULER_ENABLED=true` in `Environment_Configs/backend/.env` and restart. Remember it will then act on whatever database that file points at.

The reply lists what each job did. Running it twice never sends a second email.

### 12.2 What each rule does

| Rule | When | What happens |
|---|---|---|
| Claim pickup reminder | 7 days after approval, still not collected | Reminder email and notification to the owner |
| Claim expiry | 14 days after approval, still not collected | Claim is closed as **rejected** with a reason; the PIN stops working |
| Smart Tag expiry reminder | 30 days before the tag expires | Reminder to the owner |
| Smart Tag expiry | At the expiry date | Tag status becomes **expired** |
| Auction pickup warning | 48 hours after the winner is told, not collected | Final 24-hour warning (in app and email) |
| Auction forfeit | 72 hours after the winner is told | Win is forfeited, item returns to custody, repeated forfeits can ban bidding |
| Evidence retention | 30 days after a claim closes (collected or rejected) | ID and proof photos are copied to the Recycle bin, then removed from the claim |
| Recycle bin expiry | 30 days after deletion | Entry is deleted for good |

### 12.3 Shortcuts for testing on staging

> Test project only. Run in the Supabase SQL editor of your **staging** project, replacing the sample values. Then run the cron job (12.1).

```sql
-- Claim reminder: pretend a claim is 6 days from its deadline
UPDATE claims SET pickup_deadline = now() + interval '6 days'
WHERE claim_reference = 'SAMPLE-CLAIM-REF' AND status = 'approved_for_pickup';

-- Claim expiry: pretend the deadline already passed
UPDATE claims SET pickup_deadline = now() - interval '1 hour'
WHERE claim_reference = 'SAMPLE-CLAIM-REF' AND status = 'approved_for_pickup';

-- Auction warning: winner was told 49 hours ago
UPDATE auctions SET winner_notified_at = now() - interval '49 hours'
WHERE auction_id = 'SAMPLE-AUCTION-ID';

-- Auction forfeit: winner was told 73 hours ago
UPDATE auctions SET winner_notified_at = now() - interval '73 hours'
WHERE auction_id = 'SAMPLE-AUCTION-ID';

-- Smart Tag expiry reminder: tag expires in 20 days
UPDATE smart_tags SET valid_until = now() + interval '20 days'
WHERE tag_id = 'SAMPLE-TAG-CODE';

-- Smart Tag expiry: tag expired yesterday (it switches to expired the next time anyone looks at it)
UPDATE smart_tags SET valid_until = now() - interval '1 day'
WHERE tag_id = 'SAMPLE-TAG-CODE';
```

| # | Do this | You should see | Pass |
|---|---|---|---|
| 12.3.1 | Approve a claim, shift it as above (reminder), run cron. | Owner gets the reminder email once. A second run sends nothing. | ☐ |
| 12.3.2 | Shift the same claim past its deadline, run cron. | Claim shows **rejected** with an expiry reason; the owner is told; the PIN no longer works. | ☐ |
| 12.3.3 | Shift an auction win by 49 hours, run cron. | Winner gets one final warning. | ☐ |
| 12.3.4 | Shift it to 73 hours, run cron. | Win is forfeited; the item is back in custody and can be auctioned again. | ☐ |
| 12.3.5 | Shift a tag to 20 days, run cron. | Owner gets the expiry reminder. | ☐ |
| 12.3.6 | Shift a tag to the past and open its public page. | The tag shows as expired. | ☐ |
| 12.3.7 | Evidence retention and bin expiry | Needs claims and bin entries older than 30 days. This guide has no safe shortcut for them: wait for real data, or mark **not tested**. | ☐ |

---

## 13. Privacy page and public pages

| # | Do this | You should see | Pass |
|---|---|---|---|
| 13.1 | Open `/privacy` without signing in (also reachable from the footer on the landing page). | A short page that explains what is collected, who sees it, how long it is kept (30 days, then 30 days in the bin, 14 days to collect), emails and your rights. | ☐ |
| 13.2 | Open `/tag/<code>` of a blank tag while signed out. | The unregistered-tag page (section 7.3). | ☐ |
| 13.3 | Switch the user app between light and dark theme and resize to phone width. | Pages stay readable and nothing overflows. | ☐ |

---

## 14. Results log

Copy this table into a note and fill it in.

| Section | Tester | Date | Passed | Failed | Not tested | Notes |
|---|---|---|---|---|---|---|
| 2 Accounts | | | | | | |
| 3 Sessions | | | | | | |
| 4 Reports and browse | | | | | | |
| 5 AI matching | | | | | | |
| 6 Claims, PIN, guard | | | | | | |
| 7 Smart Tags | | | | | | |
| 8 Auctions | | | | | | |
| 9 Admin tools | | | | | | |
| 10 Emails | | | | | | |
| 11 Recycle bin | | | | | | |
| 12 Timed rules | | | | | | |
| 13 Public pages | | | | | | |

### If something fails

1. Write down the test number, what you did, and what you saw.
2. Take a screenshot (cover any real names or emails).
3. Check the backend terminal for a red error and note it.
4. Tell the developer: "test 6.3.4 failed, the PIN worked but the claim stayed approved" is enough.

---

## 15. Known limits of this guide

- It was written from the code and from earlier automated checks (the backend test suite and browser checks with simulated data). The steps in this guide have **not** been walked through end to end on the live system.
- The recycle bin, migration `20261014`, and the file copies have been tested with simulated storage only. Test them on staging first (section 11).
- Evidence retention and bin expiry cannot be sped up safely (test 12.3.7).
- Email appearance differs by mail app. Gmail is the one to check; others are to be confirmed.
- The 20-minute, 60-minute, 8-hour and 12-hour sign-out limits are checked by waiting or by the shortcut in section 3.
- Menu names and button labels follow the current screens. If a label differs slightly, follow the closest match and tell the developer so this guide can be fixed.
