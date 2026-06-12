# Toll Match DEBUG Panel

Add a collapsible, **admin-only**, read-only diagnostics panel to the bulk-upload review screen so you can see exactly what the matcher is working with for each extracted toll — without changing any matching logic.

## What it shows (per toll row)

- **Raw stored plate** — the plate string saved on the batch item, shown wrapped in quotes (`"…"`) so trailing/leading whitespace is visible.
- **Normalized plate** — result of stripping all non-alphanumerics + uppercasing (`replace(/[^A-Z0-9]/gi,"").toUpperCase()`), the exact value the matcher compares against.
- **Raw violation date** + **parsed date used for window comparison** — the value the code actually compares to reservation start/end.
- **LIVE plate matches (ignoring date)** — count of `rentals` (via `vehicles` whose plate matches) regardless of the date window.
- **LIVE plate + date matches** — count that ALSO pass the start/end date-window filter.
- **LEGACY plate matches (ignoring date)** — same count against `legacy_rentals`.
- **LEGACY plate + date matches** — count that ALSO pass the date window.

This makes it obvious whether the failure is (a) plate extraction/normalization, (b) the date comparison, or (c) no reservation data present.

## Important note on "raw OCR plate"

The OCR plate is **not** stored byte-for-byte today: extraction in `ezpass.server.ts` already runs `.trim().toUpperCase()` before persisting, so the truly-raw OCR string (with newlines/odd casing) no longer exists on saved batches. The panel will show the stored value verbatim in quotes (catching whitespace that survives), and label it "stored plate" rather than implying it's pre-trim OCR output. If you also want the genuinely raw OCR text preserved going forward, that's a separate change to the extraction step — out of scope here unless you want it added.

## Technical details

**New server function** — `debugEzpassMatch` in `src/lib/ezpass.functions.ts`:
- `createServerFn({ method: "GET" })` with `.middleware([requireSupabaseAuth])`.
- Input: `{ batchId }` (zod-validated).
- Authorize admin: call `has_role(userId, 'admin')` via `supabaseAdmin.rpc`; throw if not admin (panel is admin-only on the server, not just hidden in UI).
- Loads the batch items, then for each item **re-runs the same read queries the matcher uses** (`vehicles` by plate → `rentals` by vehicle window; `legacy_rentals` by plate prefix) but only to COUNT, computing each count both with and without the date-window filter. Uses the identical `normPlate` and date-slice logic from `autoMatchToll` so the diagnostics reflect real behavior. No writes, no changes to `autoMatchToll`.
- Returns an array of `{ itemId, rawPlate, normPlate, rawDate, parsedDate, liveByPlate, liveByPlateAndDate, legacyByPlate, legacyByPlateAndDate }`.

**UI** — in `ReviewBatch` (`src/routes/violations_.bulk-upload.tsx`):
- Read `role` from `useAuth()`; render the panel only when `role === "admin"`.
- A `Collapsible` (default closed) titled "DEBUG: matcher diagnostics", placed below the existing results table.
- Fetch via `useQuery` keyed `["ezpass-debug", batchId]`, enabled only for admins, calling the new server fn.
- Render a compact monospace table, one row per toll, with the fields above. Counts that are zero where you'd expect a match are easy to spot.

No matching logic, schema, or extraction behavior is modified — this is purely additive, read-only diagnostics.