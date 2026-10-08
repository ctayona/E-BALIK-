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

All migrations must have been run in the Supabase SQL Editor, in order, **ending with `20261017_custody_log_receipts_and_migration_log.sql`** (the full list is in `DEPLOYMENT_GUIDE.md`). Check the last five quickly:

```sql
SELECT to_regclass('public.recycle_bin');
SELECT id, public FROM storage.buckets WHERE id = 'recycle-bin';   -- public must be false
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
  AND ((table_name = 'claims' AND column_name = 'missing_report_id') OR (table_name = 'found_items' AND column_name = 'handover_guard_id'));   -- 2 rows
SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'archived_at'
  AND table_name IN ('missing_items', 'found_items', 'claims', 'auctions');   -- 4 rows
SELECT pg_get_functiondef('public.auction_place_bid(uuid,uuid,numeric)'::regprocedure) LIKE '%bid_not_on_step%';   -- true
SELECT count(*) FROM public.migration_log;   -- 23 when every migration has been run (21 plus 20261018 and 20261019)
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_items'
  AND column_name IN ('received_at', 'received_by', 'smart_tag_id');   -- 3 rows
SELECT to_regclass('public.custody_log');   -- custody_log
```

> **If `20261014` has not been run:** every admin delete is refused with a "setup required" message. That is intentional (the app will not delete something it cannot archive first). Run the migration and try again.

> **If `20261015` has not been run:** the app still works, but a guard account cannot release items (the database refuses it), administrators cannot assign the guard role, a claim cannot be linked to a lost report, and a found report cannot be linked to a guard. Run it before testing sections 2.9, 4.2, 6.1, 6.3 and 6.4.

> **If `20261016` has not been run:** the Archive buttons say "run the latest database update" and change nothing, and the exact-step rule for bids is enforced by the server only (the database enforces it after the migration). Run it before testing sections 8 and 9.

> **If `20261018` or `20261019` has not been run:** a won auction has no pickup PIN (an administrator completes it with **Mark as picked up**), and the Profile > Smart Tags contact methods say they switch on after the next database update. Run both before testing 6.6 and 7.14.

> **If `20261017` has not been run:** the app still works. Mark received, the Smart Tag link and the recorded handover steps say "run the latest database update" or fall back to what the database already knows (the history is rebuilt from timestamps), and System control > health scan reports the migration log as missing. Run it before testing sections 6.5, 9.7 and 9.13.10.

### 1.4 The test accounts you need

Create these once. Registration is in section 2.

