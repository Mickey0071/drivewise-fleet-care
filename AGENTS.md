
- Export branding: all .xlsx/.pdf reports use src/lib/branding.ts (logo from src/assets/camauto-logo-base64.ts, colors, company block) via branded-xlsx.ts / branded-pdf.ts; CSV stays raw. Why: one source so report styling never drifts.
- Additional-driver files (license, selfie, signature, addendum) are stored as private rental-signing bucket paths and signed on demand (short TTL); packet merges use src/lib/additional-drivers.server.ts. Why: IDs must never have long-lived public links.
- Rental agreement PDF renderers use a continuous vector layout and the shared one-page fitting helper; browser printing measures its compact template before print. Why: preserve full content and signatures without page breaks or clipping.
