
- Export branding: all .xlsx/.pdf reports use src/lib/branding.ts (logo from src/assets/camauto-logo-base64.ts, colors, company block) via branded-xlsx.ts / branded-pdf.ts; CSV stays raw. Why: one source so report styling never drifts.
