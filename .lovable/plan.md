# Multi-item repair tickets

Today each repair ticket in Maintenance handles one problem. To fix several things on the same car you either cram them into one description or create several tickets (or use the "split" option, which explodes one diagnosis into separate sibling tickets). This adds a proper **line-items model**: one ticket can hold many repair items that flow through every phase, each item carries its own cost, and each finished item is logged individually to the vehicle's repair history.

The existing single-issue flow and the "split into separate tickets" option stay exactly as they are — this is additive and backward compatible.

## What changes for you

```text
ONE TICKET (car in shop) ──────────────────────────────
  Item 1: Front brakes      parts $120  labor $80   [Complete]
  Item 2: Alternator        parts $210  labor $120  [In progress]
  Item 3: Oil leak gasket   parts $40   labor $90   [In progress]
  Ticket total = sum of all items
```

1. **Create repair** — add multiple "what's wrong" items in one ticket instead of a single description (the multi-issue dialog already exists; the inline quick-create gets an "add another item" control too).
2. **Move to diagnosis** — add/edit any number of diagnosis line items, each with its own parts-needed, parts cost, and labor cost. Ticket total = sum of items.
3. **Before sending to mechanic** — the "things for him to check" checklist already supports multiple items; it will be pre-seeded from the ticket's line items so you can send the whole list at once.
4. **Complete** — check off items one at a time. Each completed item logs immediately to the vehicle's fleet-card repair history as its own entry (its own cost, date, timestamp, mechanic). The ticket auto-moves to Complete when the last item is done. No more one-ticket-per-problem for a car sitting in the shop.
5. **Fleet card / vehicle detail** — each repaired item shows as an individualized event with its own cost and timestamp, not lumped under one line.

## Technical detail

### Data model
- Migration: add nullable `line_items jsonb` column to `public.maintenance` (default `'[]'`). No existing column is changed; existing tickets keep working with `line_items` empty/omitted.
- Each line item shape:
  ```ts
  { id, title, problemCategory?, partsNeeded?, partsCost, laborCost,
    status: "open" | "complete", completedAt?, completedBy?, mechanicName?, notes? }
  ```
- Extend the `Maintenance` type in `src/lib/mock/data.ts` with `lineItems?: RepairLineItem[]`, and map it in the maintenance `toMaintenance` / row-mapper in `src/lib/mock/store.ts` (read/write `line_items`).
- Derived ticket totals: when `lineItems` is non-empty, `partsCost`/`laborCost`/`cost` are computed as the sum of items so P&L, balances, and existing displays stay correct. When empty, current behavior is untouched.

### Store functions (`src/lib/mock/store.ts`)
- `createManualRepair` / `createRepair`: accept an optional `lineItems` array (fall back to today's single-issue behavior when none passed).
- `saveRepairDiagnosis`: accept `lineItems`; keep the existing `splits` path untouched (both supported per your choice).
- New `completeRepairLineItem(ticketId, itemId, { partsCost, laborCost, mechanicName, notes, completedBy })`:
  - marks that item `complete`, stamps date/time,
  - inserts one `repair_history` row (and `repair_scorecard` row) for that item so it appears individually on the fleet card,
  - posts that item's cost to P&L (Parts/Labour expense) — mirrors the current per-ticket completion logic, scoped to the item,
  - when all items are complete, sets the ticket `status = "complete"` and finalizes it (reusing existing `completeRepair` finalization for scheduled-alert reset and vehicle availability).
- `completeRepair` stays as the path for single-issue (no line-items) tickets.

### UI (`src/routes/maintenance.tsx` + dialogs)
- **Create**: quick-create inline form gets repeatable item rows; the richer `CreateRepairDialog` already supports multiple issues — wire its issues into `lineItems`.
- **Diagnose (Phase 2)**: replace the single diagnosis input block with a repeatable item editor (title, parts needed, parts $, labor $, running total). The existing "split" toggle remains available.
- **Complete (Phase 3)**: render each line item with its status and a per-item "Mark complete" action (capturing final parts/labor/mechanic/notes); show ticket progress (e.g. "2 of 3 done").
- **Send to mechanic** (`SendToMechanicDialog`): pre-populate the checklist from the ticket's open line items (still editable, still optional).

### Fleet card / vehicle detail (`src/routes/fleet.$vehicleId.tsx`)
- No schema change needed — because each completed item already writes its own `repair_history` row, the existing Repair History list will show them individually with cost, date, and timestamp. Verify the rendering handles multiple same-ticket entries cleanly (grouping label optional).

### Backward compatibility
- Tickets with no `lineItems` behave exactly as today (single issue → diagnose → complete, or split).
- All new fields are additive and nullable; no existing workflow, filter, or layout is restructured.
