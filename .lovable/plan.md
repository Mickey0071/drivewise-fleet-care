## Goal

Let an admin send a vehicle's **weekly routine maintenance (RM) checklist** to a single runner as a task. The runner fills it out and submits, but **nothing touches the vehicle until the admin approves**. On approval, the vehicle's scheduled-maintenance clocks and RM history update automatically. Rejection leaves the vehicle untouched, with an **administrative override** so the admin can edit/apply the results manually when needed.

This reuses the existing Runner Task pipeline (token link + SMS + public fill-out page + admin task list) instead of building a parallel flow. The RM "apply" logic (`applyRmSubmission`) already exists and is only triggered on approval.

## How it works

```text
Admin                         Runner                    Admin (review)
  |  Send RM task (vehicle) ->  |                          |
  |                            fills RM checklist          |
  |                            (Pass / Fail + notes,       |
  |                             optional photos) -> submit |
  |                                                  shows in Runner Tasks
  |                                                  Approve -> applyRmSubmission
  |                                                            (updates vehicle)
  |                                                  Reject  -> no change
  |                                                  Override -> edit + apply
```

## Part 1 — New task type & launch points

Add a `routine_maintenance` task type. When chosen, the task's checklist is auto-built from the vehicle's scheduled items (`computeScheduledItems`): Oil, Battery, Alternator, Inspection, and any custom alerts. The full RM metadata (vehicleId, item types/customIds, current mileage, vehicle label) is stored in the task's `details` so it can be applied later.

**Launch from both places (user choice):**
- **Create Task page** (`/admin/create-task`): add a "Routine Maintenance" template. Selecting it + a vehicle auto-populates the checklist from that vehicle's schedule and locks the type to `routine_maintenance`.
- **Fleet vehicle card** (`/fleet`): add a **"Send RM to Runner"** button that opens the same task form pre-filled for that vehicle (reusing the RM card "send to runner" name/phone inputs).

Photos: **optional** — runner can attach but is not required (existing task photo upload, `requires_photos = false`).

## Part 2 — Runner fill-out

The runner uses the existing `/runner-task/$token` page. For `routine_maintenance` tasks the per-item status choices are presented as **Pass / Fail** (instead of Done/Skipped/Issue), with a notes field per item and optional photo upload. Submission stores results exactly as the runner entered them and sets status `submitted` (no vehicle change yet).

## Part 3 — Admin approval (the gate)

In Runner Tasks (`/admin/tasks`), the report dialog for a `routine_maintenance` task gets three actions:
- **Approve** — maps the submitted Pass/Fail results to `RmItemInput[]` and calls `applyRmSubmission(vehicleId, items, …)`. This clears the passed items' maintenance clocks, logs failures as blocking maintenance issues, appends an entry to the vehicle's `rm_history`, and updates `last_rm_date`/`last_rm_mileage`. Task status → `approved`.
- **Reject** — task status → `rejected`; vehicle is **not** touched.
- **Administrative Override** — admin opens an editable copy of the RM checklist (adjust Pass/Fail, notes, mileage) and applies it directly via `applyRmSubmission`, regardless of what the runner submitted (also usable to apply with no runner at all). Task marked approved with an "override" flag.

Approval/override is guarded server-side (admin role check) and is **idempotent** — a task already applied cannot be applied twice.

## Part 4 — Vehicle history reflects it

Because approval runs the existing `applyRmSubmission`, the vehicle's **Scheduled Maintenance** resets and the **RM history** entry appear automatically on the fleet vehicle detail page — no extra wiring needed. Failures create rental-blocking maintenance records as today.

---

## Technical notes

**Files to change**
- `src/lib/task-types.ts` — add `routine_maintenance: "Routine Maintenance"`.
- `src/lib/runner-tasks.functions.ts` — accept optional `rmItems`, `mileage`, and `vehicleId` and persist them into `details` (e.g. `details.rm = { vehicleId, mileage, items: [{type, customId, label, due}] }`).
- `src/lib/runner-tasks-admin.functions.ts` — add `approveRmTask` and `rejectRmTask` (or extend reviewed fn): admin check, read `details.rm`, map `checklist_results` (Pass/Fail/notes) → `RmItemInput[]`, call `applyRmSubmission`, set `status` to `approved`/`rejected`, stamp `reviewed_at/reviewed_by`, guard against re-apply. Add an `approveRmTaskOverride` variant accepting edited items.
- `src/lib/rm-cards.server.ts` — reuse `applyRmSubmission` as-is (no change expected).
- `src/routes/admin.create-task.tsx` — add "Routine Maintenance" template; when selected + vehicle chosen, build checklist from `computeScheduledItems(vehicle)` and pass `rmItems` to the server fn.
- `src/routes/runner-task.$token.tsx` — render Pass/Fail status set for `routine_maintenance` tasks; map to the `checklist_results` status strings the approval mapper expects.
- `src/routes/runner-tasks-public.functions.ts` — pass through task type so the page knows to use the RM status set (read-only; no apply here).
- `src/routes/admin.tasks.tsx` — Approve / Reject / Administrative Override buttons + override editor for RM tasks; show a "Maintenance applied" badge.
- `src/routes/fleet.tsx` — "Send RM to Runner" button opening the pre-filled task form (reuse runner name/phone capture from `RmCardDialog`).

**Status vocabulary**: extend the live `runner_tasks.status` values with `approved` and `rejected` (the column is free-text; no migration strictly required). Optional small migration to add `rm_applied_at timestamptz` for a clean audit trail — recommended but not blocking.

**Mapping**: runner item status `Pass` → `RmItemInput.status = "Pass"`, `Fail` → `"Fail"`; item `type`/`customId` come from `details.rm.items` matched by label/index.
