# Separate Parts and Labor expenses

## Change
- In the vehicle’s Repair History tab, replace the mixed Expenses list shown in your screenshot with three clearly separated sections: **Parts**, **Labor**, and **Other Expenses**.
- Keep each existing expense row in exactly one section, including zero-dollar entries. Keep its description, date, vendor, amount, and source visible.
- Show the number of entries beside each section heading. Omit empty sections; retain the existing empty message when there are no expenses.

## Keep unchanged
- Repair history cards and their View buttons.
- All saved records, expense amounts, financial totals, P&L, and ROI.
- The separate Expenses tab, reports, and downloads.

## Technical details
- Update only the mixed expense-list presentation in `src/routes/fleet.$vehicleId.tsx`.
- Partition its existing `otherExpenses` list by the expense category: case-insensitive Parts, Labor, and everything else. Do not group by repair name, combine amounts, or change financial calculations.

## Verify
- Check a vehicle with both Parts and Labor entries: each appears once under its corresponding heading, with its original amount.
- Confirm other expenses remain visible and the layout fits phone and desktop screens.