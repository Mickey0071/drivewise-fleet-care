import { getStripeEnvironment } from "@/lib/stripe";

export function PaymentTestModeBanner() {
  if (getStripeEnvironment() !== "sandbox") return null;
  return (
    <div className="w-full bg-orange-100 border-b border-orange-300 px-4 py-2 text-center text-sm text-orange-800">
      🧪 TEST MODE — No real charges. Use Stripe test card 4242 4242 4242 4242.{" "}
      <a
        href="https://docs.lovable.dev/features/payments#test-and-live-environments"
        target="_blank"
        rel="noopener noreferrer"
        className="underline font-medium"
      >
        Read more
      </a>
    </div>
  );
}