## Goal

On the **Parts** page, add a "Record part purchase" form that logs the purchase straight into expenses — no repair ticket required — so it flows into the P&L and every expense chart. Each purchase is linked to a **vehicle**, a **technician**, a **supplier**, a **part cost**, and a **labor-to-repair price**.

## How it works for you

A new card appears on the Parts page: **Record a part purchase**. You fill in:
- **Vehicle** (required) — dropdown of fleet vehicles
- **Technician** (required) — name field with suggestions from technicians used before
- **Supplier** — where the part was purchased
- **Part name / description**
- **Part cost** ($)
- **Labor to repair** ($)
- **Date** (defaults to today)
- **Notes** (optional)

On **Save**, it creates two expense entries (matching how repair tickets already post), both tied to the same vehicle/technician/supplier/date:
- a **Parts** expense = part cost
- a **Labour** expense = labor-to-repair price

Because these go through the same expense pipeline as everything else, they immediately show up in the Expense Logger, P&L dashboard, vehicle profitability, and all expense charts. No maintenance/repair ticket is created.

## What gets built

### `src/routes/admin.parts.tsx`
- Add a new `RecordPartPurchase` card alongside the existing inquiry UI (adjust the page grid to fit it).
- Fields as above, using existing UI primitives (`Input`, `Select`, `Label`, `Textarea`, `Button`).
- Vehicle dropdown sourced from the mock/store `vehicles` list (same source the Expenses page uses).
- Technician input backed by a `<datalist>` of previously used technician names (derived from existing `maintenance` records' `mechanicName` plus any prior part-purchase technicians).
- Client-side validation with zod: vehicle required, technician required (trimmed, non-empty, max length), part cost and labor each ≥ 0 with at least one > 0, date valid, notes/supplier length-capped.

### Expense creation (reuse existing pipeline)
- Call `addExpense` from `src/lib/mock/store.ts` twice:
  - `{ category: "Parts", amount: partCost, date, vehicleId, vendor: supplier, notes: "Part: <name> · Tech: <technician>" }`
  - `{ category: "Labour", amount: laborPrice, date, vehicleId, vendor: supplier, notes: "Labor · Tech: <technician>" }`
- These reuse the exact categories (`Parts`, `Labour`) that completed repairs already post, so the parts-vs-labor breakdown in charts stays consistent.
- Rows with amount `0` are skipped (e.g. if labor is left blank).
- Await `cloudReady` so the write reaches the backend, then toast success and reset the form.

## Technical notes

- No schema/migration changes — the existing `expenses` table already has `vehicle_id`, `category`, `amount`, `date`, `vendor`, and `notes`, and `addExpense` persists to it via the current cloud-write path.
- Technician is stored in the expense **notes** (there is no technician table today); **supplier** uses the existing `vendor` field. This keeps per-vehicle profitability and vendor-based views working unchanged.
- The P&L and expense charts already aggregate from `expenses` + completed maintenance via `buildCombinedExpenses`, so no chart code needs to change — new rows appear automatically.

## Out of scope
- No new technician table or supplier management.
- No repair ticket / maintenance record is created for these purchases.
- No changes to how existing repair tickets post expenses.