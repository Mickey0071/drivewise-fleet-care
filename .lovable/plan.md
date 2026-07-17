## Goal

When an admin taps **Accept** on the mechanic diagnosis link, immediately stamp the vehicle's repair history and log the P&L expense with the mechanic's checked services and prices. Today those only post when the ticket is later marked Complete.

## Scope

Server-side only. Edit `acceptRepairAction` in `src/lib/repair-actions.functions.ts`. No UI changes; no schema changes.

## Behavior

On Accept, in addition to the current update (status → `pending_complete`, mechanic SMS):

1. **Insert `repair_history`** row for the vehicle:
   - `issue` = `issue_description` or `service_type`
   - `parts` = human-readable list built from `parts_list` (name × qty @ price)
   - `parts_cost`, `labor_cost`, `total_cost` from the maintenance row
   - `mechanic_name`, `completed_by = "Admin (approved)"`
   - `notes` = "Approved from mechanic diagnosis"
2. **Insert `expenses`** row:
   - `category` = "Repair & Maintenance"
   - `amount` = `cost`
   - `vehicle_id`, `maintenance_id` linked
   - `vendor` = mechanic name
3. **Guard against double-posting on Complete.** Stamp a new flag on the maintenance row (`history_posted_at`) inside the same Accept update. The completion path in `store.ts` (~line 2611) reads this flag and skips its own `repair_history` + expense inserts when set, so marking Complete later doesn't duplicate.
4. **Idempotency.** The existing `.eq("action_taken", "pending")` guard already prevents a second Accept from firing. History/expense inserts run only when that update actually affects a row.

## Answers to the two questions asked

- **Same phone doesn't matter** — accept/decline links are token-based URLs, not tied to the sending number. "Link unavailable / invalid" means the token was already consumed (someone tapped Accept/Decline) or the mechanic re-submitted the checklist and rotated the tokens.
- **What's recorded today vs after this change** — today, Accept saves the checked services/prices onto the maintenance ticket only; repair history + P&L post only when Complete is tapped. After this change, they post to the vehicle on Accept.

## Technical notes

- Migration adds `history_posted_at timestamptz` to `public.maintenance` (nullable) so the completion path can detect an already-posted ticket.
- Uses `supabaseAdmin` (already imported) for the inserts inside the server function handler.
- No changes to the mechanic-facing form, the accept page UI, or the Complete workflow beyond the skip-if-already-posted guard.
