## Goal

In the **Record a part purchase** form on the Parts page, add an option to attach the part to an **existing repair ticket that's still in queue** — a ticket in the **Reported (issue)** or **Diagnosing** stage. When a ticket is chosen, the part + labor is added to that ticket as an editable line item (so it flows through the normal Diagnose → Complete pipeline). When no ticket is chosen, it keeps working exactly as today (standalone expense → P&L).

## What you'll see

```text
Record a part purchase
 ├─ Vehicle *:        [ ABC123 · 2021 Toyota Camry ▼ ]
 ├─ Add to a repair ticket   (appears after a vehicle is chosen)
 │    ( ) No ticket — log as a standalone expense
 │    (•) Front brake noise        — Diagnosing
 │    ( ) Check-engine light        — Reported
 ├─ Technician *:     [ ... ]
 ├─ Supplier:         [ ... ]
 ├─ Part name:        [ Front brake pads ]
 ├─ Part cost ($):    [ .. ]   Labor to repair ($): [ .. ]
 ├─ Date / Notes
 └─ [ Add to ticket ]  (button label switches when a ticket is selected)
```

## Behavior

- After a vehicle is picked, the form lists that vehicle's open in-queue tickets (status **reported** or **diagnosing**), each with its display title and a stage badge. A "No ticket — standalone expense" option is selected by default so current behavior is unchanged.
- **When a ticket is selected:** the part becomes a new editable line item on that ticket — title = part name (or "Part"), `partsNeeded` = supplier/notes, `partsCost` = part cost, `laborCost` = labor-to-repair, status `open`. It's appended to the ticket's existing `lineItems`, and the ticket's parts/labor/cost/balance recompute automatically. The item is fully editable later in the ticket's Diagnose editor. Because completed line items post to P&L when the ticket is worked, no separate expense row is created (avoids double-counting).
- **When no ticket is selected:** behaves exactly as today — writes Parts and/or Labour expense rows straight to expenses/P&L.
- Technician stays required in both modes; when a ticket is chosen the technician is saved onto the line item's `mechanicName`/notes.
- Toast and button copy adapt ("Added to ticket" vs "Part purchase logged to expenses").

## Technical details

- **`src/routes/admin.parts.tsx`** (`RecordPartPurchase`):
  - Import `openRepairsForVehicle`, `saveRepairLineItems` from `@/lib/mock/store`, and `repairDisplayTitle` from `@/lib/maintenance-utils`; import `RepairLineItem` type from `@/lib/mock/data`.
  - Add `ticketId` state (default `""` = no ticket). Compute `openTickets = vehicleId ? openRepairsForVehicle(vehicleId).filter(t => t.status === "reported" || t.status === "diagnosing") : []`. Render a Select (or radio list) shown only when a vehicle is chosen, with a "No ticket — standalone expense" first option plus one option per ticket labeled `repairDisplayTitle(t)` + a stage tag.
  - In `handleSave`, branch on `ticketId`:
    - If set: build a `RepairLineItem` (`id: crypto.randomUUID()`, `title`, `problemCategory` left undefined, `partsNeeded`, `partsCost`, `laborCost`, `status: "open"`, `mechanicName: technician`), read the ticket's current `lineItems ?? []`, and call `saveRepairLineItems(ticketId, [...existing, newItem])`. Do **not** call `addExpense` in this branch.
    - If empty: keep the existing `addExpense` Parts/Labour logic unchanged.
  - Reset `ticketId` in `reset()`; clear it when `vehicleId` changes (a ticket from another vehicle shouldn't stay selected).
- No database/schema/migration changes — reuses the existing `maintenance.lineItems` flow via `saveRepairLineItems`, which already writes to the backend and recomputes totals.

## Out of scope

- Does not create a new ticket from the Parts page (only attaches to existing in-queue tickets); use "No ticket" for one-off purchases.
- Does not auto-complete the line item — it stays open and editable inside the ticket like any diagnosed item.
