## What you'll see

**Sidebar** gets two entries where "Maintenance/Repairs" is today:
- **Maintenance** → new `/maintenance` fleet-wide overview
- **Repairs** → `/repairs` (today's page, unchanged content)

### `/maintenance` — Fleet-wide overview

Top strip of 4 stat tiles: **Overdue** (red), **Due this week** (yellow), **All clear** (green), **Total overdue items**.

Top-right actions: **Send all overdue RMs**, **Notification settings**.

Table, one row per active vehicle:

| Vehicle | Oil Change | Tires | NJ Inspection | Battery | Brakes | Alignment | Overall |

Each cell renders one of:
- 🔴 **Overdue** (with "N days" or "N mi" over)
- 🟡 **N days** / **N mi** (within 7 days or 500 mi)
- 🟢 **OK**
- ⚪ **—** when the item isn't configured yet

Row sort: any-overdue → any-due-soon → all-clear. Click a row → `/fleet/$vehicleId` on the **Maintenance** tab.

**Send all overdue RMs** button: for every vehicle with ≥1 overdue item, dispatches a runner task ("Check overdue maintenance: Oil, Brakes…") using the existing runner-task pipeline; shows a toast with counts.

### Per-vehicle Maintenance tab (`/fleet/$vehicleId`)

Renamed from today's "Alerts/Scheduled" area to **Maintenance**. Same 4 stat tiles as the fleet page, scoped to this vehicle. Below, one **card per maintenance item**:

- Item name + status badge
- Due date · interval · last done · miles-until (when applicable)
- **[Mark Done]** and **[Send RM]** buttons
- **Add custom item** button at the bottom; existing settings dialog reused for editing intervals

**Mark Done** dialog:
- Date completed (defaults today)
- Mileage at completion (defaults vehicle mileage)
- Cost (optional)
- Completed by: Admin / Mechanic / Runner (radio) + free-text name
- Notes
- **Save** resets the item's next-due (writes `lastDate`/`lastMileage` for oil, `xxxLastDone` for battery/alternator, rolls `inspectionExpiry` forward 12 mo for NJ Inspection, resets `lastDate` for tires/brakes/alignment/custom).
- If cost > 0 → **auto-creates an expense** (`category: "Maintenance"`, vehicle-linked, vendor = completed-by), so it flows into `getVehicleFinancials` → fleet card, vehicle P&L, global P&L, Excel export.
- Also inserts a `repair_history` row so the fleet card's Repair History log shows it.

**Send RM (per item)** — creates a runner task scoped to just that item ("Check oil change on 2018 Altima").

### Default items (seeded per active vehicle if missing)

- Oil change — 3,000 mi **or** 3 months
- Tire rotation — 5,000 mi **or** 6 months
- Alignment — 6 months
- Battery test — 6 months (today it's 12 mo — will drop to 6)
- Brakes inspection — 12 months
- NJ Inspection — 12 months (uses `inspectionExpiry`)

Every item supports mileage-only / time-only / **both — whichever comes first (default)**. Admin can edit intervals per vehicle via the existing Maintenance Settings dialog, which we'll extend to cover Tires / Brakes / Alignment (currently only Oil/Battery/Alternator/Inspection + custom).

### Notifications

- **On overdue transition** (evaluated by the existing repair-digest cron, extended): SMS to admin `267-221-3977` via GHL + app notification. Same detection prevents duplicate sends.
- **Due within 7 days OR 500 miles**: app notification only, yellow badge (no SMS).
- **Weekly digest**: new cron **Monday 08:00** posts to a new `/api/public/hooks/maintenance-digest`. Message: `"Camauto maintenance: X overdue, Y due this week. View: camautorentals.lovable.app/maintenance"`.
- **Notification settings** page (`/admin/maintenance-notifications`): toggles for `overdue SMS`, `overdue app alert`, `due-soon app alert`, `weekly digest`. Persisted in the existing `notification_settings` table under new types (`maint_overdue`, `maint_due_soon`, `maint_weekly_digest`).

## Technical section

**Data model — `src/lib/mock/data.ts`:**
- Extend `ScheduledTaskKey` from `"oil" | "battery" | "alternator" | "transmission" | "safety" | "overall"` to include `"tires" | "brakes" | "alignment" | "inspection"`.
- Extend `MaintenanceSettings` with `tiresLastDone`, `tiresLastMileage`, `tiresIntervalMiles`, `tiresIntervalMonths`, `brakesLastDone`, `brakesIntervalMonths`, `alignmentLastDone`, `alignmentIntervalMonths`. These are optional — no migration blocker.

**Engine — `src/lib/maintenance-utils.ts`:**
- Extend `ScheduledType` union with `"tires" | "brakes" | "alignment"`.
- In `computeScheduledItems`, add branches for those three (mirror the oil/battery pattern; support miles + months with earliest-due wins).
- Bump `SCHEDULED_MILES_SOON` from 100 → 500 to match the "500 mi warning" requirement (or add a separate `SCHEDULED_MILES_WARN = 500` and use it for the yellow tier only). Overdue stays `< 0`.
- New helper `groupItemsByVehicle(vehicles)` used by the fleet table.

**Seeding:**
- New helper `ensureDefaultMaintenance(vehicle)` in `src/lib/mock/store.ts` — called on vehicle create + a one-time backfill from the fleet page load — that fills in default intervals when a field is missing. Never overwrites user-set values.

**Store — `src/lib/mock/store.ts`:**
- New `markMaintenanceItemDone({ vehicleId, type|customId, date, mileage, cost, completedBy, notes })`:
  - Updates the right `maintenanceSettings` field(s).
  - If cost > 0, calls existing `addExpense({ category: "Maintenance", … })`.
  - Inserts `repair_history` row for the vehicle audit trail.
  - Emits store change.
- New `sendMaintenanceRM(vehicleId, item)` and `sendAllOverdueRMs()` — thin wrappers over the existing runner-task creator.

**Routes / UI:**
- **New** `src/routes/maintenance.tsx` → the fleet overview (this replaces today's file; today's content moves to a new `src/routes/repairs.tsx` unchanged apart from route id and title).
- **New** `src/routes/admin.maintenance-notifications.tsx` — toggles wired to `listNotificationSettings` / `updateNotificationSetting` (already exist in `src/lib/notifications.functions.ts`).
- **New** `src/components/app/MarkMaintenanceDoneDialog.tsx`.
- **New** `src/components/app/VehicleMaintenanceTab.tsx` (or extend the existing tab component on `fleet.$vehicleId.tsx`) rendering the per-item cards.
- Extend `MaintenanceSettingsDialog.tsx` with Tires/Brakes/Alignment task rows using the same `TASK_DEFS` pattern.
- Sidebar (`AppSidebar.tsx`): change the single "Maintenance/Repairs" entry into two entries; both use `Wrench`.

**Cron / notifications:**
- Extend `src/routes/api/public/hooks/repair-digest.ts` (or add `maintenance-digest.ts`) to compute newly-overdue items vs. a "last-notified" flag stored on `MaintenanceSettings` (per-item `lastNotifiedOverdueAt`) so we don't re-SMS every hour.
- Add a `pg_cron` schedule `0 12 * * 1` (Mon 08:00 America/New_York ≈ 12:00 UTC) hitting `/api/public/hooks/maintenance-digest`.

**P&L wiring:** already automatic — `getVehicleFinancials` in `src/lib/vehicle-financials.ts` reads from `expenses`, and `addExpense` with `category: "Maintenance"` posts there. No changes needed to fleet card / P&L / Excel export.

## Open decision

The 500-mile warning threshold: apply to **all** items with a mileage interval (oil + tires as configured), or only to oil-change? Default I'll implement: **all mileage-based items** (matches "within 7 days OR 500 miles" as written). Say the word if you want it oil-only.