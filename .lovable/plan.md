## Context

"Ford Tester" reservation **R-586** shows an **$8 credit**. This is mathematically correct, not a bug:

- The canonical balance engine charges only for **time the car has actually been out**: `owed = time charge + prior balance − payments received − discounts`.
- R-586 (daily, $1/day, started 6/21): only ~$2 has posted so far (first 2 days deposit-covered, then $1/day).
- Payments received = **$10** ($2 base + an **$8 extension** prepaid via Stripe 6/22).
- `$2 − $10 = −$8` → displayed as an **$8 credit**.

The renter prepaid an extension for days that haven't elapsed yet. As days accrue, the time charge climbs and the credit naturally burns down to $0. The formula is working as designed.

## Decision

Leave the balance engine and all numbers exactly as they are. Make a **presentation-only** clarification so a negative balance reads as prepaid money rather than a mystery "credit."

## Change (display only)

- Where a rental's balance renders as a credit (negative owed), label it **"Prepaid credit"** with a short helper note: "Payment received ahead of charges — applies automatically as time accrues."
- No change to `rentalCanonicalOwed`, `rentalTimeCharge`, payments, extensions, the webhook, the portal, or any aggregation. Pure labeling/tooltip on the existing displayed value.

## Out of scope

Balance engine math, extension logic, payment recording, the portal, the P&L/Monthly reports, and the "Send Portal Link" flow all stay unchanged.
