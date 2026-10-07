# Smart Tags Guide: from first batch to sticker on a laptop

This guide is for the person who runs the Smart Tags program: generating tags, printing the QR stickers, selling them and handling problems. It starts with the one thing that cannot be undone, the address inside the QR code.

---

## 1. What "PUBLIC_SITE_URL" means

A QR code is just a web address drawn as a picture. When someone scans a Smart Tag sticker, their phone reads the address and opens it. Every tag has its own address:

```text
https://your-site.vercel.app/tag/ABCDEFGHJK23
\_____________  ___________/ \__/ \_____  ____/
              \/              |        \/
   PUBLIC_SITE_URL           fixed   the tag's secret code
```

- The last part, the **tag code**, is different for every sticker. E-Balik creates it for you.
- The first part, **your site address**, is the same for every sticker. E-Balik does not guess it: you tell the server what it is by setting one setting called `PUBLIC_SITE_URL`.

Whenever the server makes a QR code (or a list of links to print), it joins `PUBLIC_SITE_URL` and the tag code.

### Why it matters so much

**Once a QR code is printed on a sticker, its address cannot be changed.** The sticker is a picture of the address, like a house number painted on a wall.

If you print 500 stickers while `PUBLIC_SITE_URL` is wrong, all 500 point to the wrong place:

| What `PUBLIC_SITE_URL` was when you printed | What happens when someone scans |
| --- | --- |
| Not set (the server falls back to `http://localhost:5173`) | The phone looks for a website on **itself** and finds nothing. The sticker is useless. |
| A typo, such as `https://ebalik.vercle.app` | "Site can't be reached", or worse, someone else's website. |
| An address you later stop using | The sticker stops working the day that address goes away. |

The tag code itself is safe in the database, so nothing is lost except the paper. But you cannot correct the sticker, so the address has to be right **before** you print.

---

## 2. Set it once, correctly

### On the live site (Render)

1. Decide your final site address. This is the address people use to open E-Balik, for example `https://ebalik.vercel.app`. See section 3 about using a permanent address.
2. Go to <https://dashboard.render.com> and open your service (`ebalik-api`).
3. Click **Environment**.
4. Add or edit the variable:

   | Name | Value |
   | --- | --- |
   | `PUBLIC_SITE_URL` | `https://your-site.vercel.app` |

   Rules for the value:
   - It starts with `https://`.
   - It is **only** the site address. Do not add `/tag` or a slash at the end.
   - It is the **user website** address, the same one you set for `CORS_ORIGINS`.
5. Click **Save, rebuild and deploy** and wait until the service says **Live**.

### On your own computer (testing only)

In `Environment_Configs/backend/.env` you can leave `PUBLIC_SITE_URL` unset or set `PUBLIC_SITE_URL=http://localhost:5173`. QR codes made this way work only on your own computer. They are fine for testing and **must never be printed**.

---

## 3. Choose an address that will last

Think about this before printing, because the sticker will outlive your hosting choices.

- **Best: your own domain**, for example `tags.umak.edu.ph` or `ebalik.ph`. You can move the site to a different host later and the stickers keep working, because you only change where the domain points.
- **Acceptable: the free `.vercel.app` address.** It works, but it is tied to your Vercel project name. If the project is renamed or deleted, the address stops working and every sticker goes dead.
- **Shorter is better.** A shorter address makes a simpler QR code that is easier to scan on a small sticker.
- If you ever must change the address after stickers are out, keep the old address working and redirect it to the new one. Do not let it expire.

In Vercel, a custom domain is added under **Project > Settings > Domains**. After that, set `PUBLIC_SITE_URL` and `CORS_ORIGINS` on Render to the new domain.

---

## 4. Check that it is right (the admin page checks for you)

1. Sign in as an admin and open **Smart tags**.
2. If the address is wrong, you see a red box at the top: **"Do not print stickers yet"**. It shows the address the QR codes would open and why it is not good enough. Fix `PUBLIC_SITE_URL`, restart the server and reload the page until the box disappears.
3. Open any tag with the eye button. Look at the **Link** line. It must start with your real site address.
4. Click **Download QR** (or scan the QR on the screen) and scan it with your phone. It must open that tag's page on your live site.

The batch window shows the same warning right after you generate tags, so you will not export a list of wrong links by accident.

---

## 5. Do a small test run first

Never print a big batch first. Spend ten minutes proving the whole loop with a handful of tags.

