import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import logo from "@/assets/camauto-logo-full.jpeg";
import { getRepairActionByToken, declineRepairAction } from "@/lib/repair-actions.functions";

export const Route = createFileRoute("/repair/decline/$token")({
  head: () => ({ meta: [{ title: "Decline Repair — Camauto" }] }),
  component: DeclinePage,
});

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  border: "1px solid #d4d4d8",
  borderRadius: "0.5rem",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

function DeclinePage() {
  const { token } = Route.useParams();
  const loadFn = useServerFn(getRepairActionByToken);
  const declineFn = useServerFn(declineRepairAction);

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadFn({ data: { token } })
      .then((res) => {
        if (!active) return;
        if (!res.found) setInvalid("This link is invalid.");
        else if (res.actionTaken !== "pending") setInvalid(`This diagnosis was already ${res.actionTaken}.`);
        else { setInfo(res); setReason(res.declineReasons?.[0] ?? ""); }
      })
      .catch(() => active && setInvalid("Could not load this request."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const onConfirm = async () => {
    setError("");
    if (!reason) return setError("Please select a reason");
    setSubmitting(true);
    try {
      await declineFn({ data: { token, reason, notes: notes.trim() || undefined } });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff", padding: "1.5rem", gap: "1.5rem" }}>
      <img src={logo} alt="Camauto" style={{ maxWidth: "300px", width: "75%", height: "auto" }} />
      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading…</p>
      ) : invalid ? (
        <>
          <h1 style={{ color: "#52525b", fontSize: "1.4rem", fontWeight: 600, textAlign: "center", margin: 0 }}>Link unavailable</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>{invalid}</p>
        </>
      ) : done ? (
        <>
          <h1 style={{ color: "#b45309", fontSize: "1.6rem", fontWeight: 700, textAlign: "center", margin: 0 }}>Declined</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>Mechanic notified. You can close this page.</p>
        </>
      ) : (
        <div style={{ width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <h1 style={{ color: "#b91c1c", fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Decline diagnosis</h1>
          <p style={{ color: "#374151", fontSize: "0.95rem", margin: 0 }}>
            {info.vehicle}{info.plate ? ` (Plate: ${info.plate})` : ""} — {info.issue}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Reason</label>
            <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
              {(info.declineReasons ?? []).map((r: string) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Notes (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the mechanic should know…" />
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
          <button type="button" disabled={submitting} onClick={onConfirm}
            style={{ padding: "0.85rem", border: "none", borderRadius: "0.5rem", background: "#dc2626", color: "#fff", fontSize: "1rem", fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Submitting…" : "Confirm Decline"}
          </button>
        </div>
      )}
    </div>
  );
}
