# E-Balik status glossary

One word for one thing. This page says which word the database stores and which word people read, so the user app, the admin console, the emails
and the code agree. If you add a status, add it here first.

## The rule

> When an item has left the office for good, every report and claim about it is **Completed**.

- A found report is Completed when the item was released to its owner or was sold and collected.
- A lost report is Completed when its item was released to its owner (or an administrator marked it so).
- A claim is Completed when the owner collected the item in person.
- An auction is Completed when the winner paid and collected the item.

The database keeps its older stored words (`returned`, `collected`) because renaming them would break existing rows, functions and tests.
Only the label people read is "Completed". Never show a person `returned`, `collected`, `resolved`, `released` or `claimed` for a finished report.

## Lost report (`missing_items.status`)

| Stored | People read (user app) | Admin Lost reports tab | Meaning |
| --- | --- | --- | --- |
| `missing` | missing | Searching | Nobody has found it yet. |
| `found` | found | Found | An administrator confirmed an AI match: the item is at the office. Rejecting the match sends it back to `missing` when no other match is confirmed. |
| `returned`, `resolved`, `closed` | **Completed** | Completed | Finished. Read-only for the owner. |
| (computed) | | Potential Match, Expired | Shown by the admin page from the AI suggestions and the report's age. Not stored. |

## Found report (`found_items.status`)

| Stored | People read | Admin Found reports tab | Meaning |
| --- | --- | --- | --- |
| `unclaimed` | unclaimed | Unclaimed | The office holds it and nobody has claimed it. |
| `pending`, `review` | under review | Under Review | A claim is being reviewed. |
| `ready_to_release` | ready to release | Ready to Release | A claim was approved and the owner is coming. |
| `auctioned` | auctioned | Auctioned | The winner of an auction is confirmed and has not collected yet. |
| `returned`, `claimed`, `collected`, `closed` | **Completed** | Completed | Finished. Read-only for the finder. |

"In custody" means the item is in any status except Completed: `unclaimed`, `pending`, `review`, `ready_to_release`, `claimed` (older rows) or `auctioned`.

## Claim (`claims.status`)

| Stored | User app | Admin Claims page | Meaning |
| --- | --- | --- | --- |
| `pending`, `under_review` | Pending review | Under Review | Waiting for an administrator. Flagged after 7 days (`CLAIM_REVIEW_STALE_DAYS`). |
| `approved_for_pickup` | Approved for office verification | Approved for Pickup | The owner holds a Handover PIN and must collect before the deadline (14 days). |
| `collected` | **Completed** | Completed | The item was released at the desk. |
| `rejected` | Rejected | Rejected | An administrator said no and gave a reason, or the pickup window closed without collection (the reason says "closed automatically"; the handover log records `claim_expired`). |

A claim the claimant withdraws is removed, not given a status.

## Auction (`auctions.status` plus `fulfillment_status`, shown as one stage)

| Stage | Meaning |
| --- | --- |
| Scheduled / Live | Before / during bidding. |
| Awaiting admin | The timer ended with bids; an administrator confirms the winner. |
| Awaiting pickup | The winner is confirmed and must pay and collect within 72 hours. |
| **Completed** | Paid and collected. |
| Forfeited | The winner did not collect in time; the item is ready to be auctioned again. |
| No bids / Cancelled | Closed without a sale. Cancelled also happens automatically when the owner's claim is approved. |

## Smart Tag (`smart_tags.status`)

"Claimed" is only used for a **tag** an owner registered ("claimed the sticker"). It has nothing to do with claiming a found item.

## Guard receipt (`found_items.received_at`)

| Value | People read |
| --- | --- |
| no guard chosen (`handover_guard_id` empty) | not shown |
| guard chosen, `received_at` empty | Not confirmed yet |
| `received_at` set | Receipt confirmed / Received |

## Handover log (`custody_log.event`)

`turned_over`, `registered`, `received`, `tag_matched`, `claim_filed`, `claim_approved`, `claim_rejected`, `claim_expired`, `released`, `completed`,
`auction_listed`, `auction_confirmed`, `auction_cancelled`, `auction_completed`, `auction_forfeited`, `returned_to_custody`. The labels are in
`Server/app/utils/custody_log.py` (`LABELS`).

## Page names

| Page | Where | Was called |
| --- | --- | --- |
| Reports | Admin menu, tabs Lost reports / Found reports / Items in custody | Lost items, Found items, Chain of custody |
| Analytics | Admin menu: the summary cards plus the visual charts | Reports and analytics, and the Dashboard charts |
| Release desk | Admin menu and the guard's only screen | |
| Handling history | A button on each row of Items in custody (also prints or saves as PDF) | Chain of custody |