| Nickname | What it is | How to get it |
|---|---|---|
| **Student A** | Normal user who loses things | Register in the user app |
| **Student B** | Second normal user who finds things | Register in the user app (use a different email) |
| **Admin** | Staff who reviews claims and items | Register, then a super admin sets the role to Admin in **Users** |
| **Super admin** | Full control, Recycle bin, System control | Your existing super admin account |
| **Guard** | Release desk only | Register, then an admin or super admin uses **Change role** in **Users** and picks Security guard |

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
| 2.9 | Admin app, **Users**: click **Change role** on a normal user and choose **Security guard**, then **Save role**. | A "Role updated" message appears and the user's Access column says Guard. Sign in as that user in the admin app: you land on the release desk only. | ☐ |
| 2.10 | Sign in as a normal **admin** (not super admin) and open **Change role** on another user. | You can pick User or Security guard. **Admin** is greyed out with "Only super admins can make someone an admin." There is no Change role button on administrators or on yourself. | ☐ |
| 2.11 | In the user app, open **Profile** and start the ID upload. | Two choices appear: **Take photo** (opens the camera on a phone) and **Upload photo or PDF**. | ☐ |
| 2.12 | Upload a text file that you renamed to `id.png`. | Refused: "That file is not a real photo or PDF of your ID." Nothing is saved. | ☐ |
| 2.13 | Admin app, **Users**, tab **Account verification**: open **Verify** on a request, pick a role and press Continue without ticking the box. | A message asks you to open the submitted ID and tick the box that it matches the account. Verification only goes through once it is ticked. | ☐ |
| 2.14 | While **unverified**, click a report in **Browse** or on the **Dashboard**. | A pop-up says "Verify your ID first" with a **Go to my profile to verify** button that opens the Profile page. The report itself does not open. | ☐ |
| 2.15 | While unverified, press the submit button on the Found form, the Lost form or the Claim form. | The same pop-up appears (the buttons are no longer greyed out). | ☐ |

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
| 4.2 | As Student B: Report Item, then "I found an item". Fill in a similar item (a black wallet) with a photo. Under "Hand it over to campus security" choose the guard in **Which guard received it?** (create one first, see 2.9). | Report is saved and appears under **My Reports**. The guard gets an email and a notification that an item was handed to them. | ☐ |
| 4.2b | Open the found form again and choose **Another guard (not listed)**. | A box for the guard's name or ID appears, and the report saves with that name. If no guard accounts exist yet, the box is shown straight away. | ☐ |
| 4.3 | Try an image in a wrong format or over the size limit. | A clear error. Nothing is saved. | ☐ |
| 4.3b | On a phone, open the Found form, the Lost form and the Claim form. | Each photo area has **Take photo** and **Upload photo** buttons (the Claim ID area says **Upload photo or PDF**). Both work, and the camera is no longer forced. | ☐ |
| 4.4 | Create reports until you have 6 active ones, then try a 7th. | The 7th is refused with a message about the active report limit (6). | ☐ |
| 4.5 | Open **My Reports** and click a report. | A details window with image, category, place, date and status. | ☐ |
| 4.6 | Edit one of your reports. | A short countdown and a confirmation checkbox must be completed before it saves. | ☐ |
| 4.7 | Delete one of your own test reports. | Same countdown and checkbox. The report disappears from your list. | ☐ |
| 4.8 | Open **Browse**. Check both tabs (Missing Items and Items in Custody), search, filter by category, switch between tile and list. | Items show with photo, category, place. **No email or campus ID is visible anywhere.** | ☐ |
| 4.9 | Open the **Dashboard**. | Recent Found and Recent Missing panels load real data; clicking one opens its details. | ☐ |
| 4.10 | Open **My Reports**. | The tabs are All, Missing, Found and **Completed**. A new report is under In progress; the Completed tab is empty until an item is released (section 6.4). | ☐ |

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
| 6.1.1 | As Student A: **Browse**, **Items in Custody**, note the found wallet's reference. Open **Claims**, stay on the **Submit claim** tab, enter the **Found item reference**, choose your lost wallet report under **Which of your lost reports is this? (optional)**, explain why it is yours, and add the proof photo (and ID if asked). Submit. | A claim is created with a claim reference and status **pending**. An email receipt arrives. | ☐ |
| 6.1.2 | Open the **Claim history** tab. | Your claim and its status are listed. | ☐ |
| 6.1.3 | Get a notification that leads to a claim (for example a confirmed match), open **Notifications** and press its claim button. | The claim form opens with the readable found-item reference such as FP2031, not a long code. | ☐ |

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
| 6.3.10 | Sign in as admin or super admin and open **Release desk** in the menu. | The same PIN screen the guard uses, plus "Items handed to guards" listing what finders gave to each guard. | ☐ |
| 6.3.11 | Sign in as the guard and look under the PIN box. | "Items handed to you" lists only the items finders gave to this guard that the office still holds. | ☐ |

Also check in admin that you can **reissue** a PIN for an approved claim (the old PIN stops working, the owner is emailed the new one).

---
### 6.4 Everything finishes together

After the release in 6.3 (item collected):

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.4.1 | As Student A, open **My Reports**, then the **Completed** tab. | The lost wallet report is there, marked Completed. It is gone from All and Missing. Opening it shows a green note and only a Close button (no Edit or Delete). | ☐ |
| 6.4.2 | Open **Notifications**. | "Your lost report is completed". Its button opens My Reports on the Completed tab. | ☐ |
| 6.4.3 | As Student B (the finder), open **My Reports**, **Completed**. | The found wallet report is there, and a notification says the item reached its owner. | ☐ |
| 6.4.4 | As Student A, open **Matches** and **Dashboard**. | The completed lost report is not offered for matching and is not listed as a missing report. | ☐ |
| 6.4.5 | Repeat 6.1 to 6.3 but leave the lost-report choice empty, with a lost report that closely matches the found item (same category, place and date). | After the release that lost report is still completed automatically (it is the one strong match). A lost report that does not match is left open. | ☐ |
| 6.4.6 | As Student A, try to edit or delete the completed lost report by repeating the request from the browser, or as Student B try to delete a found report that has a claim. | Refused with a clear message: the report is completed, or someone has claimed the item. | ☐ |
| 6.4.7 | Admin app, **Reports**, tab **Items in custody**. | The released wallet is no longer listed. Items with a claim to review, approved claims and items old enough to auction show their own status and a next-step button. | ☐ |

