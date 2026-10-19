# NFC and RFID for E-Balik Smart Tags: feasibility study

Version 1, 2026-10-19. Scope: whether E-Balik Smart Tags can use NFC or RFID in addition to the printed QR code, what it would cost, and how to introduce it without changing how tags work.

Prices in this document are planning estimates for the Philippines, not quotes. Confirm them with at least two suppliers before buying. Statements about the current system were checked in the code on the date above; the source files are named so they can be re-checked.

---

## 1. Summary

- An **NFC sticker** can carry exactly the same address as the QR code (`<PUBLIC_SITE_URL>/tag/<code>`). A finder taps a phone on it and the existing Smart Tag page opens. Nothing changes on the server: the tag code is the same Smart Tag code already in the database.
- **RFID** in the strict sense (UHF readers that work from a distance) cannot be read by phones. It is useful for staff, not for finders: for example, scanning many tagged items at the Lost and Found desk at once.
- **Recommendation:** add **NTAG213 NFC stickers** as Phase 1, written with the same tag link as the QR code and locked read-only, ideally as a combined QR + NFC sticker. Treat UHF RFID as a later, separate project for the office's own inventory.

---

## 2. What NFC and RFID are, and how they differ from QR codes

| | QR code (today) | NFC sticker | UHF RFID tag |
|---|---|---|---|
| What it is | A printed picture of a web address | A tiny chip and antenna that a phone powers by touch | A chip and antenna powered by a dedicated reader from a distance |
| How it is read | Phone camera | Tap the phone on it (Android and recent iPhones) | Dedicated reader only (desktop or handheld); phones cannot read it |
| Typical distance | Arm's length, needs light and line of sight | About 1 to 4 cm with a phone | About 1 to 10 m, depending on reader and tag |
| Reads many at once | No | No | Yes (anti-collision, hundreds per second) |
| Works when scratched or dirty | Often fails | Yes, it is inside the sticker | Yes |
| Cost per tag | Printing only | Low (see section 3) | Very low per tag, but readers are expensive |

**Why NFC suits E-Balik.** A Smart Tag already is a link to `/tag/<code>`. NFC adds a second way to open the same link: a finder does not need to aim the camera, light does not matter, and a scratched sticker still works. Because the data on the chip is the same link, the finder sees the same page, with the same privacy rules, rate limits and "I found this item" button.

**A note on terms.** NFC is a family of standards inside high-frequency (HF, 13.56 MHz) RFID. When this document says "RFID" it means a dedicated reader, either HF desk readers or long-range UHF readers.

---

## 3. NFC

### 3.1 Sticker types

The common choice for links is NXP's NTAG21x family (NFC Forum Type 2). All three work with every NFC phone; they differ in memory.

| Chip | Usable memory | Fits the tag link? | Typical use | Estimated price per sticker (PH, small batches) |
|---|---|---|---|---|
| NTAG213 | 144 bytes | Yes, easily | Links, business cards | about PHP 8 to 25 |
| NTAG215 | 504 bytes | Yes | Larger records | about PHP 15 to 35 |
| NTAG216 | 888 bytes | Yes | Large records, vCards | about PHP 20 to 45 |
| Anti-metal (on-metal) NTAG213 | 144 bytes | Yes | Laptops and other metal surfaces | about PHP 40 to 120 |

A Smart Tag link is short: a 12-character code (`TAG_LENGTH = 12` in `Server/app/utils/smart_tags.py`) after the site address, so roughly 40 to 60 bytes as an NDEF URL record. **NTAG213 is enough.**

Read range with a phone is about 1 to 4 cm. A sticker on a metal laptop lid needs an **anti-metal** sticker (with a ferrite layer), or it will not read reliably.

### 3.2 Writing and reading in the browser (Web NFC)

Chrome on Android (version 89 and later) supports the Web NFC API, so the E-Balik web app (including the installed PWA) can write the tag link onto a sticker and read a sticker's serial number. Requirements: HTTPS, the page in the foreground, and a user action (a button press) to start.

```js
// Write the tag link onto a blank sticker (Chrome on Android only).
if ("NDEFReader" in window) {
  const ndef = new NDEFReader();
  await ndef.write({ records: [{ recordType: "url", data: "https://<site>/tag/ABCDEFGHJK23" }] });
}

// Read a sticker: the serial number of the chip and the records on it.
const reader = new NDEFReader();
await reader.scan();
reader.onreading = ({ serialNumber, message }) => {
  // serialNumber is the chip's UID. Do not use it as proof of identity (see section 6).
};
```

Recent Chrome versions also offer `makeReadOnly()`, which locks a sticker so nobody can overwrite its link. Locking is recommended for every issued sticker (section 6). Check that the method is present on the office's phone before relying on it; otherwise lock with a native app.

### 3.3 Limitations

