# Accidents tab

A new **Accidents** page in the sidebar that tracks each accident claim using your checklist, linked to a reservation (and through it the vehicle and renter).

## What you'll see

**Accidents list**
- One card per accident: date, car, renter, insurance company, claim #, progress (e.g. 4/7 done), amount paid.
- Filters: Open / Closed / All, search by plate, renter or claim #.
- "New Accident" button.

**New / edit accident** (matches your spreadsheet header)
- Date of accident
- Link to reservation (search by renter, plate or reservation ID) — fills in Car and Renter automatically. Can also pick just a vehicle if there's no reservation.
- Insurance company, Insurance phone, Policy #, Claim #
- Other driver (name, phone, insurance, plate)
- If the renter already filled the online accident report for that reservation, it's shown and pre-fills these fields.

**Checklist** — the 7 items from your file, each with: Completed checkbox, Docs (upload files/photos), Notes, Paid (amount):
1. Incident Report
2. Police Report
3. Photos of Damages
4. Repair estimate
5. Actual Cash Value
6. Rentalprise Loss of Use demand letter
7. Rentalprise Proof of Income Loss

Plus a general Notes box and a total paid. Paid amounts count as Other Income for the vehicle (category "Insurance claim") so P&L stays correct.

**Links elsewhere**
- Reservation and vehicle pages show an "Accidents" section linking to the claim.
- Print / download the checklist as a branded PDF.

## Technical details
- New tables `accidents` (rental_id, vehicle_id, driver_id, dates, insurer fields, other driver, status, notes) and `accident_checklist_items` (accident_id, key, completed, notes, paid_amount, doc paths); admin/VA RLS + grants.
- Docs in a private storage bucket, signed on demand.
- Route `src/routes/accidents.tsx`, sidebar entry; server functions in `src/lib/accidents.functions.ts`; reuses `rentals.accident_report` for pre-fill; PDF via `branded-pdf.ts`.
- Paid totals written to existing `vehicle_income` with an "Insurance claim" category.
