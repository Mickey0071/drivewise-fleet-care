## Goal

Add a one-shot "Log past repair" action on the vehicle fleet card that records a completed repair directly to the vehicle's repair history and expenses — no ticket, no mechanic dispatch, no approval flow.

## Where it lives

- Vehicle detail page (`src/routes/fleet.$vehicleId.tsx`), Repairs tab.
- New button **"+ Log past repair"** placed next to the existing **Download CSV** / **Copy deep link** buttons, right above the "Repair history" section.
- Existing "New repair" (ticket) flow stays untouched — this is an additive shortcut for repairs already done.

## Dialog: `LogPastRepairDialog`

New component `src/components/app/LogPastRepairDialog.tsx`. Fields:

- Date completed (defaults to today)
- Problem category (reuse `ProblemCategorySelect`)
- Short description (e.g. "Front brake pads")
- Vendor / mechanic name (free text)
- Parts cost ($)
- Labor cost ($)
- Total (auto = parts + labor, read-only)
- Notes (optional)
- Mileage at service (optional)

Vehicle is locked to the current fleet card.

## Write path

Reuse the existing `addMaintenance(...)` store function (already used by `LogServiceDialog`) with a completed shape so it lands as a real repair, not an open ticket:

- `serviceType` = description
- `vendor` = vendor
- `dateCompleted` = chosen date
- `completionDate` = chosen date
- `status` = `"complete"`
- `partsCost`, `laborCost`, `cost` = parts + labor
- `problemCategory` = selected category
- `historyPostedAt` = now (matches the flag repair-accept flow already uses to prevent double-posting)
- `notes`, `mileageAtService` when provided

Because the record is marked complete with `partsCost`/`laborCost`, `getVehicleFinancials` automatically picks it up and splits it into Parts / Labor expense rows in the P&L, ROI, expense tracker, and CSV export — no separate `expenses` insert needed (that would double-count).

It will render in the Repair history list immediately via `completedRepairs`, and appear in the combined "Download CSV" export already on the tab.

## Out of scope

- No SMS / mechanic job / approval token.
- No changes to the ticket-based `CreateRepairDialog`, `sendMechanicJob`, or repair scorecard flow.
- No schema/migration changes — this uses the existing maintenance record shape.

## Files touched

- `src/routes/fleet.$vehicleId.tsx` — add button + dialog mount on the Repairs tab.
- `src/components/app/LogPastRepairDialog.tsx` — new.
