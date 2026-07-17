## Goal

Fix the empty "Runner" dropdown on the **Return Vehicle → Send for Inspection** flow, let you add and save a runner's name and phone right there, SMS them the inspection link, and add an oil-change item to the checklist.

## Answering "have you added a mechanic runner checklist?"

**No.** The only checklist that exists is the vehicle inspection checklist in `src/lib/checklist-items.ts` (Before Starting / Exterior / Interior / Test Drive) used by the runner post-return inspection. There's no separate mechanic-runner checklist yet. I can add one in a follow-up if you want — say the word and I'll draft sections (e.g. Fluids, Belts/Hoses, Brakes, Suspension, Under-Body, Diagnostics/OBD) tied to a `mechanic` task type. Not included in this plan since you didn't ask for it explicitly.

## Why the dropdown is empty

`ReturnVehicleDialog` currently pulls runners from `user_roles` (role = `runner`) joined to `profiles`. You have no users with that role, so the list is empty. Meanwhile the app already has a **saved runners table** (`runners` — name + phone, used by "Send RM Task") with `listRunners` / `saveRunner` server fns. We'll switch this dialog to use that same source so the runner you already saved in one place shows up everywhere.

## Behavior

### Return Vehicle → Send for Inspection
- Runner select now lists rows from the `runners` table (alphabetical, name + last-4 of phone).
- Below the select: **"+ Add new runner"** toggle reveals two inputs (Name, Phone with `(xxx) xxx-xxxx` mask) and a **Save** button. Save calls `saveRunner` (upserts by phone), refreshes the list, auto-selects the new runner. Same UX as elsewhere in the app.
- **"Create Inspection & Return"** now sends the inspection link to the selected runner's phone via SMS. Vehicle → `inspection` status, rental → `returned`, runner_task created (with `runner_id = null`, name/phone stored in `details`).

### Inspection checklist
- Add an **Oil change** row to the "Before Starting Car" section in `src/lib/checklist-items.ts`:
  - `{ key: 'oil_change_due', label: 'Oil change — check sticker / mileage, flag if due' }`
- The existing `oil_level` row stays.

## Implementation

### 1. `src/lib/tasks.functions.ts` — `createReturnInspection`
Change input from `{ runnerId }` to `{ runnerName, runnerPhone }`. Validate both (name 1–120 chars, phone digits ≥ 10). Insert `runner_tasks` with `runner_id: null` and `details.runner_name` / `details.runner_phone` alongside the existing fields. SMS uses the provided phone. Everything else (rental → returned, vehicle → inspection, return URL) unchanged.

### 2. `src/components/app/ReturnVehicleDialog.tsx`
- Replace the `user_roles`+`profiles` fetch with `useServerFn(listRunners)` on mount.
- State: `runnerId` → `selectedRunnerId` (row id from `runners` table), plus `adding`, `newName`, `newPhone`, `savingNew`.
- Inline "+ Add new runner" block with Name/Phone inputs + Save button calling `useServerFn(saveRunner)`; on success prepend to list and select.
- `sendForInspection`: look up name+phone from selected row, pass `{ runnerName, runnerPhone }` to `createReturnInspection`. Existing toast + refresh flow unchanged.
- Fall back to "No saved runners yet — add one below" when the list is empty.

### 3. `src/lib/checklist-items.ts`
Append the new `oil_change_due` item to the **Before Starting Car** section.

## Non-goals
- No changes to `startReturnInspection` (public inspection link), `SendRmTaskDialog`, other dialogs, or any other route.
- No new mechanic-runner checklist in this plan (answered above).
- No schema migration — `runner_tasks.runner_id` is already nullable.

## Verification
1. Open Rentals → Return a vehicle → Send for Inspection: dropdown now lists saved runners (from the same list as the RM task flow).
2. Click **+ Add new runner**, enter a name and phone, Save → it appears selected in the dropdown and the row is persisted so it appears next time.
3. Click **Create Inspection & Return** → toast "Inspection sent to <name> by SMS", rental returns, vehicle is in `inspection`.
4. Open the runner's SMS link → checklist loads with the new **"Oil change"** row inside "Before Starting Car".
