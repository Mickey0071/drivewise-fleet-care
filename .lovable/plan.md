## Goal

On the Fleet vehicle detail page (and Maintenance log), break every repair down into itemized **Parts** and **Labor** so you can see, for each repair, exactly which part was used, where it came from, when, and who did the work.

## The gap today

The `Maintenance` record only stores rolled-up totals — `partsCost`, `laborCost`, a single `vendor` string, and (optionally) `mechanicName`. There is no list of individual parts, no supplier per part, and labor is one number. That's why the fuel gauge repair on the Altima shows a total but no breakdown.

## What I'll build

### 1. Extend the repair data model (`src/lib/mock/data.ts`)

Add two optional fields to `Maintenance`:

- `partsBreakdown?: { id, name, supplier?, cost, purchaseDate?, notes? }[]`
- `laborBreakdown?: { id, mechanicName, cost, workDate?, hours?, notes? }[]`

Existing `partsCost` / `laborCost` stay as the roll-up (auto-summed from the breakdown when present).

### 2. Repair History card (Fleet › vehicle › Repair History)

Each repair card expands to show two sub-sections:

```text
Fuel gauge repair              $340
Nov 12, 2025 · Joe's Auto
─────────────────────────────────
Parts                          $180
  • Fuel gauge sender  — AutoZone   $120   Nov 10
  • Wiring harness clip — Amazon     $60   Nov 10
Labor                          $160
  • Mike R.            2 hrs        $160   Nov 12
```

Falls back gracefully to today's single-line summary when a repair has no breakdown yet.

### 3. Expenses tab (Fleet › vehicle › Expenses)

Repair-sourced rows split into two lines — one `Parts` row and one `Labor` row — each with vendor/mechanic in the subtitle, so the category pills at the top correctly show "Parts: $X · Labor: $Y" instead of one lumped "Repair" bucket.

### 4. Maintenance page detail dialog (`CompletedRepairDetailDialog`)

Same Parts / Labor itemized breakdown appears inside "View Details" so techs and admins see the same structure from either entry point.

### 5. Editing

- The existing "Add expense" / repair-completion forms get Parts and Labor line-item editors (add row → part name, supplier, cost, date; mechanic, cost, date). Users can add multiple parts or multiple labor entries per repair.
- Old repairs without a breakdown remain viewable; you can edit them to add itemized data retroactively.

## Out of scope

- I won't touch the P&L totals math — the sum stays identical; only the presentation splits.
- No supplier/parts-catalog table; supplier is free text on each part row (matches how `vendor` works today). Say the word if you want a proper suppliers list later.

## One clarifying question

Where should the itemized breakdown be entered — on the **repair completion form** in the Maintenance module (mechanic/admin fills it when marking complete), or as a separate **"Edit breakdown"** action on the Repair History card, or **both**?