- **iPhone.** Safari has no Web NFC, so an iPhone cannot **write** stickers from the web app. Writing on iPhone needs a native app (for example NXP's free TagWriter). **Reading** is better: iPhone XS and newer read NFC URL stickers in the background without any app; the phone shows a banner and opens the link when tapped. So finders with recent iPhones are covered, and the office simply writes stickers with an Android phone.
- **Phones without NFC** (some low-cost Android models) cannot tap. The printed QR code on the same sticker remains the fallback.
- **Desktop browsers** have no Web NFC.

### 3.4 Use case

A finder taps a phone on the sticker, the browser opens `<PUBLIC_SITE_URL>/tag/<code>`, and the existing Smart Tag page does the rest (owner's chosen details, lost banner, "I found this item"). The page is already built for this (`Users/Frontend/src/app/pages/tag/TagPage.tsx`).

---

## 4. RFID

### 4.1 Hardware

| Hardware | What it does | Estimated price (PH) |
|---|---|---|
| USB HF/NFC desk reader (for example ACR122U class) | Reads and writes NFC stickers at a desk computer | about PHP 1,800 to 3,500 |
| USB HF reader that types like a keyboard | Reads a tag and "types" what it holds into the active field | about PHP 1,000 to 3,000 |
| USB UHF desktop reader/writer | Reads UHF tags within about 1 m | about PHP 3,000 to 10,000 |
| Handheld UHF scanner (Android based) | Walks the shelves and reads many tags at once | about PHP 25,000 to 70,000 |
| UHF sticker tags, in bulk | Cheap, paper-thin | about PHP 3 to 15 each |

### 4.2 Use cases at UMak

- **Lost and Found desk and guard posts:** a desk reader opens a tagged item's page without typing the code, which speeds up intake when someone hands in an item with a Smart Tag.
- **Bulk inventory (UHF):** if the office one day tags the items in its own custody, a handheld UHF scanner can count a whole shelf in seconds and compare it with the custody list. This is about the office's stock, not owners' stickers, and would be a separate project.

### 4.3 Software options

- Browser plus a "keyboard" reader: the simplest option. The reader types the code into the existing "Got a new sticker?" or search field; no new software.
- Node.js: `node-hid` (USB HID readers) or `serialport` (serial and USB-serial readers) for a small desk helper app that opens `<PUBLIC_SITE_URL>/tag/<code>` when a tag is read.
- Python: `nfcpy` (USB NFC readers such as the ACR122U class) for HF/NFC; `MFRC522` libraries for the low-cost RC522 module on a Raspberry Pi. UHF readers usually come with the vendor's SDK.

---

## 5. Integration path

### 5.1 What already exists

- Every Smart Tag has a `tag_type` of `qr`, `rfid` or `nfc` (migration `20261009_tag_expiry_and_auction_buyout.sql`). Only `qr` is generated today; the other types are switched on with the server setting `SMART_TAG_TYPES_ENABLED` (for example `qr,nfc`), see `enabled_tag_types()` in `Server/app/utils/smart_tags.py` and section 10 of `SMART_TAGS_GUIDE.md`.
- `encode_value()` in the same file already decides what goes on each medium: **the full link for QR and NFC, the bare code for RFID.** So an NFC sticker carries `<PUBLIC_SITE_URL>/tag/<code>`, the same as the QR code. A UHF RFID tag carries the 12-character code (it fits the common 96-bit EPC memory as 12 ASCII characters), and the reader software opens `<PUBLIC_SITE_URL>/tag/<code>`.
- The batch export (Admin, Smart tags, "Download codes and URLs") already lists, per tag, the value to write on the medium.

### 5.2 What changes

- **No database or API change is needed.** The tag code on the chip is the Smart Tag code already in the system, so registration, privacy, expiry, the scan page and the finder notice work unchanged.
- **To issue NFC stickers:** set `SMART_TAG_TYPES_ENABLED=qr,nfc`, generate a batch with type NFC, write each sticker with the exported link, lock it read-only, and test it with an Android phone and an iPhone.
- **Optional app feature (not built yet):** a "Write NFC tag" button that writes a tag's link with Web NFC. It must appear only where the browser supports it (`"NDEFReader" in window`), which in practice means Chrome on Android. The best place is the admin Smart tags page, so stickers are written and locked by the office before they are sold; an owner-side button on My Smart Tags could help replace a damaged sticker for a tag the owner already registered.

### 5.3 Phases

1. **Phase 1, NFC stickers (recommended):** NTAG213, ideally a combined sticker with the QR code printed on top, written with the same link and locked. Anti-metal stickers for laptops. A pilot of 20 to 50 stickers first, following the test run in section 5 of `SMART_TAGS_GUIDE.md`.
2. **Phase 2, desk reader (optional):** one USB "keyboard" HF reader at the Lost and Found desk to open a handed-in item's tag page without typing.
3. **Phase 3, UHF inventory (separate decision):** only if the office wants shelf-level inventory of items in custody.

---

## 6. Risks and recommendations

| Risk | What could happen | Recommendation |
|---|---|---|
| iPhone gap | iPhones cannot write stickers from the web app | Write stickers at the office with an Android phone or a native app. Recent iPhones still read the stickers. Keep the QR code on the same sticker. |
| Overwriting | Someone rewrites an unlocked sticker with a different link (for example a phishing page) | Lock every sticker read-only right after writing. Test a locked sticker cannot be rewritten before issuing a batch. |
| UID cloning | A chip's serial number (UID) can be copied onto special "magic" chips | Never use the UID as proof of identity. E-Balik relies on the server-side tag code (about 60 bits of randomness, not guessable) and the server's rules, exactly as with QR codes. Copying a sticker is no worse than photographing a QR code. If authenticity ever matters, consider NTAG 424 DNA chips, which sign each tap, as a later upgrade. |
| Durability | Heat, water, bending and metal surfaces damage or detune stickers | Use anti-metal stickers on metal, waterproof (PET) faces, and place them away from hinges. Keep the printed code under the QR code as the last fallback. |
| RFID read collisions | A desk reader picks up neighbouring tags | UHF readers handle many tags at once (anti-collision), but software must ignore duplicates and, at a desk, lower the reader's power or use a short-range reader so only the item on the desk is read. |
| Privacy | A tag could be read without the owner knowing | The chip holds only the link, never personal data. What a finder sees is decided on the server by the owner's privacy switches, as today. |
| Cost creep | Readers and specialty tags cost more than stickers | Start with Phase 1 only; buy readers only when a desk process needs them. |

**Overall:** NFC is a low-risk, low-cost upgrade that reuses everything already built. It should be piloted with a small batch before any large order. RFID is worth considering later, for the office's own inventory, not for owners' stickers.