### 6.5 Receipts, handling history, Smart Tag match and claims against auctions

Use one found item that Student B hands to the **Guard** (6.1 sets this up) and a second one for the auction steps.

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.5.1 | Sign in as the **Guard** right after Student B submits the found report. | The release desk opens with a **New notices** card: "An item was handed to you". **Mark read** removes it. | ☐ |
| 6.5.2 | Under **Items handed to you**, press **Mark received** on that item. | The button becomes a green **Received**. Student B gets a notice "Your item was received". Pressing it again changes nothing and sends nothing. | ☐ |
| 6.5.3 | Sign in as a second guard and look at the first guard's item. | It is not listed, and the server refuses a receipt for it. | ☐ |
| 6.5.4 | As admin: **Reports**, **Items in custody**. Find an item whose guard has not confirmed. | Under **Received by** it says "Not confirmed yet", and a gold line above the table counts such items. The confirmed one says "Receipt confirmed". | ☐ |
| 6.5.5 | Press **History** on that row. | The handling history lists, oldest first: Turned over, Received by the guard, Claim filed and any later step, each with the person and the time in Makati time. | ☐ |
| 6.5.6 | In the history press **Print or save as PDF**. | The print preview shows only the item's record, not the admin menu. | ☐ |
| 6.5.7 | Open an old bookmark to `/admin/` and choose a page called Chain of custody (or set the stored page to `chain-of-custody`). | There is no such menu item now, and the old address opens **Reports** on **Items in custody**. | ☐ |
| 6.5.8 | A claim that has waited more than 7 days for a decision. | Items in custody shows "Waiting N days" in red under its status, and the Needs review tile says how many claims have waited over 7 days. | ☐ |
| 6.5.9 | Admin: **Reports**, **Found reports**, **Register a found item**. Type the code of an **active** Smart Tag you own in **Smart Tag code** and save. | The tag's owner gets an in-app notice and an email "Your item is at the Lost and Found Office", with a **Submit a claim** button. The history shows "Matched to a Smart Tag". | ☐ |
| 6.5.10 | Register another item with a made-up tag code. | Refused with "not a valid Smart Tag code" or "not found". Nothing is registered. | ☐ |
| 6.5.11 | Put the second item up for auction (section 8.1). As Student A, file a claim for it. | After submitting, the confirmation says the item is in an auction and an approval will cancel it. | ☐ |
| 6.5.12 | Admin **Auctions**. | The auction shows a gold **Ownership claim pending** chip. In its detail, **Confirm winner** warns that someone has filed an ownership claim. | ☐ |
| 6.5.13 | Admin **Claims**: review that claim and press **Approve for pickup**. | The confirmation says the auction will be cancelled and its bidders told. After CONFIRM, the result message names the cancelled auction. | ☐ |
| 6.5.14 | Check the auction and the leading bidder. | The auction is Cancelled with the reason, the leader got an "Auction cancelled" notice, and the item's history shows "Auction cancelled" then "Claim approved". | ☐ |
| 6.5.15 | Check the words. | Every finished report, claim and auction says **Completed** (not Returned, Released, Collected or Resolved). The reference is `docs/STATUS_GLOSSARY.md`. | ☐ |


### 6.6 Guards as users, and the auction pickup PIN

