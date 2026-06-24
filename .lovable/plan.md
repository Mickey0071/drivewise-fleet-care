# Fix renter portal redirecting to the vehicle list

## Diagnosis
The portal page and its server data function are already implemented to spec — they read the token, resolve it via `portal_tokens` to exactly one reservation, and render the three tabs (Reservation, Extensions, Make a payment) with balance-engine numbers.

The real bug: the global auth guard in `src/routes/__root.tsx` has a `PUBLIC_ROUTES` allowlist. It includes `/portal-signup` but **not** `/portal`. So loading `/portal/<token>` is treated as authenticated, redirects to `/login`, and after sign-in the user lands on the fleet — the "list of vehicles" they reported.

When I loaded a real token (`/portal/<token>`) in the live preview, the URL redirected to `/login`, confirming this.

## The fix (one change)
In `src/routes/__root.tsx`, add `"/portal"` to the `PUBLIC_ROUTES` array.

```text
const PUBLIC_ROUTES = [
  "/login",
  ...
  "/portal-signup",
  "/portal",        // <-- add: token-authenticated renter portal, no login
  ...
];
```

`path.startsWith("/portal")` makes `/portal/<token>` public. `/portal-signup` is already public and remains so. The token itself remains the only key — the server function still validates the token and exposes only that one reservation.

## Out of scope (unchanged)
The "Send Portal Link" button, token generation, SMS/email send, the balance engine, the portal UI, and the Stripe webhook all stay exactly as they are.

## Verification
After the change, reload `/portal/<token>` and confirm it renders the single reservation across the three tabs instead of redirecting to login.
