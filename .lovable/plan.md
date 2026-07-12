## Goal

From the Fleet grid, open a popup on any vehicle that shows every repair record for that car — the reported issue, the diagnosis, and the completed repair — and lets you act on it right there: take the car off/on rental, start a diagnosis, break the repair into parts-and-labor line items, complete it, or just jot a note. The full vehicle page and existing card badges stay exactly as they are.

## What you'll see

**On the card (unchanged):** the current `🔴 In Repair` / `⚠️ Open repair` / `Unavailable · Open maintenance issue` badges stay as-is.

**New button** in the card's action row (bottom bar, next to "Profile"): a `Wrench` "Repairs" button showing a count of open repairs, e.g. `Repairs (2)`. Clicking it opens the popup and does not navigate away.

**In the popup** (titled with the vehicle name + tag), a single scrollable timeline for that vehicle:

```text
┌ 2019 Toyota Camry · Tag #ABC123 ─────────────────┐
│ [ Off road ⬤────  Rentable ]   ← master toggle    │
│                                                    │
│ OPEN ISSUES / IN REPAIR                            │
│  • Brake noise    🔴 Off road   [Diagnose][Note]   │
│      reported 07/10 · no diagnosis yet             │
│  • Cracked mirror ⚠️ Noted      [Diagnose][Note]   │
│                                                    │
│ IN DIAGNOSIS / IN PROGRESS                         │
│  • Brake noise → pads+rotors                       │
│      parts $180 · labor $120   [Break down][Done]  │
│                                                    │
│ COMPLETED                                          │
│  • Oil change · 07/01 · $65     [View details]     │
│                                                    │
│  [ + Log new issue ]                               │
└────────────────────────────────────────────────────┘
```

Each record shows its stage, title, reported issue, cost, and per-record actions matched to its stage:
- **Open issue:** per-repair rental toggle (off road / noted-but-rentable), **Diagnose**, **Add note**.
- **In diagnosis / in progress:** **Break down** into parts-and-labor line items, record diagnosis, **Complete**.
- **Completed:** **View details** (opens the existing completed-repair dialog).

A master "Off road / Rentable" toggle at the top reflects whether any open repair is currently blocking rental, and flips the blocking flag on the open repairs.

## How it works (technical)

All logic reuses the existing repair engine in `src/lib/mock/store.ts` — no schema or migration changes. Relevant functions already exist: `openRepairsForVehicle`, `createManualRepair`, `moveRepairToDiagnose`, `saveRepairDiagnosis`, `saveRepairDiagnosisLineItems`, `addRepairLineItemToTicket`, `completeRepairLineItem`, `completeRepair`, `setRepairRentalBlocking`, plus `repairDisplayTitle`/`repairReportedIssue`/`effectiveRepairCost` from `maintenance-utils`.

1. **New component `src/components/app/VehicleRepairPanelDialog.tsx`.** Props: `vehicleId`, `open`, `onOpenChange`. It reads `useStoreVersion()` for live updates and pulls all `maintenance` records for the vehicle, grouping them into open / in-diagnosis / completed. It renders the timeline and hosts the inline action flows.

2. **Reuse existing sub-dialogs** rather than reinventing them, so behavior matches the Maintenance page exactly:
   - "Log new issue" → the existing `CreateRepairDialog` (or `AddIssueDialog`) preset to this vehicle.
   - "View details" (completed) → existing `CompletedRepairDetailDialog`.
   - Diagnosis view → existing `ViewDiagnosisDialog`.
   - Diagnose / break-down / complete: the Maintenance page currently has this inline logic (`saveRepairDiagnosis`, `saveRepairDiagnosisLineItems`, `completeRepairLineItem`, `completeRepair`). To avoid duplicating a large block, extract the per-ticket workflow (diagnose form, line-item editor, complete form) from `src/routes/maintenance.tsx` into a shared `RepairTicketActions` component and render it both in Maintenance and in the new fleet popup. This keeps one source of truth for the repair flow.

3. **Wire into `src/routes/fleet.tsx`:** add `repairPanelVehicleId` state, add the "Repairs (n)" button in the card action bar (with `e.stopPropagation()` so it doesn't trigger the card's navigate-to-profile), and render `<VehicleRepairPanelDialog>` once at the bottom alongside the other fleet dialogs. Open-repair count comes from the already-computed `openRepairs` in the card's render.

4. **Live updates:** because every store function calls `emit()` and the popup subscribes via `useStoreVersion()`, taking a car off rental, completing a repair, or adding a line item updates the popup, the card badges, and the financial figures immediately (line items already post to P&L on add).

## Out of scope

- No changes to card badges, financial calculations, or the vehicle detail page beyond the shared-component extraction.
- No database/RLS/migration changes — this is presentation plus reuse of existing store logic.

## Verification

After building: open Fleet, click "Repairs" on a car with an open issue, confirm the timeline shows issue/diagnosis/completed sections; toggle off/on rental and confirm the card badge and `isVehicleBookable` state update; log a new issue, diagnose it, break it into line items, and complete it from the popup; confirm the Maintenance page still renders and behaves identically after the shared-component extraction (typecheck + a quick Playwright pass on both pages).