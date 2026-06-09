import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import logo from "@/assets/camauto-logo-full.jpeg";
import { getRepairActionByToken, acceptRepairAction } from "@/lib/repair-actions.functions";

export const Route = createFileRoute("/repair/accept/$token")({
  head: () => ({ meta: [{ title: "Approve Repair — Camauto" }] }),
  component: AcceptPage,
});

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.3rem 0", borderBottom: "1px solid #f1f1f4" }}>
      <span style={{ fontSize: "0.85rem", color: bold ? "#111827" : "#6b7280", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: "0.9rem", fontWeight: bold ? 800 : 600, color: "#111827" }}>{value}</span>
    </div>
  );
}

function AcceptPage() {
  const { token } = Route.useParams();
  const loadFn = useServerFn(getRepairActionByToken);
  const acceptFn = useServerFn(acceptRepairAction);

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadFn({ data: { token } })
      .then((res) => {
        if (!active) return;
        if (!res.found) setInvalid("This approval link is invalid.");
        else if (res.actionTaken !== "pending") setInvalid(`This diagnosis was already ${res.actionTaken}.`);
        else setInfo(res);
      })
      .catch(() => active && setInvalid("Could not load this request."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const onConfirm = async () => {
    setError("");
    setSubmitting(true);
    try {
      await acceptFn({ data: { token } });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve. Please try again.");
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
          <h1 style={{ color: "#16a34a", fontSize: "1.6rem", fontWeight: 700, textAlign: "center", margin: 0 }}>✓ Approved</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "center", margin: 0 }}>Mechanic notified to start work. You can close this page.</p>
        </>
      ) : (
        <div style={{ width: "100%", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <h1 style={{ color: "#15803d", fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Approve diagnosis?</h1>
          <p style={{ color: "#374151", fontSize: "0.95rem", margin: 0 }}>
            {info.vehicle}{info.plate ? ` (Plate: ${info.plate})` : ""} — {info.issue}
          </p>
          <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
            {(info.partsList ?? []).map((p: any, i: number) => (
              <Row key={i} label={p.name} value={money(p.price)} />
            ))}
            {info.partsTotal > 0 && <Row label="Parts" value={money(info.partsTotal)} />}
            <Row label="Labour" value={money(info.labourCost)} />
            <Row label="Total" value={money(info.total)} bold />
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
          <button type="button" disabled={submitting} onClick={onConfirm}
            style={{ padding: "0.85rem", border: "none", borderRadius: "0.5rem", background: "#16a34a", color: "#fff", fontSize: "1rem", fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Approving…" : "Confirm Accept"}
          </button>
        </div>
      )}
    </div>
  );
}
