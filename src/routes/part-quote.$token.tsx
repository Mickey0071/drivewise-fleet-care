import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import logo from "@/assets/camauto-logo-full.jpeg";
import { getPartInquiryByToken, submitPartQuote } from "@/lib/parts.functions";

export const Route = createFileRoute("/part-quote/$token")({
  head: () => ({ meta: [{ title: "Part Price Request — Camauto" }] }),
  component: PartQuotePage,
});

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  border: "1px solid #d4d4d8",
  borderRadius: "0.5rem",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

const AVAILABILITY = [
  { value: "in_stock", label: "In stock" },
  { value: "order", label: "Can order it" },
  { value: "unavailable", label: "Not available" },
];

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.3rem 0", borderBottom: "1px solid #f1f1f4" }}>
      <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</span>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#111827", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function PartQuotePage() {
  const { token } = Route.useParams();
  const checkFn = useServerFn(getPartInquiryByToken);
  const submitFn = useServerFn(submitPartQuote);

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [done, setDone] = useState(false);

  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState("in_stock");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    checkFn({ data: { token } })
      .then((res) => {
        if (!active) return;
        if (!res.found) setInvalid("This price request link is invalid.");
        else if (res.expired) setInvalid("This link has expired. Please ask Camauto to resend it.");
        else if (res.status === "quoted") {
          setInfo(res);
          setDone(true);
        } else setInfo(res);
      })
      .catch(() => active && setInvalid("Could not load this request."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  const onSubmit = async () => {
    setError("");
    if (!price.trim()) return setError("Enter your price");
    setSubmitting(true);
    try {
      await submitFn({ data: { token, price: price.trim(), availability: availability as any, notes: notes.trim() || undefined } });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const vehicle = info
    ? [info.year, info.make, info.model, info.subModel].filter(Boolean).join(" ")
    : "";

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
      <img src={logo} alt="Camauto" style={{ maxWidth: "320px", width: "80%", height: "auto" }} />

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading…</p>
      ) : invalid ? (
        <>
          <h1 style={{ color: "#52525b", fontSize: "1.5rem", fontWeight: 600, textAlign: "center", margin: 0 }}>Link unavailable</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>{invalid}</p>
        </>
      ) : done ? (
        <>
          <h1 style={{ color: "#16a34a", fontSize: "1.75rem", fontWeight: 600, textAlign: "center", margin: 0 }}>Price received</h1>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0, textAlign: "center" }}>
            Thanks{info?.supplierName ? `, ${info.supplierName}` : ""}. Camauto has your price. You can close this page.
          </p>
        </>
      ) : (
        <div style={{ width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <h1 style={{ color: "#b45309", fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Part Price Request</h1>
            <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: "0.4rem 0 0" }}>
              {info?.supplierName ? `Hi ${info.supplierName}. ` : ""}Camauto needs a price on the part below.
            </p>
          </div>

          <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
            <Detail label="Part" value={info?.partName || ""} />
            <Detail label="Vehicle" value={vehicle} />
            <Detail label="Year" value={info?.year ? String(info.year) : ""} />
            <Detail label="Make" value={info?.make || ""} />
            <Detail label="Model" value={info?.model || ""} />
            <Detail label="Sub-model" value={info?.subModel || ""} />
            <Detail label="VIN" value={info?.vin || ""} />
            <Detail label="Plate" value={info?.plate || ""} />
            <Detail label="Notes" value={info?.notes || ""} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Your price</label>
            <input
              style={inputStyle}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$0.00"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Availability</label>
            <select style={inputStyle} value={availability} onChange={(e) => setAvailability(e.target.value)}>
              {AVAILABILITY.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Notes (optional)</label>
            <textarea
              style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Condition, mileage, anything Camauto should know…"
            />
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
            {submitting ? "Sending…" : "Send Price to Camauto"}
          </button>
        </div>
      )}
    </div>
  );
}