| # | Do this | You should see | Pass |
|---|---|---|---|
| 6.6.1 | Sign in as the **Guard** on the user site. | You land on the **Release desk**, not the student dashboard. | ☐ |
| 6.6.2 | On the release desk press **Report or browse items**. | The normal user app opens, already signed in. There is no "Not verified yet" banner on the profile, and **Report an item** works without an ID check. | ☐ |
| 6.6.3 | In the user app open the menu. | **Release desk** is listed (for administrators it says **Admin console**). It returns you to the desk without signing in again. | ☐ |
| 6.6.4 | Submit a found report as the guard. | It is saved like anyone's. (Choose a guard to receive it, or "Another guard".) | ☐ |
| 6.6.5 | Win an auction as Student A (or use an Awaiting pickup lot). Open the auction as Student A. | A navy **YOUR HANDOVER PIN** box with the PIN and a QR code. The winner email has the PIN too. | ☐ |
| 6.6.6 | Admin app, **Auctions**, **Awaiting pickup**. | The row says the winner has a pickup PIN. | ☐ |
| 6.6.7 | As the guard type the winner's PIN (or scan the QR). | The screen says **Auction winner**, with their name, campus ID, the item and **the amount to collect**. | ☐ |
| 6.6.8 | Press **Payment received: complete the auction**. | "The auction is complete." The auction is Completed, the found report is Completed, the PIN no longer works, and the item's history shows "Sold and collected". | ☐ |
| 6.6.9 | On another Awaiting pickup lot, as admin press **Mark as picked up** and type CONFIRM (no PIN). | The auction completes without a PIN. A guard who tries the same address is refused. | ☐ |
| 6.6.10 | On a lot whose winner has no PIN, press **Send PIN**. | The winner is emailed a new PIN and sees it in the Auction Hall; the row now says the winner has a PIN and the button reads **New PIN**. The old PIN stops working. | ☐ |

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
| 7.14 | As the tag owner open **Profile**, scroll to **Smart Tags**. Save a Messenger username, an Instagram username and an alternate phone number. | Saved. A pasted link such as `m.me/your.name` is turned into the username; a value that is not a username or profile link is refused with a plain message. | ☐ |
| 7.15 | In that section press **Edit** on one of your tags. | Under **What may a finder see?** there is **Other ways to reach me**: Messenger, Instagram and the alternate phone can be switched on; methods you have not saved are greyed out and say to add them in your Profile. | ☐ |
| 7.16 | Switch Messenger on for that tag only, save, and open the tag address signed out. | The public page shows a **Messenger** button that opens `m.me/<username>`, and nothing about Instagram or the phone. Another tag of yours shows nothing extra. | ☐ |
| 7.17 | In Profile clear your Messenger username and save. | The Messenger button disappears from the tag page and its switch is off in the editor. | ☐ |

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

### 8.1b Exact bid steps and early auctions

| # | Do this | You should see | Pass |
|---|---|---|---|
| 8.1b.1 | Make an auction with starting bid 100 and increment 100. As a bidder, type 150 and press Place bid. | Blocked: "Bids go up in exact steps of ₱100... The next bid you can place is ₱200." The button stays greyed. | ☐ |
| 8.1b.2 | Type 200, then place it. Then try 250 and 300. | 200 and 300 work; 250 is blocked. The suggested amounts are always on the 100 ladder. | ☐ |
| 8.1b.3 | With a Buy Now price of 450, type 450 (or 777). | Allowed at any time: it is a Buy Now and you pay 450. | ☐ |
| 8.1b.4 | **New auction**: look at the item list. | Items held for 30 days or more are listed first. Younger items are marked **early** (for example "3 days, early"). Nothing is hidden. | ☐ |
| 8.1b.5 | Pick an early item and try to start the auction. | Blocked until you tick "I want to auction it early". After ticking, it starts normally. | ☐ |
| 8.1b.6 | Pick an item that has an open claim or a running auction. | It is not in the list at all (the date rule can be overridden; claims and running auctions cannot). | ☐ |

### 8.2 After the auction (the new lifecycle)

