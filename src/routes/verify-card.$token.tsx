import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import logo from "@/assets/camauto-logo-full.jpeg";
import {
  getVerificationByToken,
  submitVerificationByToken,
} from "@/lib/cardholder-verification.functions";

export const Route = createFileRoute("/verify-card/$token")({
  head: () => ({ meta: [{ title: "Verify your card — Camauto Rentals" }] }),
  component: VerifyCardPage,
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

function VerifyCardPage() {
  const { token } = Route.useParams();
  const checkFn = useServerFn(getVerificationByToken);
  const submitFn = useServerFn(submitVerificationByToken);

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    checkFn({ data: { token } })
      .then((res) => {
        if (!active) return;
        if (!res.found) {
          setInvalid("This verification link is invalid.");
        } else if (res.expired) {
          setInvalid("This verification link has expired. Please request a new one.");
        } else if (res.status === "submitted" || res.status === "verified") {
          setDone(true);
        } else {
          setCardholderName(res.cardholderName);
          setRenterName(res.renterName);
        }
      })
      .catch(() => active && setInvalid("Could not load this verification link."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

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
          token,
          phone: phone.trim(),
          relationship,
          licenseDataUrl: licenseUrl,
          ackCardholder: true,
          ackAuthorize: true,
          ackSaved: true,
        },
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: !done && !invalid && !loading ? "flex-start" : "center",
        backgroundColor: "#ffffff",
        padding: "1.5rem",
        gap: "1.5rem",
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
            Verification received
          </h1>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0, textAlign: "center" }}>
            Thank you. Your verification has been received. You can close this page.
          </p>
        </>
      ) : (
        <div style={{ width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <h1 style={{ color: "#b45309", fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>
              Card Verification Required
            </h1>
            <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: "0.4rem 0 0" }}>
              Camauto Rentals needs to verify the card used for this rental. Please complete the form below.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Cardholder name</label>
            <input style={{ ...inputStyle, background: "#f4f4f5" }} value={cardholderName} readOnly />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Cardholder phone</label>
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
              <img src={licenseUrl} alt="License preview" style={{ maxWidth: "100%", borderRadius: "0.5rem", marginTop: "0.25rem" }} />
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
        </div>
      )}
    </div>
  );
}
