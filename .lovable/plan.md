## Monthly Vehicle Reports

A new tab that produces a per-vehicle monthly statement you can hand to joint-venture partners: for a chosen month, each vehicle shows its income, who rented it, expenses, and the net.

### What it shows

For a selected month (defaulting to the current month), one card/section per vehicle containing:

- **Header**: Year Make Model + plate.
- **Income**: total of all payments marked paid whose paid date falls in the month, attributed to the vehicle via the rental. Broken out by rental vs extension where available.
- **Renters**: each driver who had this vehicle on rent during the month — name, rental dates, and amount paid that month.
- **Expenses**: vehicle-tagged expenses (date, category, vendor, amount) plus maintenance/repair costs for the vehicle in that month.
- **Net for month**: income − expenses.

A top summary strip shows fleet totals (total income, total expenses, net) for the month.

### Filters & export

- Month picker (and a free range is out of scope — month granularity as requested).
- **Print / PDF** button (uses the existing print-to-PDF flow) so you can save/send a clean printout.
- **Export CSV** button (one row per vehicle with income/expense/net columns, matching the other reports).

### Layout

```text
Monthly Vehicle Reports        [Month ▼]  [Export CSV] [Print/PDF]
-----------------------------------------------------------------
Fleet totals: Income $X | Expenses $Y | Net $Z
-----------------------------------------------------------------
2021 Toyota Camry · ABC1234
  Income .......... $1,400   (rental $1,200, extensions $200)
  Renters: John Doe (Jun 1–Jun 21) — $1,400
  Expenses ........ $320     (oil change $80, tires $240)
  Net ............. $1,080
-----------------------------------------------------------------
... next vehicle ...
```

Vehicles with no activity in the month are hidden by default (with a toggle to show all).

### Technical details

- New route file `src/routes/monthly-vehicle-reports.tsx` (URL `/monthly-vehicle-reports`), with `head()` title metadata, mirroring the structure of `src/routes/pnl.tsx`.
- Data comes from the existing in-memory store (`@/lib/mock/data`: `vehicles`, `rentals`, `payments`, `drivers`, `expenses`, `maintenance`, plus `vehicleById`, `driverById`, `fmtMoney`, `fmtDate`) — same source the P&L and Expenses pages already use. Pure presentation/computation, no backend changes.
  - Income: `payments.filter(status === "paid")` grouped by month of `paidDate ?? dueDate`, joined to vehicle through `rentals[rentalId].vehicleId`. Extension portions identified the same way `pnl.tsx` does (via `rental.extensions[].paymentId`).
  - Renters: rentals whose active window overlaps the month, grouped per vehicle.
  - Expenses: `expenses.filter(e => e.vehicleId === v.id && month matches)` + maintenance records for the vehicle with a completion/cost date in the month.
- Reuse `ReportActions` (`src/components/app/ReportActions.tsx`) for the CSV + Print/PDF buttons; use `PageHeader` for the title bar; wrap in cards consistent with existing pages.
- Add a sidebar entry in the Finance group of `src/components/app/AppSidebar.tsx`: `{ title: "Monthly Vehicle Reports", url: "/monthly-vehicle-reports", icon: <a finance/report icon>, roles: ["admin"] }`. Optionally add it to `GlobalSearch.tsx`.

No database, schema, or server-function changes are required.