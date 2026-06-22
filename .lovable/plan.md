## Problem
On the reservation card, the **"All Payments"** tab does not show extension or violation payments — only base rental payments. Extension and violation rows are built correctly, but the "all" view filters them out.

## Root cause
`src/components/app/ReservationPaymentHistory.tsx`, line 117:
```js
const visible = filter === "all"
  ? rows.filter((r) => r.type === "rental")   // ← bug: "all" only keeps rentals
  : rows.filter((r) => r.type === filter);
```
The "all" branch restricts to `type === "rental"` instead of returning every row.

## Fix
Change the "all" branch to return all rows (rental + extension + violation), keeping the type-specific branches unchanged:
```js
const visible = filter === "all" ? rows : rows.filter((r) => r.type === filter);
```

## Result
- "All Payments" shows every payment: base rental, extensions, and violations.
- The "Total paid (all)" footer then reflects all paid rows combined.
- Individual filter tabs (Rental / Violations / Extensions) keep working exactly as before.

Scope: one-line presentation fix in the reservation payment-history component. No data, billing-engine, or backend changes.