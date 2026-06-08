import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import logo from "@/assets/camauto-logo-full.jpeg";
import {
  getCardholderVerificationState,
  submitCardholderVerification,
  refuseCardholderVerification,
} from "@/lib/cardholder-verification.functions";

export const Route = createFileRoute("/rent/paid")({
  head: () => ({ meta: [{ title: "Thank you — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    rental_id: typeof s.rental_id === "string" ? s.rental_id : undefined,
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
    canceled: typeof s.canceled === "string" ? s.canceled : undefined,
  }),
  component: PaidPage,
});

const RELATIONSHIPS = ["Parent", "Spouse", "Friend", "Employer", "Self", "Other"];

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  border: "1px solid #d4d4d8",
  borderRadius: "0.5rem",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

function PaidPage() {
  const { canceled, rental_id } = Route.useSearch();
  const isCanceled = canceled === "1" || canceled === "true";

  const checkState = useServerFn(getCardholderVerificationState);
  const submitFn = useServerFn(submitCardholderVerification);
  const refuseFn = useServerFn(refuseCardholderVerification);

  const [needed, setNeeded] = useState(false);
  const [cardholderName, setCardholderName] = useState("");
  const [renterName, setRenterName] = useState("");
  const [done, setDone] = useState(false);

  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [ack3, setAck3] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const refusedRef = useRef(false);

  useEffect(() => {
    if (isCanceled || !rental_id) return;
    let active = true;
    checkState({ data: { rentalId: rental_id } })
      .then((res) => {
        if (!active) return;
        if (res.needed) {
          setNeeded(true);
          setCardholderName(res.cardholderName);
          setRenterName(res.renterName);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isCanceled, rental_id]);

  // If the cardholder closes/leaves before submitting, flag as refused.
  useEffect(() => {
    if (!needed || done) return;
    const handler = () => {
      if (refusedRef.current || !rental_id) return;
      refusedRef.current = true;
      const blob = new Blob([JSON.stringify({ rentalId: rental_id })], {
        type: "application/json",
      });
      navigator.sendBeacon?.("/api/public/cardholder-refuse", blob);
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [needed, done, rental_id]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be under 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLicenseUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const onSubmit = async () => {
    setError("");
    if (!phone.trim()) return setError("Enter the cardholder's phone number");
    if (!relationship) return setError("Select relationship to renter");
    if (!licenseUrl) return setError("Upload the cardholder's driver's license");
    if (!ack1 || !ack2 || !ack3) return setError("Please confirm all acknowledgements");
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          rentalId: rental_id!,
          phone: phone.trim(),
          relationship,
          licenseDataUrl: licenseUrl,
          ackCardholder: true,
          ackAuthorize: true,
          ackSaved: true,
        },
      });
      refusedRef.current = true;
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSkip = async () => {
    if (rental_id) {
      refusedRef.current = true;
      try {
        await refuseFn({ data: { rentalId: rental_id } });
      } catch {}
    }
    setNeeded(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: needed && !done ? "flex-start" : "center",
        backgroundColor: "#ffffff",
        padding: "1.5rem",
        gap: "1.5rem",
      }}
    >
      <img
        src={logo}
        alt="Camauto Rentals"
        style={{ maxWidth: "320px", width: "80%", height: "auto" }}
      />

      {needed && !done ? (
        <div style={{ width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <h1 style={{ color: "#b45309", fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>
              Card Verification Required
            </h1>
            <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: "0.4rem 0 0" }}>
              The cardholder name does not match the renter. Please verify. Your payment has
              already been received.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
              Cardholder name
            </label>
            <input style={{ ...inputStyle, background: "#f4f4f5" }} value={cardholderName} readOnly />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
              Cardholder phone
            </label>
            <input
              style={inputStyle}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(267) 555-1234"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
              Relationship to renter{renterName ? ` (${renterName})` : ""}
            </label>
            <select style={inputStyle} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              <option value="">Select…</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
              Front of cardholder's driver's license
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                padding: "0.6rem 0.75rem",
                border: "1px dashed #d4d4d8",
                borderRadius: "0.5rem",
                background: "#fafafa",
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              {licenseUrl ? "Change photo" : "Upload / Take photo"}
            </button>
            {licenseUrl && (
              <img
                src={licenseUrl}
                alt="License preview"
                style={{ maxWidth: "100%", borderRadius: "0.5rem", marginTop: "0.25rem" }}
              />
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem", color: "#374151" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} />
              <span>I am the cardholder.</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} />
              <span>I authorize this charge for the rental.</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <input type="checkbox" checked={ack3} onChange={(e) => setAck3(e.target.checked)} />
              <span>I understand this verification will be saved to the transaction.</span>
            </label>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}

          <button
            type="button"
            disabled={submitting}
            onClick={onSubmit}
            style={{
              padding: "0.75rem",
              border: "none",
              borderRadius: "0.5rem",
              background: "#16a34a",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Submitting…" : "Submit Verification"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            style={{
              padding: "0.5rem",
              border: "none",
              background: "transparent",
              color: "#9ca3af",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Skip for now
          </button>
        </div>
      ) : (
        <>
          <h1
            style={{
              color: isCanceled ? "#52525b" : "#16a34a",
              fontSize: "1.75rem",
              fontWeight: 600,
              textAlign: "center",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {isCanceled
              ? "Payment was not completed"
              : done
                ? "Verification received"
                : "Thank you for choosing Camauto"}
          </h1>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0, textAlign: "center" }}>
            {isCanceled
              ? "You can close this page and request a new payment link from Camauto Rentals."
              : done
                ? "Verification received. Payment confirmed. You can close this page."
                : "Your payment has been received. You can close this page."}
          </p>
        </>
      )}
    </div>
  );
}