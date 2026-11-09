# Roadmap

- [x] Rent-to-own: no-signup signature link, blue Reservations section beside Pending and active On Rent entries, live payment checklist printing. Actual unsigned customer link and saved $1,500 payment checked without sending/signing; nine rule tests pass.

- [x] Repair close-out: permanent close button, preserve unpaid balances and ticket costs, wait for save/read-back, and check existing expenses/history. Four rule tests pass; real $950 confirmation checked on desktop/mobile without closing the customer's ticket.

- [x] Agreement signing: reuse approved recent renter documents, retain new signature/payment, and verify eligibility rules (15 tests; real agreement page checked without submitting).

- [x] Standardize every fleet-vehicle selector to uppercase `MAKE MODEL · YEAR · PLATE`, sorted by type then year.
- [x] Add secure agency waitlist intake endpoint with validation, deduplication, vetting, messaging, and retry protection.
- [x] Extend waitlist records for tier, source, campaign, intake answers, normalized phone, and message timestamps.
- [x] Update public and manual waitlist sources.
- [x] Add admin tier/source filters, compact vetting answers, promotion action, ordering, and monthly statistics.
- [ ] Store the agency-provided `WAITLIST_INTAKE_KEY` securely (waiting on agency).
- [x] Verify endpoint security, admin workflow, vehicle selectors, and build; live messaging awaits the agency key.
- [x] Exclude EZPass, toll, and violation records from repair history and vehicle/company expense totals.
- [x] Separate vehicle Expenses list into Parts, Labor, and Other sections.
- [x] Violation agreements: signature date equals rental start date.
- [ ] Accidents tab: claim checklist (7 items from spreadsheet) linked to reservation/vehicle — database ready, page in progress.
- [x] Analytics: Average Expense tab (per vehicle per month) + tile on each vehicle.
- [x] Receipts tab: reservation-based and manual receipts, NJ 6.625% sales tax, printable.
