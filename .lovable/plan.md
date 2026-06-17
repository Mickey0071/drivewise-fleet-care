## Goal

Declutter the repair cards in the 3-phase kanban on `src/routes/maintenance.tsx`. Give each `RepairRow` a clean, essentials-only **card face**, and tuck lower-priority fields behind a per-card **Details** disclosure that is collapsed by default. No status, approval, cost, kanban-filter, or write logic changes — purely what renders and where.

## Scope guardrails (unchanged)

- No edits to status values, `action_taken`, phase filters (`phase1/phase2/phase3`), approval/accept-decline, SMS digest, P&L, or rental blocking.
- All existing stage forms (diagnosis inputs, payment input) and action buttons (Send to Mechanic, Move to Diagnose, Save Diagnosis, Process Payment, Complete Repair, Resend/Cancel job, etc.) keep their exact behavior and current location in the expanded stage body.
- No column deletes; no changes to `data.ts`/`store.ts` field logic. (Type may get read-only display use only.)

## Card FACE (always visible) — `RepairRow`

Rebuild the `RepairRow` face (currently just chevron + `name — issue` + category badge) to show only:

- **Vehicle**: `year make model` + plate (`vehicleById(m.vehicleId)`).
- **Problem category badge**: `m.problemCategory` (existing badge, kept).
- **Issue text**: `m.issueDescription ?? m.serviceType`, truncated to one line.
- **Current status**: small status label derived from the existing status value (display only).
- **Total cost**: `partsCost + laborCost`, falling back to `m.cost` when both are 0 (same rule already used in the diagnose/complete phases).
- **Off road indicator**: a small badge shown **only when** `m.isRentalBlocking === true`.
- **Mechanic name**: `m.mechanicName`, rendered only when assigned.
- **Primary action button**: the single stage-appropriate primary button stays where it is in the expanded body; the face keeps the chevron toggle for the stage body. (No behavior change.)

The face stays a compact tap target that toggles the existing stage body (`onToggle` / `expandedId`), and keeps the delete (trash) button.

## DETAILS (collapsed by default, expands on tap)

Add a lightweight **Details** disclosure to each card (its own local open/closed state, independent of the stage `open` toggle, defaulting to **collapsed**). When expanded it shows the lower-priority fields:

- `vendor`
- Mechanic phone + mechanic shop — sourced from the linked mechanic-job record (`sentJobByMaint` / `submittedJobByMaint`), since these aren't on the `Maintenance` row itself; shown only when a job exists.
- Parts list (`m.diagnosisNotes` "parts used" / `partsNeeded`)
- Payment breakdown: `downPayment`, `amountPaid`, `balance`, and deposit fields (`depositRequired`, `depositAmount`)
- `nextServiceDue`
- `mileageAtService`
- Mechanic-job send/submitted status badges (the `📤 Sent to…` / `📋 Submitted by…` chips currently inline)

Each field renders only when it has a value, so the Details section stays tidy.

## Implementation approach

- Refactor `RepairRow` (lines 1017–1053) into a richer presentational component that renders the new face plus a `RepairDetails` collapsible. Keep its props (`m`, `open`, `onToggle`, `onDelete`) and add what it needs to read the linked job (pass `sentJobByMaint`/`submittedJobByMaint` lookups or the job object in as props to avoid new logic in the row).
- The three phase `.map(...)` blocks (lines 320–361, 388–445, 472–510) keep their existing expanded stage bodies and buttons exactly as-is. The only change there is passing the extra job-lookup prop to `RepairRow`.
- Add a small `Details` toggle (Chevron + "Details") and a `useState(false)` per row inside the row component so every card defaults collapsed.
- Display-only helpers: a `totalCostFor(m)` helper using the existing parts/labor/cost fallback, and a status-label map for display.

## Technical notes

```text
RepairRow
 ├─ FACE (always)         vehicle+plate · category · issue(1-line) · status · total · [Off road?] · [mechanic?]
 │   └─ chevron toggles existing stage body (unchanged)
 ├─ STAGE BODY (open)     existing forms + primary/secondary buttons (UNCHANGED)
 └─ DETAILS (collapsed)   vendor · mech phone/shop · parts · pay breakdown · next due · mileage · job badges
```

## Verification

- Build passes; maintenance page renders.
- Every card face shows only the essentials list; off-road badge appears only when `isRentalBlocking`, mechanic name only when assigned.
- Details is collapsed on every card by default and expands/collapses on tap.
- All stage buttons still trigger their existing handlers.

## Report back after build

- The final card-face field list.
- Confirmation that Details defaults collapsed and expands/collapses per card.