| # | Do this | You should see | Pass |
|---|---|---|---|
| 8.2.1 | Let the auction close with bids. Open it and press **Review result**. | Status is **Awaiting admin**. You can edit the title, description and photos, but not prices or times. | ☐ |
| 8.2.2 | Press **Confirm winner**. | The status becomes **Awaiting pickup** (not "Sold"). The winner is told to pay and collect. The auction is **not** finished yet. | ☐ |
| 8.2.3 | While it is Awaiting pickup, press **Edit**. | Only the listing fields (title, description, photos) can change. | ☐ |
| 8.2.4 | Press **Give the winner more time**. | The winner gets a notification and a fresh 72 hour window (the warning and forfeit start again). | ☐ |
| 8.2.5 | Press **Winner flaked: re-auction** on another awaiting-pickup lot. | A new auction opens and the old sale is forfeited. | ☐ |
| 8.2.5b | Look at the Awaiting pickup row in the Auctions list. | A green **Mark as picked up** button and a **New PIN** (or **Send PIN**) button are visible without opening the auction, with a line saying whether the winner has a pickup PIN. | ☐ |
| 8.2.6 | After the winner paid and collected, press **Mark as picked up** and confirm. | The status becomes **Completed**. The item's found report becomes Completed too, and the finder is told it was sold. | ☐ |
| 8.2.7 | Create a lot and let it close without bids. | **Ended, no bids**; you can re-auction it. | ☐ |
| 8.2.8 | Delete a test auction (super admin). | The dialog says it moves to the **Recycle bin**. | ☐ |

### 8.3 Archive

| # | Do this | You should see | Pass |
|---|---|---|---|
| 8.3.1 | On a **Completed**, **Forfeited**, **Cancelled** or **Ended, no bids** auction, press **Archive** and type CONFIRM. | It leaves the working tabs and appears in the **Archived** tab. Nothing is deleted. | ☐ |
| 8.3.2 | Look at a Live, Awaiting admin or Awaiting pickup auction. | There is no Archive button (live work cannot be hidden). | ☐ |
| 8.3.3 | In the **Archived** tab, press **Restore from archive**. | It goes back to the working list. | ☐ |

(The 48-hour warning and 72-hour forfeit are tested in section 12.)

---

## 9. Admin tools

Sign in to the admin app as **super admin** unless stated.

| # | Page | Do this | You should see | Pass |
|---|---|---|---|---|
| 9.1 | **Analytics** | Open it. Change the date range between 30 days, 90 days, 12 months and All time in the **Visual analytics** section. | Numbers and charts update for the range. The Dashboard itself shows a **Trends and analytics** card with an **Open analytics** button instead of the charts. | ☐ |
| 9.2 | Analytics | Choose a custom start and end date. | Charts match the dates. | ☐ |
| 9.3 | Analytics | Look at the location hotspots. | Busiest locations are listed. | ☐ |
| 9.4 | Analytics | Download the CSV, and open the print report. | CSV opens in Excel with no formulas running; the print view is readable. | ☐ |
| 9.5 | **Analytics** | Scroll the whole page (it was two pages: Reports and analytics, and the Dashboard charts). | The summary cards, trends, categories and locations load first, then the visual analytics. A report filed at 7 AM is counted on that day, not the day before. | ☐ |
| 9.6 | **Reports** | Open it. Use the tabs **Lost reports**, **Found reports** and **Items in custody**. In each, search, filter, open an item and change its status. | One page with three tabs; lists respond and changes are saved. The old Lost items and Found items menu entries are gone. | ☐ |
| 9.6b | **Reports**, tab **Items in custody** | Look at the summary, filter by Needs review, Waiting for pickup, In auction, Waiting for the owner and On hold, and click a next-step button. | Each item shows its state, days held and who received it. **Review claim** opens Claims; **Create auction** (items waiting 30+ days) opens Auctions. Export CSV downloads what is on screen. | ☐ |
| 9.7 | **Reports**, **Items in custody** | Press **History** on an item. | Each handover step is listed in order (the old Chain of custody page now lives here). | ☐ |
| 9.8 | **Users** | Search a user; change a role; suspend a user for a number of days with a reason; lift it. | Role changes apply. A suspended user cannot sign in until the date. | ☐ |
| 9.9 | Users | Use **Change role** to make someone a **Security guard**, then change them back to **User**. | A guard can use only the release desk; a user again has no staff access. | ☐ |
| 9.9b | **Release desk** | Open it as admin. | Type or scan a Handover PIN to release an item, same as the guard. | ☐ |
| 9.14 | **Reports** (Lost reports, Found reports) and **Claims and verification** | On a finished record (a returned lost report, a released found report, a collected or rejected claim) press **Archive** and type CONFIRM. | It moves to the page's **Archived** tab. Open or in-progress records have no Archive button. **Restore from archive** brings it back. | ☐ |
| 9.15 | Admin menu | Look beside **Claims and verification**, **Users**, **Smart tags** and **Auctions**. | A small gold number shows how many items wait for an administrator (claims to review, IDs to verify, tags to approve, auction results to confirm). It disappears when nothing is waiting and refreshes about every minute. | ☐ |
| 9.10 | **Notifications** | Open it. | Admin notifications are listed. | ☐ |
| 9.11 | **Activity logs** | Open it. | Your recent actions appear (claims approved, roles changed, deletes). | ☐ |
| 9.12 | Language switch | Switch the admin app to Tagalog, then back. | Labels change language. | ☐ |

