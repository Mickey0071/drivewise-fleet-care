# Roadmap

- [x] Standardize every fleet-vehicle selector to uppercase `MAKE MODEL · YEAR · PLATE`, sorted by type then year.
- [x] Add secure agency waitlist intake endpoint with validation, deduplication, vetting, messaging, and retry protection.
- [x] Extend waitlist records for tier, source, campaign, intake answers, normalized phone, and message timestamps.
- [x] Update public and manual waitlist sources.
- [x] Add admin tier/source filters, compact vetting answers, promotion action, ordering, and monthly statistics.
- [ ] Store the agency-provided `WAITLIST_INTAKE_KEY` securely.
- [x] Verify endpoint security, admin workflow, vehicle selectors, and build; live messaging awaits the agency key.
- [x] Exclude EZPass, toll, and violation records from repair history and vehicle/company expense totals.
