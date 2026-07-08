## Goal

On the fleet vehicle detail page, show every **completed task** for that vehicle as a timeline of events — each with the task title/type, who completed it, and a full date + timestamp.

## What exists today

- `runner_tasks` already has a `vehicle_id` column and a `completed_at` timestamp.
- Completed tasks are marked with `status = 'complete'` (and `approved` for routine-maintenance tasks after admin review).
- The vehicle detail page (`src/routes/fleet.$vehicleId.tsx`) is a tabbed card: Overview, Maintenance, Expenses, Repair History, RM History, Renter History, Violations & Inspections, Notes.
- Admin task functions live in `src/lib/runner-tasks-admin.functions.ts`.

## Plan

### 1. New read function (`src/lib/runner-tasks-admin.functions.ts`)
Add `listCompletedTasksForVehicle({ vehicleId })` — an authenticated server function that returns completed tasks for one vehicle, newest first. For each task it returns: task title, task type (human label), runner name/phone, location, completed timestamp, submitted timestamp, runner notes, and photo count. Filter: `vehicle_id = vehicleId AND status IN ('complete','approved')` ordered by `completed_at` (fallback `submitted_at`) descending.

### 2. New "Completed Tasks" section in the vehicle card (`src/routes/fleet.$vehicleId.tsx`)
Add a new tab **Tasks** to the existing tab strip (no changes to other tabs). Its content is a vertical event list, each row showing:

```text
● Mechanic Maintenance — completed
  Jul 8, 2026 · 3:42 PM · by Mike R.
  "Replaced front brake pads" (notes, if any) · 4 photos
```

- Uses the task-type label helper (`taskTypeLabel` from `src/lib/task-types.ts`).
- Empty state: "No completed tasks for this vehicle yet."
- Data fetched with `useServerFn` + `useQuery`, matching the page's existing live-data pattern.

### Explicitly not changing
- Task creation flow, runner workflow, and the existing Runner Tasks admin page stay as-is.
- Other vehicle-detail tabs, filters, and layout are untouched.
- No schema changes (all needed columns already exist).

## Technical notes
- Event date/time rendered with `toLocaleString("en-US")` for a full date + timestamp.
- Function guarded by `requireSupabaseAuth` (bearer already wired in `src/start.ts`), consistent with sibling task functions.