1. **Generate** a batch of 3 and give it a label such as `Test batch`.
2. Download the QR image of one tag and print it on ordinary paper.
3. **Scan it while signed out.** You should see "This E-Balik Smart Tag is unregistered! Log in to claim it."
4. **Log in and claim it** with a test item. Check the privacy switches and the preview.
5. Open **Smart Tags** in the top menu (on a phone, open the menu first) and mark it as **lost**.
6. On a second phone that is not signed in, **scan it again.** You should see the red "marked as LOST" banner and only the details you chose to share.
7. Press **I found this item!** The owner should get a notification in the app and an email. (The email needs SendGrid to be set up. See `DEPLOYMENT_GUIDE.md`.) The second phone should show the OHSO guard post steps.
8. As a super admin, **Deactivate** the test tag and scan it again. It should show nothing about the item or owner.

When all eight steps work, you are ready for real stickers.

---

## 6. Generating and printing a real batch

### Generate

1. Open **Smart tags** and click **Generate batch**.
2. Enter how many (1 to 500 at a time), choose the **Tag type** and **Valid for**, and add an optional name such as `Freshman orientation pack`.
   - **Tag type:** QR Code today. RFID and NFC appear greyed out as "Not available yet"; they are switched on later with `SMART_TAG_TYPES_ENABLED` (see section 10).
   - **Valid for:** 1 academic year (12 months), 6 months, 2 years, a custom number of months (up to 120), or never expires. The clock **starts when the owner registers the tag**, not when you print it, so unsold stickers do not run out.
3. When it is done, click **Download codes and URLs**. You get a spreadsheet with the tag code, the type, the value to write on the tag, how long it is valid and the batch name. **Keep this file safe.**

You can get the same list again at any time: open **Smart tags**, filter by **Blank**, and use **Export**.

### Make the QR images

- For a few tags, open each tag in the admin page and click **Download QR**. It saves a PNG named after the tag.
- For hundreds of tags, give the spreadsheet to your sticker printer or use a mail-merge or label-design tool that makes a QR code from the **QR URL** column. (E-Balik does not yet create a ZIP of QR images.)
- Whatever tool you use, the QR must contain the **full URL from the spreadsheet**, exactly as written.

### Print well

- Print the **tag code in words** under the QR, in groups of four (for example `ABCD EFGH JK23`). If a sticker gets scratched, the owner or a guard can type the code instead.
- Make the QR at least about **2.5 cm (1 inch)** wide, with a clear white border around it.
- Use a **matte** finish. Glossy labels cause glare that phone cameras struggle with.
- Dark QR on a white background scans best.
- Print one sticker and **scan it with two different phones** before printing the whole run.

---

## 7. Selling and registering stickers

| Where the tag is | What it means | Where you see it |
| --- | --- | --- |
| **Blank** | Generated, not sold yet. Anyone holding the sticker can register it. | "Blank (unsold)" count |
| **Pending approval** | A user registered it (or sent a new photo of an active tag) and staff have not checked it yet. Finders see nothing. | "Pending approval" tab |
| **Active** | Staff approved the registration. | "Claimed (sold)" count |
| **Lost** | The owner marked the item as lost. Finders see a red warning. | "Marked lost" count |
| **Expired** | Its validity period ended. Finders see only "This Smart Tag has expired". The owner sees Expired. | "Expired" count |
| **Deactivated** | An admin switched it off. Finders see nothing. | "Deactivated" count |

Important habits:

- **Registration is first come, first served.** Whoever scans a blank sticker first and logs in can claim it. So keep unsold stickers locked away, and give a sticker out only when it is sold.
- Hand over the sticker, and tell the buyer to **scan it right away** and register it.
- **Registration needs a live photo.** The buyer must take a photo of the item with the sticker attached, with the camera, at that moment (picking a picture from the gallery is not possible). The browser asks for camera permission; on a phone that blocks it, the phone's camera app opens instead. The photo is stored privately and shown only to someone who scans the tag while it is active; you can see it in the tag's detail window.
- Tags registered before this rule have no photo; their owners can add one with **Edit** on the Smart Tags page.
- **Registration needs staff approval.** A new registration is **Pending approval**: finders see only that the tag exists, never the item or owner, and the validity period has not started. The owner brings the item and the sticker to the office. Open **Pending approval** (or the gold banner), click **Review**, compare the item name, the owner's name and the large live photo with the real item, then **Approve** (the tag becomes Active and the validity clock starts) or **Reject** with a reason (a first registration is cleared so the sticker can be registered again; a new photo is discarded and the previous photo stays).
- **What owners can and cannot change.** Description and the privacy switches: any time. **Item name: never**, so a sticker cannot be moved to a different item (staff can correct it). A **new live photo** sends an active tag back to Pending approval until staff re-approve it; the old photo stays on file so a rejection restores it.
- **Staff can edit everything.** In a tag's detail window choose **Edit** to change the name, description, privacy, phone and photo. This never triggers approval.
- A user manages their tags on the **Smart Tags** page (top menu): register a sticker, see when each tag expires, change the privacy switches, and mark an item lost.
- **"Claimed"** in the admin page means sold and registered. If you want to know which are sold but not yet registered, track that in your own sales record: E-Balik only knows a tag is sold once the buyer registers it.

