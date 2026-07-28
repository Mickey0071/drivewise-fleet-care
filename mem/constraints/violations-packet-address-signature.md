---
name: Violations packet address & signature
description: Never generate or send a violations/transfer packet whose agreement lacks the renter's address or signature — prompt admin to fill it in
type: constraint
---
Scope: applies to the **Transfer of Responsibility** packet only (not the simplified EZPass liability-transfer mail packet).

Never generate or send a Transfer of Responsibility packet if the agreement does not have the renter's address on it or is missing the renter's signature. Block generation and prompt the admin to either enter the address (persist to driver/legacy_rental) or acknowledge/override the missing signature. Always ask which documents to include before generating — never silently auto-generate.

The simplified 2-page EZPass mail packet (`generateMailPacket` → cover letter + signed rental agreement) is **exempt**: it must download even when the ref #, address, or signature is missing — the cover shows "[SEE ATTACHED NOTICE]" / blank underlines and the agreement is appended as-is (or skipped if not on file). Warnings are surfaced via the returned `missing[]` array, never as a hard block. **Why:** Admin needs to be able to print & mail immediately; toll authorities receive a valid liability-transfer notice regardless.