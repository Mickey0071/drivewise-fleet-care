import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Send, Printer, DollarSign, CreditCard, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { vehicles, drivers } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { formatVehiclePickerLabel } from "@/lib/vehicle-labels";
import { rtoSummary } from "@/lib/rto";
import { loadRtoContracts, type RtoRow } from "@/lib/rto-data";
import { sendRtoSignLink, sendRtoPaymentLink } from "@/lib/rto.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { RtoContractDocument } from "@/components/app/RtoContractDocument";

export const Route = createFileRoute("/rent-to-own")({
  head: () => ({ meta: [
    { title: "Rent To Own — Camauto Rentals" },
    { name: "description", content: "Create, send, sign and collect payments on rent-to-own agreements." },
    { property: "og:title", content: "Rent To Own — Camauto Rentals" },
    { property: "og:description", content: "Create, send, sign and collect payments on rent-to-own agreements." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: RtoPage,
});

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent — awaiting signature", signed: "Signed", active: "Active", completed: "Paid off", cancelled: "Cancelled" };

const EMPTY = {
  driver_id: "", vehicle_id: "", customer_name: "", address: "", city_state_zip: "", phone: "", email: "", license_number: "",
  vehicle_year: "", vehicle_make: "", vehicle_model: "", vehicle_color: "", vin: "", plate: "", odometer: "",
  agreement_date: new Date().toISOString().slice(0, 10), first_due_date: "",
  down_payment: "1500", weekly_amount: "225", num_payments: "14", late_fee_per_day: "25", cancel_fee: "250", rep_signed_name: "",
};

function RtoPage() {
  useStoreVersion();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["rto-contracts"], queryFn: () => loadRtoContracts(supabase) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rto-contracts"] });
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [printing, setPrinting] = useState<RtoRow | null>(null);
  const [cashFor, setCashFor] = useState<RtoRow | null>(null);
  const [linkFor, setLinkFor] = useState<RtoRow | null>(null);
  const sendSign = useServerFn(sendRtoSignLink);
  const [sendingId, setSendingId] = useState<string | null>(null);

  function openNew() { setEditId(null); setForm({ ...EMPTY }); }
  function openEdit(r: RtoRow) {
    setEditId(r.id);
    const f: any = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) if (r[k] != null) f[k] = String(r[k]);
    setForm(f);
  }
  function pickDriver(id: string) {
    const d = drivers.find((x) => x.id === id); if (!d || !form) return;
    setForm({ ...form, driver_id: id, customer_name: d.fullName, phone: d.phone || "", email: d.email || "", license_number: d.licenseNumber || "", address: d.address || form.address });
  }
  function pickVehicle(id: string) {
    const v = vehicles.find((x) => x.id === id); if (!v || !form) return;
    setForm({ ...form, vehicle_id: id, vehicle_year: String(v.year ?? ""), vehicle_make: v.make, vehicle_model: v.model, vehicle_color: v.color || "", vin: v.vin || "", plate: v.plate || "", odometer: v.mileage ? String(v.mileage) : "" });
  }
  async function save() {
    if (!form) return;
    if (!form.customer_name.trim()) { toast.error("Customer name is required"); return; }
    const payload: any = { ...form,
      driver_id: form.driver_id || null, vehicle_id: form.vehicle_id || null, first_due_date: form.first_due_date || null,
      down_payment: Number(form.down_payment), weekly_amount: Number(form.weekly_amount), num_payments: Number(form.num_payments),
      late_fee_per_day: Number(form.late_fee_per_day), cancel_fee: Number(form.cancel_fee), updated_at: new Date().toISOString() };
    const q = editId ? supabase.from("rto_contracts").update(payload).eq("id", editId).select("id").single() : supabase.from("rto_contracts").insert(payload).select("id").single();
    const { data, error } = await q;
    if (error || !data) { toast.error("Could not save", { description: error?.message }); return; }
    toast.success("Contract saved"); setForm(null); refresh();
  }
  async function send(r: RtoRow) {
    setSendingId(r.id);
    try { await sendSign({ data: { contractId: r.id, origin: window.location.origin } }); toast.success("Signing link texted", { description: r.phone }); refresh(); }
    catch (e: any) { toast.error("Could not send", { description: e.message }); } finally { setSendingId(null); }
  }
  async function setStatus(r: RtoRow, status: string, extra: Record<string, unknown> = {}) {
    const { error } = await supabase.from("rto_contracts").update({ status, ...extra }).eq("id", r.id);
    if (error) toast.error(error.message); else { toast.success("Updated"); refresh(); }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader title="Rent To Own" description="Send agreements to sign by text, collect payments and track the balance." />
      <div className="flex justify-end"><Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New Rent-To-Own</Button></div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No rent-to-own contracts yet.</Card>
      ) : rows.map((r) => {
        const s = rtoSummary(r.terms, r.payments);
        return (
          <Card key={r.id} className={`space-y-3 p-4 ${s.inDefault && r.status !== "completed" ? "border-destructive" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">{r.customer_name}</div>
                <div className="text-sm text-muted-foreground">{r.vehicle_year} {r.vehicle_make} {r.vehicle_model} · {r.plate} · {r.phone}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.status === "signed" && !r.staff_seen && <Badge variant="destructive">New signature</Badge>}
                <Badge variant="secondary">{s.paidOff ? "Paid off" : STATUS[r.status] ?? r.status}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
              <Tile l="Contract total" v={money(s.contractTotal)} />
              <Tile l="Paid to date" v={money(s.totalPaid)} />
              <Tile l="Balance" v={money(s.balance)} strong />
              <Tile l="Payments left" v={`${s.remaining} of ${r.terms.numPayments}${s.downPaid ? "" : " + down"}`} />
              <Tile l="Next due" v={s.next ? `${money(s.next.amount)} · ${new Date(s.next.due + "T12:00:00").toLocaleDateString()}` : "—"}
                sub={s.daysLate > 0 ? `${s.daysLate} days late · ${money(s.lateFeeOwed)} late fee${s.inDefault ? " · DEFAULT" : ""}` : undefined} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
              <Button size="sm" variant="outline" disabled={sendingId === r.id} onClick={() => send(r)}><Send className="mr-1 h-3.5 w-3.5" />{r.sent_at ? "Resend sign link" : "Text sign link"}</Button>
              {r.status === "signed" && !r.staff_seen && <Button size="sm" onClick={() => setStatus(r, "active", { staff_seen: true })}>Approve & activate</Button>}
              <Button size="sm" variant="outline" onClick={() => setLinkFor(r)}><CreditCard className="mr-1 h-3.5 w-3.5" />Send payment link</Button>
              <Button size="sm" variant="outline" onClick={() => setCashFor(r)}><DollarSign className="mr-1 h-3.5 w-3.5" />Record cash</Button>
              <Button size="sm" variant="outline" onClick={() => setPrinting(r)}><Printer className="mr-1 h-3.5 w-3.5" />Print to date</Button>
              {s.paidOff && r.status !== "completed" && <Button size="sm" onClick={() => setStatus(r, "completed")}>Mark title transferred</Button>}
              {r.status !== "cancelled" && r.status !== "completed" && <Button size="sm" variant="ghost" onClick={() => confirm("Cancel this contract?") && setStatus(r, "cancelled")}>Cancel</Button>}
            </div>
            {r.payments.length > 0 && (
              <div className="rounded-md border text-xs">
                {r.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b px-2 py-1 last:border-0">
                    <span>{new Date(p.paidAt + "T12:00:00").toLocaleDateString()} · {p.method}{p.note ? ` · ${p.note}` : ""}</span>
                    <span className="flex items-center gap-2">{money(p.amount)}{p.lateFee > 0 ? ` (incl. ${money(p.lateFee)} late fee)` : ""}
                      <button aria-label="Delete payment" onClick={async () => { if (!confirm("Delete this payment?")) return; await supabase.from("rto_payments").delete().eq("id", p.id); refresh(); }}><Trash2 className="h-3 w-3 text-muted-foreground" /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {form && (
        <Dialog open onOpenChange={(o) => !o && setForm(null)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Rent-To-Own Agreement</DialogTitle></DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Fill from renter</Label>
                <Select value={form.driver_id} onValueChange={pickDriver}><SelectTrigger><SelectValue placeholder="Pick a renter" /></SelectTrigger>
                  <SelectContent>{[...drivers].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((d) => <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Fill from vehicle</Label>
                <Select value={form.vehicle_id} onValueChange={pickVehicle}><SelectTrigger><SelectValue placeholder="Pick a vehicle" /></SelectTrigger>
                  <SelectContent>{vehicles.filter((v) => v.status !== "archived").map((v) => <SelectItem key={v.id} value={v.id}>{formatVehiclePickerLabel(v)}</SelectItem>)}</SelectContent></Select></div>
              {([
                ["customer_name", "Full legal name"], ["agreement_date", "Date of agreement", "date"], ["address", "Address"], ["city_state_zip", "City / State / ZIP"],
                ["phone", "Phone"], ["license_number", "Driver's license # / State"], ["email", "Email"],
                ["vehicle_year", "Year"], ["vehicle_make", "Make"], ["vehicle_model", "Model"], ["vehicle_color", "Color"], ["vin", "VIN"], ["plate", "Plate #"], ["odometer", "Odometer at delivery"],
                ["down_payment", "Down payment ($)", "number"], ["weekly_amount", "Weekly payment ($)", "number"], ["num_payments", "Number of weekly payments", "number"],
                ["late_fee_per_day", "Late fee per day ($)", "number"], ["cancel_fee", "3-day cancellation fee ($)", "number"], ["first_due_date", "First weekly payment due", "date"],
                ["rep_signed_name", "CAM Auto representative name"],
              ] as [keyof typeof EMPTY, string, string?][]).map(([k, l, t]) => (
                <div key={k}><Label>{l}</Label><Input type={t ?? "text"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Leave "First weekly payment due" empty to use one week after the agreement date.</p>
            <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Close</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {printing && <PrintDialog r={printing} onClose={() => setPrinting(null)} />}
      {cashFor && <CashDialog r={cashFor} onClose={() => setCashFor(null)} onSaved={refresh} />}
      {linkFor && <LinkDialog r={linkFor} onClose={() => setLinkFor(null)} />}
    </div>
  );
}

function Tile({ l, v, sub, strong }: { l: string; v: string; sub?: string; strong?: boolean }) {
  return <div className="rounded-md border bg-muted/30 p-2"><div className="text-[11px] uppercase text-muted-foreground">{l}</div>
    <div className={strong ? "text-base font-semibold" : "font-medium"}>{v}</div>{sub && <div className="text-[11px] text-destructive">{sub}</div>}</div>;
}

function CashDialog({ r, onClose, onSaved }: { r: RtoRow; onClose: () => void; onSaved: () => void }) {
  const s = rtoSummary(r.terms, r.payments);
  const [amount, setAmount] = useState(String(s.next ? s.next.amount + s.lateFeeOwed : 0));
  const [lateFee, setLateFee] = useState(String(s.lateFeeOwed));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  async function save() {
    const a = Number(amount), lf = Number(lateFee || 0);
    if (!(a > 0) || lf < 0 || lf > a) { toast.error("Check the amounts"); return; }
    const { error } = await supabase.from("rto_payments").insert({ contract_id: r.id, amount: a, late_fee: lf, paid_at: date, method, note: note || null });
    if (error) { toast.error(error.message); return; }
    toast.success("Payment recorded"); onSaved(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
      <DialogHeader><DialogTitle>Record payment — {r.customer_name}</DialogTitle></DialogHeader>
      <div className="space-y-2">
        <div><Label>Total received ($)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>Of that, late fee ($)</Label><Input type="number" value={lateFee} onChange={(e) => setLateFee(e.target.value)} /></div>
        <div><Label>Date paid</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><Label>Method</Label><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{["cash", "zelle", "cashapp", "card", "other"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Balance now {money(s.balance)}. Late fees don't reduce the balance.</p>
      </div>
      <DialogFooter><Button onClick={save}>Save payment</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function LinkDialog({ r, onClose }: { r: RtoRow; onClose: () => void }) {
  const s = rtoSummary(r.terms, r.payments);
  const fn = useServerFn(sendRtoPaymentLink);
  const [amount, setAmount] = useState(String(s.next ? s.next.amount + s.lateFeeOwed : s.balance));
  const [busy, setBusy] = useState(false);
  const label = s.next ? (s.next.no === 0 ? "down payment" : `payment ${s.next.no} of ${r.terms.numPayments}`) : "payment";
  async function go() {
    setBusy(true);
    try { await fn({ data: { contractId: r.id, amountCents: Math.round(Number(amount) * 100), label, environment: getStripeEnvironment() } }); toast.success("Payment link texted", { description: "Balance updates automatically when paid." }); onClose(); }
    catch (e: any) { toast.error("Could not send", { description: e.message }); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
      <DialogHeader><DialogTitle>Send payment link — {r.customer_name}</DialogTitle></DialogHeader>
      <p className="text-sm">For: {label}{s.lateFeeOwed > 0 ? ` (includes ${money(s.lateFeeOwed)} late fee)` : ""}</p>
      <div><Label>Amount ($)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <DialogFooter><Button disabled={busy} onClick={go}>{busy ? "Sending…" : `Text link to ${r.phone || "renter"}`}</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function PrintDialog({ r, onClose }: { r: RtoRow; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = useMemo(() => r as any, [r]);
  function print() {
    const w = window.open("", "_blank"); if (!w || !ref.current) return;
    w.document.write(`<html><head><title>Rent-To-Own — ${r.customer_name}</title><style>
      body{font-family:Georgia,serif;font-size:11px;color:#111;margin:24px} h1{font-size:18px;margin:4px 0} h2{font-size:12px;margin:10px 0 4px}
      p{margin:4px 0} table{width:100%;border-collapse:collapse} td,th{border:1px solid #999;padding:3px;text-align:left}
      .grid{display:grid;gap:4px 16px}.grid-cols-2{grid-template-columns:1fr 1fr}.grid-cols-3{grid-template-columns:1fr 1fr 1fr}
      .rto-field{border-bottom:1px solid #999;display:flex;gap:6px}.rto-l{color:#555}.text-center{text-align:center}
      .h-16{height:56px}.border-b{border-bottom:1px solid #111}.flex{display:flex}.items-end{align-items:flex-end}img{max-height:56px}
      .rto-break{page-break-before:always}</style></head><body>${ref.current.innerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>Contract to date</DialogTitle></DialogHeader>
      <div ref={ref}><RtoContractDocument c={c} terms={r.terms} payments={r.payments} /></div>
      <DialogFooter><Button onClick={print}><Printer className="mr-1 h-4 w-4" />Print</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
