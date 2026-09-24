# Vehicle dropdown cleanup and waitlist intake vetting

## 1. Standardize vehicle dropdowns

Use one shared display and sort rule for every control that selects a fleet vehicle:

`MAKE MODEL · YEAR · PLATE`

Example: `SUBARU LEGACY · 2017 · M42WAY`

- Show vehicle options in uppercase without changing saved vehicle data.
- Sort case-insensitively by make, model, year, then plate.
- Apply this to the 14 audited vehicle selectors across repairs, maintenance, expenses, insurance, reservations, violations, staff tasks, historic reservations, reports, and related dialogs.
- Preserve availability filters, preference-match indicators, special options such as “All,” and the underlying vehicle IDs.
- Leave non-selector vehicle text in cards, tables, reports, and PDFs unchanged.

## 2. Add the agency waitlist intake endpoint

Create `POST /api/public/waitlist-intake` as a server-to-server endpoint.

- Require `X-Waitlist-Key` and compare it safely against `WAITLIST_INTAKE_KEY`; return `401` without revealing which part failed.
- Validate JSON and return clear `400` responses for missing/invalid name, phone, email, booleans, dates, source, campaign, or oversized input.
- Normalize US phone numbers to a canonical form and title-case names.
- Accept the requested fields, default `src` to `agency`, and retain the raw validated request body for troubleshooting.
- Dedupe atomically by normalized phone: update the existing person instead of creating another row, while preserving existing documents, review state, and conversion history.
- Return a small agency-safe JSON response containing success, whether the row was created or updated, tier, status, and whether a text was sent—never documents or private record details.
- Add rate limiting and bounded payload handling so a leaked or abused integration cannot flood the waitlist or texts.

The private key must stay in the agency’s server configuration, never in landing-page JavaScript where visitors can inspect it.

## 3. Apply vetting tiers and messaging

Evaluate each agency submission exactly as requested:

- **Qualified:** either `accepts_deposit` or `accepts_daily_rate` is true. Save `vetting_tier = qualified`, set status to `Link sent`, create/reuse the private document-upload token, send the upload link through the existing texting service, and raise the existing staff notification.
- **Low go:** both fields are explicitly false. Save `vetting_tier = low_go`, set status to `Waitlisted`, do not send the upload link, and send the supplied courtesy text.
- **Unvetted input:** when both vetting fields are absent, treat the agency submission as qualified for workflow and upload-link delivery, as requested. Preserve null answers so staff can see the questions were unanswered rather than answered “Yes.”

Prevent repeated identical agency posts from repeatedly texting the same person. A text is sent when a person is newly qualified, moves from low-go/unvetted to qualified, or does not yet have the applicable message recorded.

## 4. Extend waitlist records safely

Add the requested fields:

- `vetting_tier`: `qualified`, `low_go`, or `unvetted`
- nullable rideshare, deposit, and daily-rate answers
- preferred start, source, campaign, and raw intake payload
- normalized-phone support for reliable deduplication
- timestamps needed to make text delivery idempotent

Also:

- Backfill existing entries as `unvetted` without changing their current workflow status.
- Stamp admin-created entries as source `manual` and tier `unvetted`.
- Capture `?src=` on the existing public `/waitlist` form, defaulting to `direct`; allow the known source values `agency`, `facebook`, `manual`, and `direct`, with unknown public values safely normalized to `direct`.
- Keep the existing `priority` field for rideshare priority so the new vetting tier does not break current behavior.
- Preserve the table’s existing access restrictions and service-role grants.

## 5. Upgrade the admin Waitlist view

- Add a Tier column with green Qualified, amber Low go, and grey Unvetted badges.
- Add tier and source filters that work in both Active and Converted tabs.
- Show the compact answer summary: `Rideshare: Yes · Deposit: Yes · Daily rate: No`, using `—` for unanswered values.
- Sort Active entries by Qualified, Unvetted, then Low go; retain the existing workflow/age ordering within each tier.
- Add **Move to qualified** only on low-go rows. The action updates the tier/status and sends the private upload link once.
- Keep document review, conversion, and existing status actions intact.

## 6. Add waitlist statistics

Above the table, calculate from saved entries:

- signups during the current calendar month
- current-month totals by source: agency, Facebook, manual, direct
- current-month totals by tier: qualified and low go
- per-source conversion rate: converted entries divided by total entries for that source during the same month

Show zero states clearly and avoid divide-by-zero results.

## 7. Secret setup and agency handoff

The agency will create the private key, per your choice. After the endpoint exists, open the secure secret form for `WAITLIST_INTAKE_KEY`; the key will not be pasted into chat or committed to project files.

The final handoff will include:

1. Exact production endpoint: `https://camautorentals.lovable.app/api/public/waitlist-intake`
2. Confirmation that `WAITLIST_INTAKE_KEY` is stored securely (the agency retains the only shareable copy)
3. A plain-language agency setup explanation, including required headers, JSON fields, example request/response, tier behavior, retry/idempotency guidance, and the warning not to expose the key in browser code

This replaces the earlier request to generate and reveal a key: because the agency creates it, there is no need to display the secret in chat.

## 8. Verification

- Test unauthorized, malformed, qualified, low-go, missing-vetting, duplicate-phone, and promotion requests.
- Verify database read-back, one-row deduplication, status/tier values, text choice, upload-link validity, and no duplicate texts on retry.
- Verify admin filters, tier order, stats, promotion, document review, and conversion.
- Verify the public form records `src` correctly.
- Check representative vehicle selectors on desktop and mobile for uppercase formatting, ordering, search, selection, and overflow.
- Confirm route metadata remains complete and the app builds without errors.
