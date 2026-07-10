## Goal

In the **Create Repair** dialog on the Maintenance page, add an optional **Routine Maintenance** section. Once a vehicle is picked, its due/upcoming scheduled tasks (oil change, battery test, alternator test, inspection, custom alerts) can be added into the ticket with one tap. Each added task becomes a normal, editable line item — you can rename it, add more items, set problem category, and later fill in parts/labor in the Diagnose phase like any repair.

## What you'll see

```text
Create Repair
 ├─ Vehicle:        [ 2021 Toyota Camry · ABC123 ▼ ]
 ├─ Routine maintenance for this vehicle   (appears after a vehicle is chosen)
 │    ☐ Oil Change          — overdue
 │    ☐ Battery Test        — due in 5 days
 │    ☐ Alternator Test     — upcoming
 │    ☐ Inspection          — due in 12 days
 │    (checking one drops it into the Issue list below, editable)
 ├─ Issue:          [ What's wrong? ]
 │    + additional items (routine picks land here, fully editable)
 ├─ Problem category: [ ▼ ]  (auto-set to "Routine / scheduled" when a routine task is added)
 └─ Take off rental availability?  [switch]
```

## Behavior

- The routine list is built from the selected vehicle's existing scheduled settings (via `computeScheduledItems`), showing each task's label and status (overdue / due soon / upcoming).
- Checking a routine task adds its label (e.g. "Oil Change") as an editable line item in the Issue area. Unchecking removes it. You can still type free-text issues and mix routine + repair items on one ticket.
- When at least one routine task is added and no category is chosen yet, the Problem category defaults to a new **"Routine / scheduled"** option so these group cleanly in analytics; you can override it.
- On Create, everything is saved through the existing `createManualRepair` line-item flow — so routine items flow into Phase 1 → Diagnose → Complete exactly like repairs, and remain editable (title, parts, labor, cost) throughout the ticket.
- No change to how scheduled reminders themselves are computed; this only lets you pull a routine task into a repair ticket.

## Technical details

- **`src/routes/maintenance.tsx`** — In the Create Repair `Dialog` (around lines 1104–1140), add a routine-maintenance block rendered when `createVehicleId` is set. Compute items with `computeScheduledItems(vehicles.find(v => v.id === createVehicleId))`. Track selected routine labels in a new `createRoutineItems` state; render checkboxes. Selecting merges the label into the same `createExtraItems`/issue pipeline used by `submitCreateRepair` (lines 101–126), so no store changes are required. Default `createCategory` to the new routine category when a routine item is picked and none is set. Reset the new state in the dialog `onOpenChange` cleanup.
- **`src/lib/problem-categories.ts`** — Add `"Routine / scheduled"` to the `PROBLEM_CATEGORIES` list so it appears in `ProblemCategorySelect` and analytics grouping.
- No database/schema/migration changes — routine items reuse the existing `maintenance` table + `line_items` JSON via `createManualRepair`.

## Out of scope

- Does not auto-mark the scheduled task "complete" when the repair closes (kept separate to avoid double-logging). Can be a follow-up if wanted.