---

## 8. Expiry, renewals and batches

- **What expiry does.** When a tag passes its **Valid until** date it is marked Expired the next time anyone scans it or the admin page loads. Finders then see only that the tag expired and are told to bring any item to the OHSO guard post: no owner details are shown and no alert is sent. The owner sees **Expired** in My Smart Tags, and a warning starting 30 days before.
- **Renew a tag.** Open the tag in the admin page and choose **Renew**. Enter the months to add (12 is one academic year). An expired tag works again from today; a tag that is still valid gets the months added after its current end date. The owner is notified.
- **Batches by expiry.** The panel at the top of the Smart tags page lists every batch, the ones whose registered tags expire soonest first, with how many expire within 30 days and how many already expired. Use it to plan renewals and reprints.
- **A roll of stickers is stolen or compromised.** A super admin clicks **Deactivate batch** on that batch and gives a reason. Every tag in it stops working at once, including blank ones, so a thief cannot register them; owners of registered tags are told why. **Reactivate batch** reverses it (it also reactivates tags that were switched off one by one).
- **Tag details.** Open any tag to see its type, the link or value, validity, valid-until date, how many times it was scanned and when it was last scanned.

---

## 9. When things go wrong

| Problem | What to do |
| --- | --- |
| The red "Do not print stickers yet" box shows | `PUBLIC_SITE_URL` is missing, wrong, uses `http://`, or points at localhost. Fix it in Render (section 2), wait for the redeploy, and reload. |
| Stickers were already printed with a wrong address | The printed sticker cannot change. If the wrong address is a domain you control, make it redirect to the right site. If not, the stickers have to be reprinted. This is why section 5 comes first. |
| Scanning a sticker says "We can't find this tag" | The code does not exist, or the QR was read incompletely. Type the code from under the QR. Check the tag exists in the admin list. |
| Scanning says "Smart Tags are opening soon" | The database step has not been run. Run `Server/manual_migrations/20261008_smart_tags.sql` in Supabase. |
| Someone claims a tag they should not | A super admin opens it in the admin page and clicks **Deactivate** with a reason. The owner is told, and finders see nothing. |
| Someone uses a tag to harass or mislead | Deactivate it (super admin). You can **Reactivate** it later if it was a mistake. |
| The finder email does not arrive | The in-app notification still arrives. Emails need `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` on Render. |
| A user lost their sticker | The tag code is on their Smart Tags page. They can mark the tag as lost. For a replacement, a new tag is generated and registered to the same item. |

---

## 10. Quick checklist before the first real print

- [ ] The migrations `20261008_smart_tags.sql`, `20261009_tag_expiry_and_auction_buyout.sql` and `20261010_tag_photo_and_mission_control.sql` have been run in Supabase (the last one creates the private photo bucket).
- [ ] You chose the validity period (for example 12 months) in Generate batch.
- [ ] Only enable RFID or NFC (`SMART_TAG_TYPES_ENABLED=qr,rfid`) once the hardware exists. An RFID chip is written with the bare tag code, and the reader software must open `<PUBLIC_SITE_URL>/tag/<code>` for it.
- [ ] The admin **Smart tags** page loads without a setup notice.
- [ ] You chose a permanent address (a custom domain is best).
- [ ] `PUBLIC_SITE_URL` on Render is exactly that address: `https://`, no `/tag`, no trailing slash.
- [ ] The red "Do not print stickers yet" box is **not** showing.
- [ ] A test QR scanned from a phone opens the right page on the live site.
- [ ] You completed the 8-step test run in section 5.
- [ ] One printed sticker scans well on two different phones.
- [ ] The spreadsheet of codes and URLs is saved somewhere safe, and unsold stickers are locked away.
- [ ] SendGrid is configured, if you want finder emails.

---

## Where the pieces live (for developers)

- Address and QR code logic: `Server/app/utils/smart_tags.py` (`public_base_url`, `tag_url`, `url_check`, `qr_png`).
- Admin page: `Admin/Frontend/src/pages/smart-tags/SmartTags.tsx`.
- Public scan page: `Users/Frontend/src/app/pages/tag/TagPage.tsx`, served at `/tag/<code>` (a rewrite in `vercel.json` makes this work on the live site).
- Setting: `PUBLIC_SITE_URL` in `render.yaml` and `Environment_Configs/backend/production.env.example`.
- Full technical notes: the "Smart Tags (QR stickers)" section of `PROJECT_CONTEXT.md`.
