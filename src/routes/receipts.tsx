import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Save, Trash2, Search, FileText, Car, UserRound, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BRAND_COMPANY, BRAND_LOGO_DATA_URL } from "@/lib/branding";
import { computeReceiptTotals, NJ_SALES_TAX_RATE, type ReceiptItem } from "@/lib/receipt-math";

export const Route = createFileRoute("/receipts")({
  validateSearch: z.object({ rentalId: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Receipts — Camauto Rentals" },
      { name: "description", content: "Create and print rental receipts with NJ sales tax." },
      { property: "og:title", content: "Receipts — Camauto Rentals" },
      { property: "og:description", content: "Create and print rental receipts with NJ sales tax." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceiptsPage,
});

interface Draft {
  id?: string;
  receipt_number?: string;
  rental_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  vehicle_label: string;
  receipt_date: string;
  period_start: string;
  period_end: string;
  items: ReceiptItem[];
  tax_rate: number;
  amount_paid: number;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Draft => ({
  rental_id: null, customer_name: "", customer_phone: "", customer_email: "", vehicle_label: "",
  receipt_date: today(), period_start: "", period_end: "",
  items: [{ description: "Vehicle rental", quantity: 1, unitPrice: 0, taxable: true }],
  tax_rate: NJ_SALES_TAX_RATE, amount_paid: 0, notes: "",
});
const money = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const receiptDate = (value: string) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const sb = supabase as any;

async function draftFromRental(rentalId: string): Promise<Draft | null> {
  const { data: r } = await sb.from("rentals")
    .select("id, vehicle_id, driver_id, start_date, end_date, base_amount, rate, weekly_rate, deposit_paid, reservation_status")
    .eq("id", rentalId).maybeSingle();
  if (!r) return null;
  const [{ data: d }, { data: v }, { data: pays }] = await Promise.all([
    sb.from("drivers").select("full_name, phone, email").eq("id", r.driver_id).maybeSingle(),
    sb.from("vehicles").select("year, make, model, plate").eq("id", r.vehicle_id).maybeSingle(),
    sb.from("payments").select("amount, kind, status, note, paid_date").eq("rental_id", rentalId).eq("status", "paid"),
  ]);
  const items: ReceiptItem[] = [];
  const base = Number(r.base_amount ?? 0);
  items.push({ description: `Vehicle rental ${r.start_date ?? ""} – ${r.end_date ?? ""}`.trim(), quantity: 1, unitPrice: base, taxable: true });
  const dep = Number(r.deposit_paid);
  if (Number.isFinite(dep) && dep > 0) items.push({ description: "Security deposit", quantity: 1, unitPrice: dep, taxable: false });
  const paid = (pays ?? []).filter((p: any) => p.kind !== "credit").reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  return {
    ...blank(),
    rental_id: rentalId,
    customer_name: d?.full_name ?? "",
    customer_phone: d?.phone ?? "",
    customer_email: d?.email ?? "",
    vehicle_label: v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}${v.plate ? ` · ${v.plate}` : ""}`.trim() : "",
    period_start: r.start_date ?? "",
    period_end: r.end_date ?? "",
    items,
    amount_paid: Math.round(paid * 100) / 100,
  };
}

function ReceiptsPage() {
  const { rentalId } = Route.useSearch();
  const [tab, setTab] = useState(rentalId ? "edit" : "list");
  const [draft, setDraft] = useState<Draft>(blank());
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [rentalSearch, setRentalSearch] = useState("");
  const [rentals, setRentals] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const loadList = async () => {
    const { data } = await sb.from("receipts").select("*").order("created_at", { ascending: false }).limit(300);
    setList(data ?? []);
  };
  useEffect(() => { loadList(); }, []);
  useEffect(() => {
    if (!rentalId) return;
    draftFromRental(rentalId).then((d) => d ? setDraft(d) : toast.error("Reservation not found"));
  }, [rentalId]);
  useEffect(() => {
    (async () => {
      const { data } = await sb.from("rentals")
        .select("id, start_date, end_date, reservation_status, drivers(full_name), vehicles(year, make, model, plate)")
        .order("start_date", { ascending: false }).limit(400);
      setRentals(data ?? []);
    })();
  }, []);

  const totals = useMemo(() => computeReceiptTotals(draft.items, draft.tax_rate, draft.amount_paid), [draft]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (i: number, patch: Partial<ReceiptItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const save = async () => {
    setSaving(true);
    const row = {
      rental_id: draft.rental_id, customer_name: draft.customer_name, customer_phone: draft.customer_phone,
      customer_email: draft.customer_email, vehicle_label: draft.vehicle_label, receipt_date: draft.receipt_date || today(),
      period_start: draft.period_start || null, period_end: draft.period_end || null, items: draft.items,
      tax_rate: draft.tax_rate, subtotal: totals.subtotal, tax_amount: totals.tax, total: totals.total,
      amount_paid: draft.amount_paid, notes: draft.notes,
    };
    const res = draft.id
      ? await sb.from("receipts").update(row).eq("id", draft.id).select().single()
      : await sb.from("receipts").insert(row).select().single();
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    setDraft((d) => ({ ...d, id: res.data.id, receipt_number: res.data.receipt_number }));
    toast.success("Receipt saved");
    loadList();
  };

  const openSaved = (r: any) => {
    setDraft({
      id: r.id, receipt_number: r.receipt_number, rental_id: r.rental_id, customer_name: r.customer_name ?? "",
      customer_phone: r.customer_phone ?? "", customer_email: r.customer_email ?? "", vehicle_label: r.vehicle_label ?? "",
      receipt_date: r.receipt_date ?? today(), period_start: r.period_start ?? "", period_end: r.period_end ?? "",
      items: r.items ?? [], tax_rate: Number(r.tax_rate), amount_paid: Number(r.amount_paid), notes: r.notes ?? "",
    });
    setTab("edit");
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this receipt?")) return;
    await sb.from("receipts").delete().eq("id", id);
    loadList();
  };

  const filteredRentals = rentals.filter((r) => {
    const s = `${r.id} ${r.drivers?.full_name ?? ""} ${r.vehicles?.plate ?? ""} ${r.vehicles?.make ?? ""} ${r.vehicles?.model ?? ""}`.toLowerCase();
    return !rentalSearch || s.includes(rentalSearch.toLowerCase());
  }).slice(0, 40);

  return (
    <div className="p-4 md:p-6">
      <div className="print:hidden">
        <PageHeader
          title="Receipts"
          subtitle="Camauto Rentals"
          action={<Button onClick={() => { setDraft(blank()); setTab("edit"); }}><Plus className="mr-1 h-4 w-4" />Manual receipt</Button>}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="print:hidden">
          <TabsTrigger value="list">Saved receipts</TabsTrigger>
          <TabsTrigger value="reservations">From a reservation</TabsTrigger>
          <TabsTrigger value="edit">Receipt</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="print:hidden">
          <div className="relative mb-3 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, vehicle, receipt #" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="grid gap-2">
            {list.filter((r) => `${r.receipt_number} ${r.customer_name} ${r.vehicle_label}`.toLowerCase().includes(q.toLowerCase())).map((r) => (
              <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <button className="text-left" onClick={() => openSaved(r)}>
                  <div className="font-medium">{r.receipt_number} · {r.customer_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.vehicle_label || "No vehicle"} · {r.receipt_date} · {r.rental_id ? `Reservation ${r.rental_id}` : "Manual"}</div>
                </button>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{money(r.total)}</span>
                  <Button size="sm" variant="outline" onClick={() => openSaved(r)}>Open</Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent></Card>
            ))}
            {list.length === 0 && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
          </div>
        </TabsContent>

        <TabsContent value="reservations" className="print:hidden">
          <Input className="mb-3 max-w-sm" placeholder="Search renter, plate, reservation ID" value={rentalSearch} onChange={(e) => setRentalSearch(e.target.value)} />
          <div className="grid gap-2">
            {filteredRentals.map((r) => (
              <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <div className="font-medium">{r.drivers?.full_name ?? "Unknown"} · {r.vehicles ? `${r.vehicles.make} ${r.vehicles.model} ${r.vehicles.plate ?? ""}` : ""}</div>
                  <div className="text-xs text-muted-foreground">{r.id} · {r.start_date} – {r.end_date} · {r.reservation_status ?? ""}</div>
                </div>
                <Button size="sm" onClick={async () => { const d = await draftFromRental(r.id); if (d) { setDraft(d); setTab("edit"); } }}>
                  <FileText className="mr-1 h-4 w-4" />Create receipt
                </Button>
              </CardContent></Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="edit">
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 space-y-6 print:hidden">
              <div className="flex items-center gap-2 border-b pb-3"><UserRound className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold">Receipt details</h2></div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Label>Customer name</Label><Input value={draft.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></div>
                <div><Label>Phone</Label><Input value={draft.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} /></div>
                <div><Label>Email</Label><Input value={draft.customer_email} onChange={(e) => set("customer_email", e.target.value)} /></div>
                <div><Label>Vehicle</Label><Input placeholder="2016 Hyundai Sonata · ABC123" value={draft.vehicle_label} onChange={(e) => set("vehicle_label", e.target.value)} /></div>
                <div><Label>Receipt date</Label><Input type="date" value={draft.receipt_date} onChange={(e) => set("receipt_date", e.target.value)} /></div>
                <div><Label>Tax rate (%)</Label><Input type="number" step="0.001" value={draft.tax_rate} onChange={(e) => set("tax_rate", Number(e.target.value))} /></div>
                <div><Label>Rental start</Label><Input type="date" value={draft.period_start} onChange={(e) => set("period_start", e.target.value)} /></div>
                <div><Label>Rental end</Label><Input type="date" value={draft.period_end} onChange={(e) => set("period_end", e.target.value)} /></div>
              </div>
              <RateCalculator onApply={(desc, qty, price) => setDraft((d) => {
                const items = [...d.items];
                const line = { description: desc, quantity: qty, unitPrice: price, taxable: true };
                if (items.length && /rental/i.test(items[0].description)) items[0] = line; else items.unshift(line);
                let end = d.period_end;
                if (d.period_start) { const dt = new Date(`${d.period_start}T00:00:00`); dt.setDate(dt.getDate() + (desc.includes("week") ? qty * 7 : qty)); end = dt.toISOString().slice(0, 10); }
                return { ...d, items, period_end: end };
              })} />
              <div className="border-t pt-5">
                <h2 className="mb-3 text-base font-semibold">Charges</h2>
                <div className="mt-1 space-y-2">
                  {draft.items.map((it, i) => (
                    <div key={i} className="grid grid-cols-12 items-center gap-2">
                      <Input className="col-span-5" aria-label={`Item ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                      <Input className="col-span-2" type="number" inputMode="numeric" placeholder="1" value={it.quantity || ""} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })} />
                      <Input className="col-span-3" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={it.unitPrice || ""} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) || 0 })} />
                      <label className="col-span-1 flex items-center justify-center" title="Taxable">
                        <Checkbox checked={it.taxable} onCheckedChange={(c) => setItem(i, { taxable: !!c })} />
                      </label>
                      <Button className="col-span-1" size="icon" variant="ghost" aria-label={`Remove item ${i + 1}`} title="Remove item" onClick={() => set("items", draft.items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Description · Qty · Price · Taxable</p>
                  <Button size="sm" variant="outline" onClick={() => set("items", [...draft.items, { description: "", quantity: 1, unitPrice: 0, taxable: true }])}><Plus className="mr-1 h-4 w-4" />Add item</Button>
                </div>
              </div>
              <div><Label>Amount paid</Label><Input type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={draft.amount_paid || ""} onChange={(e) => set("amount_paid", Number(e.target.value) || 0)} /></div>
              <div><Label>Notes</Label><Textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              <div className="flex gap-2 border-t pt-4">
                <Button onClick={save} disabled={saving}><Save className="mr-1 h-4 w-4" />{draft.id ? "Update" : "Save"}</Button>
                <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
              </div>
            </div>

            <div className="min-w-0 bg-muted/60 p-3 sm:p-6 print:bg-transparent print:p-0">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground print:hidden">
                <span className="font-medium">Receipt preview</span>
                <span>{draft.id ? "Saved receipt" : "Unsaved draft"}</span>
              </div>
              <article className="receipt-document min-w-0 border border-border bg-card text-card-foreground shadow-sm print:border-0 print:shadow-none" id="receipt-print">
                <header className="border-t-4 border-primary px-5 pb-6 pt-7 sm:px-8">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="min-w-0">
                      <img src={BRAND_LOGO_DATA_URL} alt="Camauto Rentals" className="mb-3 h-auto w-40 max-w-full object-contain object-left" />
                      <div className="text-xs font-medium">{BRAND_COMPANY.legal}</div>
                      <div className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">{BRAND_COMPANY.address}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{BRAND_COMPANY.contact}</div>
                    </div>
                    <div className="text-right">
                      <h2 className="text-2xl font-semibold text-primary">RECEIPT</h2>
                      <div className="mt-2 text-sm font-medium">{draft.receipt_number ?? "DRAFT"}</div>
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" />{receiptDate(draft.receipt_date)}</div>
                    </div>
                  </div>
                  {draft.rental_id && <div className="mt-5 break-all border-t pt-3 text-xs text-muted-foreground">Reservation reference <span className="font-medium text-foreground">{draft.rental_id}</span></div>}
                </header>
                <section className="grid grid-cols-1 gap-5 border-y bg-muted/40 px-5 py-5 sm:grid-cols-2 sm:px-8">
                  <div className="min-w-0">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Billed to</h3>
                    <div className="break-words text-sm font-semibold">{draft.customer_name || "—"}</div>
                    {draft.customer_phone && <div className="mt-1 text-xs text-muted-foreground">{draft.customer_phone}</div>}
                    {draft.customer_email && <div className="mt-1 break-all text-xs text-muted-foreground">{draft.customer_email}</div>}
                  </div>
                  <div className="min-w-0">
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground"><Car className="h-3 w-3" />Vehicle & rental period</h3>
                    <div className="break-words text-sm font-semibold">{draft.vehicle_label || "—"}</div>
                    {(draft.period_start || draft.period_end) && <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{receiptDate(draft.period_start)} – {receiptDate(draft.period_end)}</div>}
                  </div>
                </section>
                <div className="px-5 py-6 sm:px-8">
                  <table className="w-full table-fixed text-xs tabular-nums">
                    <colgroup><col className="w-[46%]" /><col className="w-[10%]" /><col className="w-[22%]" /><col className="w-[22%]" /></colgroup>
                    <thead><tr className="border-b-2 text-left text-[10px] uppercase text-muted-foreground"><th className="pb-3 pr-2 font-medium">Description</th><th className="pb-3 text-right font-medium">Qty</th><th className="pb-3 text-right font-medium">Rate</th><th className="pb-3 text-right font-medium">Amount</th></tr></thead>
                    <tbody>
                      {draft.items.map((it, i) => (
                        <tr key={i} className="border-b align-top">
                          <td className="break-words py-4 pr-3 font-medium">{it.description || "—"}{!it.taxable && <span className="mt-1 block text-[10px] font-normal text-muted-foreground">Non-taxable</span>}</td>
                          <td className="py-4 text-right">{it.quantity}</td>
                          <td className="break-words py-4 text-right">{money(it.unitPrice)}</td>
                          <td className="break-words py-4 text-right font-semibold">{money(it.quantity * it.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="ml-auto mt-6 w-full max-w-72 space-y-3 text-xs tabular-nums">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-medium">{money(totals.subtotal)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">NJ sales tax ({draft.tax_rate}%)<span className="mt-1 block text-[10px]">Taxable amount: {money(totals.taxableBase)}</span></dt><dd className="font-medium">{money(totals.tax)}</dd></div>
                    <div className="flex justify-between gap-4 border-y py-4 text-base"><dt className="font-semibold">Receipt total</dt><dd className="font-bold">{money(totals.total)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Amount paid</dt><dd className="font-medium">{money(draft.amount_paid)}</dd></div>
                    <div className="flex items-center justify-between gap-4 border-l-4 border-primary bg-accent px-4 py-4 text-accent-foreground"><dt className="text-sm font-semibold">Balance due</dt><dd className="text-lg font-bold">{money(totals.balance)}</dd></div>
                  </dl>
                  {draft.notes && <section className="mt-7 border-t pt-4"><h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Notes</h3><p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{draft.notes}</p></section>}
                </div>
                <footer className="border-t px-5 py-5 text-center sm:px-8">
                  <p className="text-xs font-medium">Thank you for choosing Camauto Rentals.</p>
                  <p className="mt-2 text-[10px] text-muted-foreground">{BRAND_COMPANY.footer}</p>
                </footer>
              </article>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RateCalculator({ onApply }: { onApply: (desc: string, qty: number, price: number) => void }) {
  const [period, setPeriod] = useState<"daily" | "weekly">("weekly");
  const [rate, setRate] = useState("");
  const [units, setUnits] = useState("");
  const r = Number(rate) || 0;
  const u = Number(units) || 0;
  const unitWord = period === "daily" ? (u === 1 ? "day" : "days") : (u === 1 ? "week" : "weeks");
  return (
    <div className="border-y bg-muted/40 py-4">
      <Label>Rate calculator</Label>
      <div className="mt-2 flex gap-1">
        {(["daily", "weekly"] as const).map((p) => (
          <Button key={p} type="button" size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {p === "daily" ? "Daily" : "Weekly"}
          </Button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div><Label className="text-xs">{period === "daily" ? "Daily" : "Weekly"} rate</Label><Input type="number" inputMode="decimal" placeholder="0.00" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div><Label className="text-xs">Number of {period === "daily" ? "days" : "weeks"}</Label><Input type="number" inputMode="numeric" placeholder="1" value={units} onChange={(e) => setUnits(e.target.value)} /></div>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span>Rental: <b>{money(r * u)}</b></span>
        <Button type="button" size="sm" disabled={!r || !u} onClick={() => onApply(`Vehicle rental (${u} ${unitWord})`, u, r)}>Apply to receipt</Button>
      </div>
    </div>
  );
}
