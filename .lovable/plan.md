## Goal

Capture the diagnosing mechanic and parts source (with costs) during **Phase 2 · Diagnose**, and let the admin adjust or add parts/labor in **Phase 3 · Complete Pending Approval** right up until "Complete Repair" is pressed. Payment processing behavior stays the same.

## Phase 2 · Diagnose — new fields

For each repair (and each extra split/line item), add two inputs alongside the existing Parts $ / Labour $:

- **Diagnosing mechanic** — free‑text, saved to the maintenance record's `mechanicName` (and per line item on a one‑ticket‑multi‑item diagnosis).
- **Parts source / supplier** — free‑text ("Where did we get the part from?"), saved to `vendor` on the maintenance record. For a multi‑item ticket, saved per line item.

Nothing else in Phase 2 changes: same "Save Diagnosis →" / "Save & Split →" / "Save Items →" buttons, same move to Phase 3.

## Phase 3 · Complete Pending Approval — pre‑complete adjustments

Add an **Adjust before completing** section inside each Phase 3 card, above the existing Total / Paid / Balance box and "Complete Repair" button. Nothing runs until the admin explicitly saves an adjustment.

Two variants, matching how the repair was diagnosed:

1. **Single‑repair tickets** (no line items):
   - Editable fields: Parts $, Labour $, Mechanic, Parts source.
   - "Add itemized part" opens the existing parts/labor breakdown editor (already in the app) so extra parts or labor lines can be appended; totals auto‑roll into Parts $ / Labour $.
   - "Save adjustments" persists changes to the maintenance record.

2. **Multi‑item tickets** (line items):
   - Every not‑yet‑completed item already has editable Parts $, Labour $, Mechanic, Notes — add a **Parts source** field to that same row.
   - New "+ Add another item" button appends a fresh line item (title, parts $, labour $, mechanic, supplier) that flows through the same "Mark item complete" path.
   - Editing an item's fields no longer requires marking it complete — a "Save item changes" action stores edits in place.

Payment box, "Process Payment", and "Complete Repair" work exactly as they do today; the Complete button remains disabled until balance is $0.

## Where the same view appears

The Fleet Card repair panel (`VehicleRepairPanelDialog`) shows the same Phase 2 / Phase 3 UI. All Phase 2 and Phase 3 additions above are mirrored there so the flow is identical from either entry point.

## Technical notes

- **Types (`src/lib/mock/data.ts`)**: add optional `partsSupplier?: string` to `RepairLineItem`. `Maintenance.mechanicName` and `Maintenance.vendor` already exist and are re‑used for the Phase 2 additions — no schema migration needed for the base fields. Add `parts_supplier` (text) to line‑item JSON via the existing `line_items` jsonb column on `maintenance` (no DDL required — jsonb payload).
- **Store (`src/lib/mock/store.ts`)**:
  - Extend `saveRepairDiagnosis` input with `mechanicName?` and `vendor?`, writing them to the record (and to each split ticket when splitting).
  - Extend `saveRepairDiagnosisLineItems` items with `mechanicName?` and `partsSupplier?`.
  - Add `updateRepairAdjustments(id, { partsCost?, laborCost?, mechanicName?, vendor? })` for single‑repair Phase 3 edits.
  - Add `updateRepairLineItem(id, itemId, patch)` and `addRepairLineItem(id, item)` for multi‑item Phase 3 edits/adds (only allowed while `status === "pending_complete"`).
- **UI (`src/routes/maintenance.tsx` and `src/components/app/VehicleRepairPanelDialog.tsx`)**:
  - Extend the Phase 2 `DiagInput` / `SplitEntry` state with `mechanicName` and `partsSupplier`, render two inputs, pass them into the save calls.
  - Add the Phase 3 "Adjust before completing" block described above; reuse the existing `RepairBreakdownEditorDialog` for itemized parts/labor breakdown adds.
- Repair History, Expenses split (Parts / Labor), and P&L math already read from `partsCost` / `laborCost` / `vendor` / `mechanicName`, so no changes are needed there — the new values flow through automatically.

No database migration required (line‑item edits ride the existing `line_items` jsonb column; mechanic/vendor already have columns).
