import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Save, Trash2, Search, FileText } from "lucide-react";
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
import { BRAND } from "@/lib/branding";
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
          subtitle="Reservation and manual receipts with NJ sales tax"
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="print:hidden"><CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Customer name</Label><Input value={draft.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></div>
                <div><Label>Phone</Label><Input value={draft.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} /></div>
                <div><Label>Email</Label><Input value={draft.customer_email} onChange={(e) => set("customer_email", e.target.value)} /></div>
                <div><Label>Vehicle</Label><Input placeholder="2016 Hyundai Sonata · ABC123" value={draft.vehicle_label} onChange={(e) => set("vehicle_label", e.target.value)} /></div>
                <div><Label>Receipt date</Label><Input type="date" value={draft.receipt_date} onChange={(e) => set("receipt_date", e.target.value)} /></div>
                <div><Label>Tax rate (%)</Label><Input type="number" step="0.001" value={draft.tax_rate} onChange={(e) => set("tax_rate", Number(e.target.value))} /></div>
                <div><Label>Rental start</Label><Input type="date" value={draft.period_start} onChange={(e) => set("period_start", e.target.value)} /></div>
                <div><Label>Rental end</Label><Input type="date" value={draft.period_end} onChange={(e) => set("period_end", e.target.value)} /></div>
              </div>
              <div>
                <Label>Line items</Label>
                <div className="mt-1 space-y-2">
                  {draft.items.map((it, i) => (
                    <div key={i} className="grid grid-cols-12 items-center gap-1">
                      <Input className="col-span-5" placeholder="Description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                      <Input className="col-span-2" type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} />
                      <Input className="col-span-3" type="number" step="0.01" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} />
                      <label className="col-span-1 flex items-center justify-center" title="Taxable">
                        <Checkbox checked={it.taxable} onCheckedChange={(c) => setItem(i, { taxable: !!c })} />
                      </label>
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => set("items", draft.items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Description · Qty · Price · Taxable</p>
                  <Button size="sm" variant="outline" onClick={() => set("items", [...draft.items, { description: "", quantity: 1, unitPrice: 0, taxable: true }])}><Plus className="mr-1 h-4 w-4" />Add item</Button>
                </div>
              </div>
              <div><Label>Amount paid</Label><Input type="number" step="0.01" value={draft.amount_paid} onChange={(e) => set("amount_paid", Number(e.target.value))} /></div>
              <div><Label>Notes</Label><Textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}><Save className="mr-1 h-4 w-4" />{draft.id ? "Update" : "Save"}</Button>
                <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
              </div>
            </CardContent></Card>

            <Card className="print:border-0 print:shadow-none"><CardContent className="p-6 text-sm" id="receipt-print">
              <div className="flex items-start justify-between border-b pb-3">
                <div>
                  <div className="text-lg font-bold">{BRAND?.companyName ?? "Camauto Rentals"}</div>
                  <div className="text-xs text-muted-foreground">Receipt</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-semibold">{draft.receipt_number ?? "Draft"}</div>
                  <div>{draft.receipt_date}</div>
                  {draft.rental_id && <div>Reservation {draft.rental_id}</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 py-3 text-xs">
                <div><div className="font-semibold">Customer</div><div>{draft.customer_name || "—"}</div><div>{draft.customer_phone}</div><div>{draft.customer_email}</div></div>
                <div><div className="font-semibold">Vehicle</div><div>{draft.vehicle_label || "—"}</div>
                  {(draft.period_start || draft.period_end) && <div>{draft.period_start} – {draft.period_end}</div>}</div>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left"><th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {draft.items.map((it, i) => (
                    <tr key={i} className="border-b border-dashed">
                      <td className="py-1">{it.description}{!it.taxable && <span className="text-muted-foreground"> (non-taxable)</span>}</td>
                      <td className="text-right">{it.quantity}</td>
                      <td className="text-right">{money(it.unitPrice)}</td>
                      <td className="text-right">{money(it.quantity * it.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto mt-3 w-60 space-y-1 text-xs">
                <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span>NJ sales tax ({draft.tax_rate}% on {money(totals.taxableBase)})</span><span>{money(totals.tax)}</span></div>
                <div className="flex justify-between border-t pt-1 text-sm font-bold"><span>Total</span><span>{money(totals.total)}</span></div>
                <div className="flex justify-between"><span>Paid</span><span>{money(draft.amount_paid)}</span></div>
                <div className="flex justify-between font-semibold"><span>Balance</span><span>{money(totals.balance)}</span></div>
              </div>
              {draft.notes && <p className="mt-4 whitespace-pre-wrap text-xs">{draft.notes}</p>}
              <p className="mt-6 text-center text-[10px] text-muted-foreground">Thank you for renting with us.</p>
            </CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