### 9.13 System control (super admin only)

| # | Tab | Do this | You should see | Pass |
|---|---|---|---|---|
| 9.13.1 | Controls and health | Run the health scan. | A list of checks with pass/warn results (variable names only, never values). | ☐ |
| 9.13.11 | Controls and health | Suspend any account (Users page), then run the health scan again. | A **Suspended accounts** line appears with an information icon, and the page keeps working. (This used to turn the whole screen blank.) | ☐ |
| 9.13.10 | Controls and health | Look at the **Migration log** check. | It says every migration file is recorded. If you skipped one, it names it as missing. | ☐ |
| 9.13.2 | Controls and health | Turn **maintenance mode** on with a message. In another browser, sign in as Student A. | Student A sees the maintenance screen. Staff can still sign in. Turn it off after. | ☐ |
| 9.13.3 | Controls and health | Use **force logout** while a guard and a normal user are signed in. | The user **and the guard** are signed out on their next click and must sign in again. Administrators and super administrators stay signed in. | ☐ |
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
| 10.6 | As admin open **Profile** and find **Daily summary email**. Leave it on. Have at least one claim waiting for review. Run the timed jobs after 8 AM Makati time (section 12.1). | One email "Lost and Found Office: N things waiting for you" with only the lines that have something, and a link to the admin console. A second run the same day sends nothing. | ☐ |
| 10.7 | Switch **Daily summary email** off, run the jobs again the next day (the summary is sent once per Makati day, so a same-day rerun proves nothing). | No summary email for you. Other administrators who left it on still get theirs. | ☐ |
| 10.8 | With nothing waiting anywhere, run the jobs after 8 AM. | No summary email is sent. | ☐ |

---

## 11. Recycle bin (super admin only)

Create **disposable test records** first (a found item, a lost report, an account, a claim, an auction) so you never delete something real.

| # | Do this | You should see | Pass |
|---|---|---|---|
| 11.1 | Delete a test **found item** in admin (**Reports**, tab **Found reports**). | The dialog says it moves to the Recycle bin. It disappears from Found reports. | ☐ |
| 11.2 | Open **Recycle bin**. | The item is listed with its type, who deleted it, and days left (30). | ☐ |
| 11.3 | Use the type filter and the search box. | The list narrows. | ☐ |
| 11.4 | Click **Restore**, type `CONFIRM`. | The item is back in Found reports, with its photo and its claims. | ☐ |
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
| 6.4 Reports finish together | | | | | | |
| 7 Smart Tags | | | | | | |
| 8 Auctions | | | | | | |
| 8.1b to 8.3 Bid steps, lifecycle, Archive | | | | | | |
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
- The recycle bin, migrations `20261014` to `20261017`, and the file copies
- Evidence retention and bin expiry cannot be sped up safely (test 12.3.7).
- Email appearance differs by mail app. Gmail is the one to check; others are to be confirmed.
- The 20-minute, 60-minute, 8-hour and 12-hour sign-out limits are checked by waiting or by the shortcut in section 3.
- Menu names and button labels follow the current screens. If a label differs slightly, follow the closest match and tell the developer so this guide can be fixed.
