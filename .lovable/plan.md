## Goal
On the Fleet vehicle detail page, in the **Renter History** tab, make each renter expandable so clicking them reveals every reservation they have had on that vehicle, with a **Download Report** button per reservation that exports a full-detail PDF.

## Background
The application already has a complete rental-report PDF pipeline:
- `src/lib/rental-report.functions.ts` → `exportRentalReportPdf(rentalId)` gathers rental, vehicle, driver, payments, extensions, violations, inspections, charges, and images from Supabase and returns a base64 PDF.
- `src/components/pdf/RentalReportPDF.tsx` renders a professional branded PDF with all sections.

This plan reuses that existing infrastructure with zero backend changes.

## What will change

### 1. UI — Renter History tab (`src/routes/fleet.$vehicleId.tsx`)
Replace the current flat list of `uniqueRenters` (which links away to `/drivers`) with an **expandable card per renter**.

- **Collapsed state:** show renter name, rental count, first start date, total paid (same data as today).
- **Expanded state:** show a compact table of that renter’s reservations for this vehicle:
  - Reservation ID
  - Start date → End date (or "open")
  - Rate / billing period
  - Payment status
  - **Download Report** button

- The existing flat "Rental history" section can be removed or replaced since the grouped view covers it.

### 2. PDF download wiring
- Import `exportRentalReportPdf` from `@/lib/rental-report.functions.ts`.
- Use `useServerFn(exportRentalReportPdf)` in the Fleet vehicle component.
- On button click: call with `{ rentalId: <reservation.id> }`.
- On response: decode `base64`, create a Blob (`application/pdf`), and trigger a download with the provided `filename`.
- On error (e.g. rental not found in Supabase): show a `toast.error` stating the report is only available for cloud-synced reservations.

## Technical details

### Component changes
- `src/routes/fleet.$vehicleId.tsx`
  - Add `useState` to track which renter is expanded.
  - Add `useServerFn` call for `exportRentalReportPdf`.
  - Replace the `uniqueRenters` map and the flat "Rental history" section inside `TabsContent value="renters"`.

### No schema / server changes
- The `exportRentalReportPdf` server function already queries:
  - `rentals`, `vehicles`, `drivers`, `payments`, `violations`, `inspections`, `rental_extensions`, `rental_charges`
  - and already embeds license/selfie/signature images.
- It already requires admin auth and returns `{ filename, mime, base64 }`.

## Acceptance criteria
1. On `/fleet/<vehicleId>?tab=renters`, each renter appears as a clickable row.
2. Clicking a renter expands inline to show all their reservations for that vehicle.
3. Each reservation has a **Download Report** button.
4. Clicking it downloads a PDF named like `R-123_John_Doe_report.pdf`.
5. The PDF contains: Renter info, Vehicle info, Rental period, Extensions, Inspections, Violations, Payments, Charges, Totals, and embedded images.
6. No other tabs or pages are affected.
7. If a reservation is not in Supabase, the button shows a clear error instead of crashing.