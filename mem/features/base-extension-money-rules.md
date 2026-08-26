---
name: Locked base amount & extension revenue rules
description: rental base_amount is immutable; extensions tracked separately; pending extensions never count in P&L income or totals
type: feature
---

Revenue tracking rules (established 2026-08-26, user-directed surgical fix):

- `rentals.base_amount` is locked at creation; a DB trigger (`rentals_lock_base_amount`) rejects any change. Never update it when extensions are added.
- Each extension is a `rental_extensions` row with `status` (pending/paid/cancelled), `paid_at`, `invoice_id`/`payment_id`. Triggers flip status to paid when the linked payment/extension_request clears.
- Pending extensions are NEVER included in: P&L income totals, "amount paid so far", or any revenue metric. They display separately (amber) as "Pending extensions".
- P&L revenue = `extensionIncomeAttribution()` in `src/lib/mock/store.ts` (single source of truth): extension-linked paid payments → Extensions bucket by paid date; everything else → Rental bucket. Pending shown per-month as a non-totaled amber sub-line.
- Never change "amount owed" / balance math (`rentalCanonicalOwed` etc. stay possession-based); only internal base/extension breakdown is locked vs. separated.
- Reservation card shows three-column breakdown: Base (locked, muted), Paid extensions (count + total), Pending extensions (amber, "Will be charged when approved").
