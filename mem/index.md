# Project Memory

## Core
Violations/transfer packets: never build without renter address AND signature on the agreement. Missing → prompt admin, don't silently generate. Always ask which docs to include.
Rental base_amount is locked forever; extensions are separate rows; pending extensions never count in income/P&L totals.

## Memories
- [Violations packet address & signature](mem://constraints/violations-packet-address-signature) — Block packet generation on missing renter address or signature; prompt admin instead
- [Locked base & extension revenue rules](mem://features/base-extension-money-rules) — base_amount immutable (DB trigger), extensions as pending/paid rows, pending excluded from all income metrics
