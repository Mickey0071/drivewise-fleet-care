import { loadStripe, Stripe } from "@stripe/stripe-js";

type StripeEnv = 'sandbox' | 'live';

// Only the published production domain(s) use LIVE Stripe. Everything else
// (Lovable preview, local dev, share links) uses the TEST environment so we
// never charge real cards while testing.
const LIVE_HOSTS = new Set<string>([
  "camautorentals.lovable.app",
]);

function resolveEnvironment(): StripeEnv {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (LIVE_HOSTS.has(host)) return "live";
    return "sandbox";
  }
  // SSR / build: fall back to the configured token prefix.
  return import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN?.startsWith("pk_test_")
    ? "sandbox"
    : "live";
}

const environment: StripeEnv = resolveEnvironment();
const testToken =
  import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN_TEST ??
  import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
const liveToken =
  import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN_LIVE ??
  import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
const clientToken = environment === "live" ? liveToken : testToken;

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
    stripePromise = loadStripe(clientToken);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return environment;
}