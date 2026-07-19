---
name: Violations packet address & signature
description: Never generate or send a violations/transfer packet whose agreement lacks the renter's address or signature — prompt admin to fill it in
type: constraint
---
Never generate or send a violations dispute packet OR a Transfer of Responsibility packet if the agreement does not have the renter's address on it or is missing the renter's signature. When either is missing, block generation and prompt the admin to either enter the address (persist it back to the driver/legacy_rental) or acknowledge/override the missing signature before proceeding. Always ask which documents to include in the packet before generating — never silently auto-generate. **Why:** Toll authorities reject dispute packets whose rental agreement is missing an address or signature.