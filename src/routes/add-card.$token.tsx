import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import logo from "@/assets/camauto-logo-full.jpeg";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getCardRequestByToken,
  createCardRequestSetupIntent,
  saveCardRequestCard,
} from "@/lib/card-request.functions";

export const Route = createFileRoute("/add-card/$token")({
  head: () => ({ meta: [{ title: "Add a card on file — Camauto Rentals" }] }),
  component: AddCardPage,
});

function CardForm({ token, onDone }: { token: string; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const saveFn = useServerFn(saveCardRequestCard);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: submitErr } = await elements.submit();
      if (submitErr) throw new Error(submitErr.message || "Card details invalid");

      const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (confirmErr) throw new Error(confirmErr.message || "Could not save card");

      const pmId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;
      if (!pmId) throw new Error("No payment method returned");

      const res = await saveFn({
        data: { token, paymentMethodId: pmId, environment: getStripeEnvironment() },
      });
      if (!res.ok) throw new Error(res.error || "Could not save card");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ width: "100%", maxWidth: "420px", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PaymentElement options={{ fields: { billingDetails: { name: "auto" } } }} />
      {error && (
        <div
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#b91c1c",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.5rem",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={!stripe || submitting}
        style={{
          width: "100%",
          padding: "0.8rem",
          background: "#2db84b",
          color: "#fff",
          border: "none",
          borderRadius: "0.5rem",
          fontSize: "1rem",
          fontWeight: 600,
          cursor: submitting ? "default" : "pointer",
          opacity: !stripe || submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Saving…" : "Save My Card"}
      </button>
    </div>
  );
}

function AddCardPage() {
  const { token } = Route.useParams();
  const checkFn = useServerFn(getCardRequestByToken);
  const setupFn = useServerFn(createCardRequestSetupIntent);

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [renterName, setRenterName] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await checkFn({ data: { token } });
        if (!active) return;
        if (!res.found) {
          setInvalid("This link is invalid.");
        } else if (res.expired) {
          setInvalid("This link has expired. Please request a new one.");
        } else if (res.status === "completed") {
          setDone(true);
        } else {
          setRenterName(res.renterName ?? "");
          const si = await setupFn({ data: { token, environment: getStripeEnvironment() } });
          if (!active) return;
          if (!si.ok || !si.clientSecret) {
            setInvalid(si.error || "Could not start card setup.");
          } else {
            setClientSecret(si.clientSecret);
          }
        }
      } catch {
        if (active) setInvalid("Could not load this link.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: clientSecret && !done ? "flex-start" : "center",
        backgroundColor: "#ffffff",
        padding: "1.5rem",
        gap: "1.25rem",
      }}
    >
      <img src={logo} alt="Camauto Rentals" style={{ maxWidth: "320px", width: "80%", height: "auto" }} />

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading…</p>
      ) : invalid ? (
        <>
          <h1 style={{ color: "#52525b", fontSize: "1.5rem", fontWeight: 600, textAlign: "center", margin: 0 }}>
            Link unavailable
          </h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>{invalid}</p>
        </>
      ) : done ? (
        <>
          <h1 style={{ color: "#16a34a", fontSize: "1.75rem", fontWeight: 600, textAlign: "center", margin: 0 }}>
            You're all set
          </h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: 0, textAlign: "center", maxWidth: "420px" }}>
            Your card is on file to hold your reservation. No charge was made. You can close this page.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ color: "#18181b", fontSize: "1.5rem", fontWeight: 600, textAlign: "center", margin: 0 }}>
            Add a Card on File
          </h1>
          <div
            style={{
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              fontSize: "0.9rem",
              textAlign: "center",
              maxWidth: "420px",
            }}
          >
            {renterName ? `Hi ${renterName} — ` : ""}
            this is <strong>not a charge</strong>. We just need a card on file to hold your reservation.
          </div>
          {clientSecret && (
            <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
              <CardForm token={token} onDone={() => setDone(true)} />
            </Elements>
          )}
        </>
      )}
    </div>
  );
}