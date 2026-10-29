# Concept: user-posted auctions with a platform commission

Status: **built 2026-10-29 (round 14, see PROJECT_CONTEXT.md).** Defaults chosen: 5% seller-only fee, PHP 10 minimum, PHP 500 cap, 3-day hold, the item is at the office before it is listed. The open questions below are still worth confirming with the university.

## The idea
Today only the Lost and Found Office lists auctions (unclaimed found items). This adds a second kind: **a student or staff member lists their own item**, the Office reviews and runs the auction, the buyer pays **the system** (the Office), the system keeps a **commission**, and the rest is paid out to the seller. Everything stays inside the existing admin pages, receipts and ledger.

## Recommended commission
- **5% of the winning bid, charged to the seller only**, with a **minimum of PHP 10** and a **cap of PHP 500** per sale. Bidders pay exactly what they bid (no hidden buyer fee).
- Unsold or cancelled auctions cost the seller nothing.
- Why 5%: campus marketplaces and Carousell-style listings run about 0 to 5%, while Shopee/Lazada/eBay-type platforms charge 5 to 13% because they carry delivery, ads and dispute teams. Students sell low-value items, so more than 5 to 8% makes them trade outside the platform. 5% covers the Office's handling cost without driving sellers away.
- Keep it **configurable in System Control** (rate, minimum, cap, on/off), and **show the exact fee and payout to the seller before they submit**. Changing the rate affects only auctions listed afterwards; each auction stores the rate it was listed with.

## Flow (every step is a status the admin can see)
1. **Seller submits** a listing: photos (required), title, category, description, starting price, optional reserve price and buy-out, preferred end date. Only accounts with a verified ID and no bidding/selling ban. The fee preview is shown here and the seller accepts the rules.
2. **Office reviews** (new Auctions tab "Seller submissions"): approve, ask for changes, or reject with a reason. Prohibited items are refused (weapons, drugs, alcohol, vapes, stolen or found property, counterfeits, live animals, exam material, anything that is not the seller's to sell).
3. **Auction runs** with the existing engine (bids, anti-snipe, buy-out). Labelled "Posted by a student" so nobody mistakes it for found property. The seller cannot bid; admins can pause or cancel.
4. **Winner pays the Office** through the existing payment confirmation: GCash, Maya, bank or cash, receipt image for e-banks, admin confirms, PR- receipt issued to the buyer.
5. **Handover at the Office or guard desk** with the existing handover PIN. The seller brings the item to the Office after the sale (the Office holds it), or the buyer and seller meet at the desk. The Office marks "collected".
6. **Seller payout** after collection and a short hold (suggest 3 days for complaints): admin sends the money (GCash/bank/cash), enters the reference and optional proof, and the seller gets a **payout receipt** (PO- number) by email and in their profile.
7. **Problems**: buyer does not pay (existing auto-forfeit, then offer the next bidder or relist), item not as described (hold the payout, refund the buyer through a reversal, no commission earned), seller withdraws after bids (warning, then selling ban).

## Money design (the part that must be right)
The existing `income_ledger` is "income of the Office". A user auction must not put the **whole sale** into income, only the commission.
- **Income** (counted in the Revenue pages, stats, monthly report): one ledger entry per sale, `source = 'user_auction'`, amount = **commission only**.
- **Not income, but tracked**: the gross payment from the buyer and the amount owed to the seller. New table `seller_payouts` (payout_id, auction_id, seller_account_id, gross, commission_rate, commission, payout_amount, status `holding / ready / paid / cancelled`, method, reference, proof_path, paid_at, paid_by, receipt_no). It is a liability: the Office holds this money until it pays the seller.
- The buyer's payment is recorded in `payment_proofs` and confirmed exactly like today. A refund reverses the commission entry and cancels the payout (reversal still needs the authenticator code, and the append-only ledger lock still applies).
- The Revenue page gets a "Seller payouts" tab (owed, ready to pay, paid, held) beside Payments, Receipts and Statistics, with the same filters, export and activity log. Statistics show commission earned, gross sales volume, number of seller sales, and money still owed to sellers.
- A payout is a separate admin action with its own confirmation and its own receipt, so nothing leaves the Office without a record.

## What is reused and what is new
- Reused: auction engine and bids, handover PIN, payment confirmation and receipts (`PaymentDesk`), activity log, notifications and emails, ID verification, bidding bans, monthly report, backups (add `seller_payouts`).
- New: seller submission form and "My listings" page for users, review queue for admins, `auctions.seller_account_id`, `auctions.commission_rate`, `auctions.reserve_price`, `auctions.review_status`, the `seller_payouts` table (RLS on, service role only), payout receipts, new ledger source `user_auction`, System Control fee settings, prohibited-items rules, report/analytics sections, tests.
- `auctions.found_item_id` is already optional, so an auction without a found item needs no schema change there.

## Feasibility and phases
Medium to large, about two build rounds. Suggested order:
1. Settings + seller submission + admin review + "posted by" label (no money yet; auctions run as today, ending in admin-handled arrangement).
2. Commission + `seller_payouts` + payout confirmation, receipts and the Revenue "Seller payouts" tab.
3. Seller dashboard (earnings, payout status), ratings/reputation, dispute flow, monthly report and analytics sections.

## Risks to decide on before building
- **Legal and tax**: the university must approve running paid sales between students. Commissions are income of the Office (BIR/university finance rules) and the Office is holding customers' money. Ask the finance office and legal adviser, and keep payouts small and documented.
- **Data privacy**: the buyer and seller must never see each other's email or campus ID (the Office is the go-between, as with claims).
- **Workload**: every listing needs a review; cap active listings per seller (suggest 3) and require a verified ID.
- **Fraud**: stolen items, fake receipts (admin confirms with the image), non-paying winners (forfeit and ban), shill bidding (seller cannot bid; flag bidders who only ever bid on one seller).
- **Scope creep**: this turns a lost-and-found into a marketplace. Keep the label, rules and fees clear so the Office's core job is not weakened.

## Open questions for the Office
1. Does the university allow student-to-student paid sales on the platform?
2. Commission: 5% with PHP 10 minimum and PHP 500 cap, or a different rate?
3. Who holds and pays out the money (Office cash and GCash account), and how long is the payout hold?
4. Can staff and alumni sell, or students only?
5. Does the seller drop the item at the Office before the auction starts (safest), or only after it sells?
