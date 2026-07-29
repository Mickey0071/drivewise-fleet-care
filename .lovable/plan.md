# Historic Reservation Entry — Plan

Adds a manual entry point for past rentals (Fleet Finesse era, cash deals, etc.) that produces a **real row in the `rentals` table** — fully searchable, linkable to violations, and visible in vehicle Renter History alongside live and legacy rentals.

## What gets built

### 1. Database migration (one small additive change)
`rentals.import_source` already exists. Add a **`source`** text column (nullable) so we can tag rows as `historic_entry` without hijacking `import_source` (which is used by the CSV importer). Index on `(source, start_date desc)` for the Returned tab.

### 2. New server function `src/lib/historic-rental.functions.ts`
`createHistoricRental` — one server fn, called from two places (standalone page + Violations "Create New Rental").

Input fields (matches your spec):
- Customer: full name, phone, email, address, DL #, DL state, DOB
- Vehicle: `vehicleId` (from fleet dropdown) OR manual `plateOverride`
- Rental: startDate, endDate, rateType (`daily`/`weekly`), rate, totalAmount
- Payment: amountPaid, method (`cash`/`card`/`check`/`other`), paymentNotes
- Uploads: `licenseImageDataUrl?`, `agreementFileDataUrl?` (PDF or image), `noAgreementAvailable: boolean`
- Optional: `notes`, `violationId?` (for auto-link)

Logic:
1. **Driver dedupe** — normalize name + phone, `select from drivers where lower(full_name)=? and phone_digits=?`. Reuse or insert.
2. **Upload license photo** (if provided) to `driver-licenses/{driverId}/license-{ts}.{ext}` (existing bucket), save signed URL to `drivers.license_image_url`.
3. **Upload agreement** (if provided) to `legacy-agreements/historic/{rentalId}/agreement-{ts}.{ext}` (existing bucket), save signed URL to `rentals.agreement_pdf_url`, set `client_signed_at = start_date` so it shows as "signed".
4. **Insert rental** into `rentals` with:
   - `id = 'HR-' + short random`
   - `source = 'historic_entry'`
   - `status = 'returned'`, `returned_at = end_date`
   - `payment_status = 'paid'` if amountPaid >= totalAmount else `'partial'`
   - rate/weekly_rate populated based on toggle
5. **Insert payment row** if amountPaid > 0 (to `payments` table so financials engine picks it up) — with method + notes.
6. **Auto-link violation** — if `violationId` provided, update `violations.rental_id` and `driver_id`, and log status history entry.

### 3. New route `src/routes/admin.historic-reservation.tsx`
Standalone page with the form. Accepts optional search params `?violationId=X&plate=Y&date=Z` for prefill from Violations. Vehicle dropdown loaded from existing fleet server fn. Live "total" calculator (days × daily rate, or weeks × weekly rate). On success, offers "Link to a violation?" button (if not already prefilled).

### 4. Rentals list badge
Update `src/routes/rentals.tsx` where the rental card renders a source/status pill: add a **"Historic"** badge (amber, small pill) when `source === 'historic_entry'`, and a **"Migration"** badge when `import_source === 'legacy_csv'` (or similar) — keeping the existing "Live" default clean.

### 5. Vehicle Renter History tab
Locate the vehicle-detail Renter History rendering and add the same badge inline next to customer name/date row.

### 6. Violations "Create New Rental" wiring
In `ManualMatchDialog` (or wherever the button lives), the button navigates to `/admin/historic-reservation?violationId={id}&plate={p}&date={d}` instead of the current inline dialog. The historic page detects the query params, prefills, and auto-links on save.

### 7. Sidebar shortcut
Add "Historic Reservation" nav item under Admin so the page is reachable.

## Files touched

- `src/lib/historic-rental.functions.ts` — **new**
- `src/routes/admin.historic-reservation.tsx` — **new**
- Migration: `add source column + index on rentals`
- `src/routes/rentals.tsx` — badge in rental card
- Vehicle detail Renter History component (need to locate exact file) — badge
- `src/components/app/ManualMatchDialog.tsx` (or wherever) — button routes to new page with prefill
- `src/routes/__root.tsx` or nav config — sidebar entry
- `src/components/app/StatusBadge.tsx` — add `historic` tone

## Deliberately reusing

- Existing `driver-licenses` and `legacy-agreements` storage buckets — no new buckets needed.
- Existing `FindRenterDialog` searches by joining `rentals + drivers`; since historic rentals ARE rentals rows, they'll show up automatically with zero changes there.
- Existing `getVehicleFinancials` will count historic payments once inserted into `payments`.

## What I'm NOT doing (unless you say so)

- Generating a fresh PDF from historic-entry form data (you upload the paper agreement instead). If you want auto-PDF-generation for cases with no upload, I can add a "Generate placeholder agreement" toggle.
- Reworking `legacy_rentals` — those stay as-is for the retro-signing / migrated-reservation flows.

Approve and I'll build.
