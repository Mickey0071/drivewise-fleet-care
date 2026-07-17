## Add Mechanic assignee to Create-Task + saved mechanic list

Scope is large but most infrastructure already exists — `mechanic_jobs`, `sendMechanicJob` SMS, `/mechanic-job/$token` submit flow, `repair_history`, and the Repair History tab on the vehicle detail page. This plan wires Create-Task into that pipeline and fills the small gaps.

### 1. Saved mechanics table (new)
Migration `mechanics` table + `vehicle_preferred_mechanic_id` on `vehicles`:
```
mechanics(id uuid pk, name text, phone text, shop text, is_active bool, created_at, updated_at)
```
GRANT to authenticated + service_role, RLS: any authenticated user can read/write (matches `runners` table pattern).

New server fns in `src/lib/mechanics.functions.ts`: `listMechanics`, `saveMechanic`, `deleteMechanic`, `setPreferredMechanic(vehicleId, mechanicId)`.

### 2. `/admin/mechanics` route (new)
Simple management screen mirroring the runner list UX: table + inline add form (Name / Phone / Shop / Active). Add link in admin nav.

### 3. Create-Task page — add Mechanic tab
`src/routes/admin.create-task.tsx` gets a top-level `[Runner] [Mechanic]` toggle. When Mechanic is active, show a new form:

- **Vehicle**: fleet dropdown (pre-fills from `?vehicleId=` query param)
- **Mechanic**: dropdown of `listMechanics()` results + "+ Add new mechanic" inline (Name/Phone/Shop, persisted via `saveMechanic`)
- **Checklist** (16 pre-built items shown in the request) as checkboxes + `[+ Add custom item]` free-text row
- **Urgency**: radio Normal/Urgent/ASAP
- **Notes to mechanic**: textarea
- **Swap vehicle** toggle: if the vehicle has an active rental, show current renter name and a dropdown to pick a replacement `available` vehicle. On send, updates that rental's `vehicle_id` (writes a note in rental history).
- Submit calls existing `createMechanicJob` with `checklistItems` = selected items, `issueDescription` = urgency + checklist summary, `additionalContext` = notes.

Urgency prefix is prepended to the SMS body (`🚨 URGENT: …` / `🚨🚨 ASAP: …`) — smallest possible change to `mechanic-jobs.functions.ts`: accept optional `urgency` in `createMechanicJob` input and inline into the SMS message.

### 4. `/mechanic-job/$token` — verify + minor polish
Already renders checklist as Pass/Fail/N/A per item with notes, plus parts (name/qty/price/labor) and labour cost, and calls `submitMechanicJob`. Confirmed adequate for the checklist workflow — no changes needed unless the audit surfaces a gap.

### 5. Approve → repair_history + expenses (verify + fill gap)
On mechanic submission, `submitMechanicJob` already writes `parts_cost` / `labor_cost` / `parts_list` back to the linked `maintenance` row and SMSes admin an Accept/Decline link. The existing `/repair/accept/$token` handler (`repair-actions.functions.ts`) is what creates `repair_history` and the auto-posted expense on completion.

Gap: on **Accept**, the current flow doesn't complete the maintenance row automatically — verify and, if needed, add a "Complete + post to repair history" step so approval creates the `repair_history` row and expense row in one action (matching the existing pattern in `repairs.tsx`).

### 6. Repair History tab on vehicle
Already exists on `fleet.$vehicleId.tsx` and pulls from `repair_history`. No changes.

### Files to touch
- **New**: `supabase/migrations/<new>.sql` (mechanics table + vehicle FK), `src/lib/mechanics.functions.ts`, `src/routes/admin.mechanics.tsx`
- **Edit**: `src/routes/admin.create-task.tsx` (add Mechanic tab + form), `src/lib/mechanic-jobs.functions.ts` (accept `urgency`), possibly `src/lib/repair-actions.functions.ts` (auto-complete on accept)
- **Verify only**: `src/routes/mechanic-job.$token.tsx`, `src/routes/fleet.$vehicleId.tsx` (Repair History tab), `src/routes/repairs.tsx` (mechanic jobs tab already lists submissions)

### Out of scope (say the word to add later)
- Automatic maintenance-schedule reset per-item (needs a mapping table of checklist item → recurring service). Currently we complete the maintenance ticket; per-item recurrence reset can be a follow-up.
- Fleet card totals: already derived from `repair_history` + expenses, so they update automatically once the repair row is written.

### Order of operations
1. Migration for `mechanics` table (needs approval)
2. `mechanics.functions.ts` + `admin.mechanics.tsx`
3. Create-Task Mechanic tab + wire `createMechanicJob` with urgency
4. Verify approve flow writes repair_history + expense; patch if not.

Ready to proceed?
