# Plan: Server-side PDF rental agreement (Step 1 of 2)

## Scope
Generate a PDF of the signed rental agreement on the server at signature time, store it in Supabase Storage, save the URL on the rental, and SMS the link to the renter. Initial signature only — extension regeneration is the next prompt.

## Pre-flight risks to flag before I build

1. **`@react-pdf/renderer` on Cloudflare Workers (SSR runtime).** Server functions run in workerd with `nodejs_compat`. `@react-pdf/renderer` is pure JS (good) but pulls in `fontkit` / `restructure` / `pdfkit`-style modules that historically touch `fs` for default font loading and use `Buffer` heavily. It generally works on edge for basic Helvetica/Times (built-in PDF fonts, no `fs` font load), but registering custom TTFs reliably needs explicit `Font.register({ src: <URL or ArrayBuffer> })` — never a filesystem path. Plan uses only built-in PDF fonts (Helvetica family) to avoid this. If it still fails at runtime, fallback is `pdf-lib` (definitely edge-safe; means rebuilding layout primitives manually). I'll verify with a real generation before declaring success.
2. **Package manager.** Prompt says `npm install`; this project uses bun. I'll run `bun add @react-pdf/renderer`.
3. **Logo embedding.** `src/assets/camauto-logo.jpeg` is a bundler asset. In the server function I'll import it as a URL and pass to `<Image src={url} />`, OR fetch its public bucket URL if one exists. Need to confirm asset import works in the Worker SSR bundle; fallback is to skip the logo image and render the company name as text.
4. **`renderClauseBody` adaptation.** The existing helper returns React nodes for HTML rendering. For PDF I'll write a small parallel helper that emits `<Text>` runs with the same token substitution rules, rather than mutate the original (keeps HTML agreement working).
5. **Storage access.** Bucket `rental-signing` is private. Signed URL with 1-year expiry works, but it expires — fine for Step 1. (Long-term we'd want a renewal helper.)

## Files

**New**
- `src/components/pdf/RentalAgreementPDF.tsx` — `@react-pdf/renderer` document component. Mirrors sections of `RentalAgreement.tsx`: header, renter info, vehicle info, rental terms, extensions table (conditional), terms & conditions (from `agreementSettings.clauses`), signature blocks (renter signature `<Image>` from `client_signature_url`, company placeholder). Letter size, Helvetica, clean hierarchy — no pixel-matching.
- `src/lib/agreement-pdf.functions.ts` — `generateAgreementPdf` server fn (POST, admin client, justified by being called from token-gated `submitSigningPackage`). Steps: fetch rental/driver/vehicle/extensions/settings → `renderToBuffer(<RentalAgreementPDF .../>)` → upload to `rental-signing/{rentalId}/agreement-{timestamp}.pdf` → create 1-year signed URL → update rental row (`agreement_pdf_url`, `agreement_pdf_generated_at`) → return `{ url, generatedAt }`. Try/catch around everything; log `[agreement-pdf] rental=X ...`; never throws.

**Migration**
- `ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS agreement_pdf_url TEXT;`
- `ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS agreement_pdf_generated_at TIMESTAMPTZ;`

**Edited**
- `src/lib/sign.functions.ts` — in `submitSigningPackage`, after the existing rental UPDATE and alongside `autoSendFirstPaymentLink`, add the exact fire-and-forget block from the prompt (calls `generateAgreementPdf`, then on success sends an SMS with the URL via `sendSms`). Never blocks the signature confirmation.
- `src/routes/rentals.tsx` — on each rental card / detail action area: if `agreement_pdf_url` is set, render an outline "📄 Agreement PDF" button (opens URL in new tab, tooltip with relative timestamp from `agreement_pdf_generated_at`). If the rental is signed (`client_signed_at` present) but `agreement_pdf_url` is null, render a "Regenerate" button that invokes `generateAgreementPdf` via `useServerFn`.

## Verification I'll perform before reporting back
1. `bun add @react-pdf/renderer` succeeds; pasted entry from `package.json`.
2. Build typechecks clean (paste any errors and fix).
3. Run `generateAgreementPdf` against one existing signed rental via `stack_modern--invoke-server-function`; report the signed URL. If `renderToBuffer` fails in workerd, immediately pivot to `pdf-lib` (and tell you before rebuilding the whole template).
4. Paste full `RentalAgreementPDF`, full `generateAgreementPdf`, updated `submitSigningPackage` block, and screenshot/diff of the new button in `rentals.tsx`.

## Out of scope (next prompt)
Auto-regeneration on extensions/swap/return.

---

**Ready to proceed?** One thing I want your call on before I start: if `@react-pdf/renderer` fails in the Worker runtime at generation time, do you want me to (a) pivot to `pdf-lib` in the same pass and rebuild the layout (more work, definitely edge-safe), or (b) stop and report so you decide? Default is (a).