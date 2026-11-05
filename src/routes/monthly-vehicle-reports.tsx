import { groupExpenseItems } from "@/lib/grouped-expenses";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportActions } from "@/components/app/ReportActions";
import { Button } from "@/components/ui/button";
import { downloadCSV } from "@/lib/exports";
import { sendVehicleReport } from "@/lib/vehicle-report-send.functions";
import {
  vehicles,
  rentals,
  payments,
  driverById,
  vehicleById,
  fmtMoney,
  fmtDate,
} from "@/lib/mock/data";
import { maintenance } from "@/lib/mock/data";
import { useStoreVersion, extensionIncomeAttribution } from "@/lib/mock/store";
import { getVehicleFinancials } from "@/lib/vehicle-financials";
import { TrendingUp, TrendingDown, Wallet, Printer, Download, Send, Eye } from "lucide-react";
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export const Route = createFileRoute("/monthly-vehicle-reports")({
  head: () => ({ meta: [{ title: "Vehicle Reports — Camauto Rentals" }, { name: "description", content: "Monthly and all-time income, expenses and net per vehicle." }, { property: "og:title", content: "Vehicle Reports — Camauto Rentals" }, { property: "og:description", content: "Monthly and all-time vehicle statements." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MonthlyVehicleReportsPage,
});

const currentMonth = () => new Date().toISOString().slice(0, 7);

const maintenanceById = new Map(maintenance.map((m) => [m.id, m]));

/**
 * For the monthly report, repair/maintenance lines should lead with WHAT WAS
 * REPAIRED (the solution / service performed), not the reported issue.
 * Manual expenses and violations keep their normal "Category — description".
 */
function repairFixLabel(e: {
  id: string;
  category: string;
  description: string;
  source: string;
}): string {
  if (e.source === "repair" || e.source === "maintenance") {
    const m = maintenanceById.get(e.id);
    const fixed =
      m?.diagnosisTitle?.trim() ||
      m?.selectedSolution?.name?.trim() ||
      m?.serviceType?.trim() ||
      e.description;
    return fixed;
  }
  return `${e.category} — ${e.description}`;
}
function monthLabel(ym: string) {
  if (ym === "all") return "All Time";
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function monthBounds(ym: string) {
  if (ym === "all") return { start: "1900-01-01", end: "9999-12-31" };
  return { start: `${ym}-01`, end: `${ym}-31` };
}

interface RenterLine {
  driverId: string;
  name: string;
  startDate: string;
  endDate?: string;
  paid: number;
}
interface ExpenseLine {
  label: string;
  vendor?: string;
  date: string;
  amount: number;
}
interface VehicleReport {
  vehicleId: string;
  title: string;
  plate: string;
  rentalIncome: number;
  extensionIncome: number;
  income: number;
  expenseTotal: number;
  net: number;
  renters: RenterLine[];
  expenseLines: ExpenseLine[];
}

function MonthlyVehicleReportsPage() {
  useStoreVersion();
  const [month, setMonth] = useState<string>(currentMonth());
  const [mode, setMode] = useState<"month" | "all">("month");
  const ym = mode === "all" ? "all" : month;
  const [viewTarget, setViewTarget] = useState<VehicleReport | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [shareTarget, setShareTarget] = useState<VehicleReport | null>(null);

  const reports = useMemo<VehicleReport[]>(() => {
    const { start, end } = monthBounds(ym);
    const inMonth = (d?: string) => !!d && (ym === "all" || d.slice(0, 7) === ym);
    const overlaps = (s: string, e?: string) =>
      s <= end && (!e || e >= start);

    const rentalById = new Map(rentals.map((r) => [r.id, r]));
    // Extension payment ids -> attribute as extension income. Includes
    // payments from paid extension links; pending extensions never reach
    // income. Single source of truth: extensionIncomeAttribution().
    const extensionPaymentIds = extensionIncomeAttribution().extensionPaymentIds;

    const paid = payments.filter(
      (p) => p.status === "paid" && inMonth(p.paidDate ?? p.dueDate),
    );

    return vehicles
      .map((v) => {
        let rentalIncome = 0;
        let extensionIncome = 0;
        const renterMap = new Map<string, RenterLine>();

        // Income from payments tied to this vehicle's rentals
        paid.forEach((p) => {
          const r = rentalById.get(p.rentalId);
          if (!r || r.vehicleId !== v.id) return;
          if (extensionPaymentIds.has(p.id)) extensionIncome += p.amount;
          else rentalIncome += p.amount;
          const d = driverById(r.driverId);
          const key = r.driverId;
          const existing = renterMap.get(key);
          if (existing) existing.paid += p.amount;
          else
            renterMap.set(key, {
              driverId: r.driverId,
              name: d?.fullName ?? "Unknown",
              startDate: r.startDate,
              endDate: r.endDate,
              paid: p.amount,
            });
        });

        // Renters whose rental overlapped the month even without a payment
        rentals.forEach((r) => {
          if (r.vehicleId !== v.id) return;
          if (!overlaps(r.startDate, r.endDate)) return;
          if (renterMap.has(r.driverId)) return;
          const d = driverById(r.driverId);
          renterMap.set(r.driverId, {
            driverId: r.driverId,
            name: d?.fullName ?? "Unknown",
            startDate: r.startDate,
            endDate: r.endDate,
            paid: 0,
          });
        });

        // UNIFIED ENGINE — expenses (manual + repair/maintenance; violations excluded)
        // and income come from getVehicleFinancials so this printable report
        // matches the vehicle's Analytics/P&L tab and the global P&L report.
        const fin = getVehicleFinancials(v.id, { from: start, to: end });
        const expenseLines: ExpenseLine[] = groupExpenseItems(fin.expenseLineItems)
          .map((g) => ({
            label: repairFixLabel({ ...g.items[0], id: g.items[0].groupId ?? g.items[0].id, description: g.name, category: g.isRepair ? "Repair" : g.category }),
            date: g.date,
            amount: g.total,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const income = fin.totalIncome;
        const expenseTotal = fin.totalExpenses;
        const v2 = vehicleById(v.id);
        const title = `${v2?.year ?? ""} ${v2?.make ?? ""} ${v2?.model ?? ""}`.trim();

        return {
          vehicleId: v.id,
          title,
          plate: v.plate,
          rentalIncome,
          extensionIncome,
          income,
          expenseTotal,
          net: income - expenseTotal,
          renters: Array.from(renterMap.values()).sort((a, b) => b.paid - a.paid),
          expenseLines,
        } as VehicleReport;
      })
      .sort((a, b) => b.net - a.net);
  }, [ym]);

  const q = search.trim().toLowerCase();
  const visible = (showAll
    ? reports
    : reports.filter(
        (r) => r.income > 0 || r.expenseTotal > 0 || r.renters.length > 0,
      )).filter((r) => !q || `${r.title} ${r.plate}`.toLowerCase().includes(q));

  const totals = useMemo(() => {
    const income = reports.reduce((s, r) => s + r.income, 0);
    const expense = reports.reduce((s, r) => s + r.expenseTotal, 0);
    return { income, expense, net: income - expense };
  }, [reports]);

  const csv = {
    filename: `vehicle-reports-${ym}.csv`,
    headers: [
      "Vehicle",
      "Plate",
      "Renters",
      "Rental Income",
      "Extension Income",
      "Total Income",
      "Expenses",
      "Net",
    ],
    rows: visible.map((r) => [
      r.title,
      r.plate,
      r.renters.map((x) => x.name).join("; "),
      r.rentalIncome,
      r.extensionIncome,
      r.income,
      r.expenseTotal,
      r.net,
    ]),
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Vehicle Reports" />

      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Period</Label>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {(["month", "all"] as const).map((m) => (
                <Button key={m} size="sm" variant={mode === m ? "default" : "ghost"} onClick={() => setMode(m)}>
                  {m === "month" ? "Monthly" : "All Time"}
                </Button>
              ))}
            </div>
          </div>
          {mode === "month" && (
            <div className="space-y-1.5">
              <Label htmlFor="month">Month</Label>
              <Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} className="w-[170px]" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="vsearch">Search</Label>
            <Input id="vsearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vehicle or plate" className="w-[180px]" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            <Label htmlFor="show-all">Show all vehicles</Label>
          </div>
          <Button variant="outline" size="sm" disabled={!visible.length} onClick={() => printAllReports(visible, ym)}>
            <Printer className="mr-1.5 h-4 w-4" /> Print / PDF all
          </Button>
          <Button variant="outline" size="sm" disabled={!visible.length} onClick={() => { const spec = allDetailCsv(visible, ym); downloadCSV(spec.filename, spec.headers, spec.rows); }}>
            <Download className="mr-1.5 h-4 w-4" /> Detailed CSV
          </Button>
          <ReportActions csv={csv} />
        </div>
      </div>

      <div className="print-only hidden text-lg font-semibold">
        Vehicle Reports — {monthLabel(ym)}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total Income" value={fmtMoney(totals.income)} icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} />
        <SummaryCard label="Total Expenses" value={fmtMoney(totals.expense)} icon={<TrendingDown className="h-4 w-4 text-red-600" />} />
        <SummaryCard label="Net" value={fmtMoney(totals.net)} icon={<Wallet className="h-4 w-4 text-primary" />} />
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No vehicle activity for {monthLabel(ym)}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Vehicle</th>
                  <th className="px-3 py-2">Renters</th>
                  <th className="px-3 py-2 text-right">Income</th>
                  <th className="px-3 py-2 text-right">Expenses</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="no-print px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.vehicleId} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{r.plate}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.renters.length}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.income)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.expenseTotal)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(r.net)}</td>
                    <td className="no-print px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setViewTarget(r)}><Eye className="mr-1 h-4 w-4" />View</Button>
                        <Button size="icon" variant="ghost" title="Print" onClick={() => printVehicleReport(r, ym)}><Printer className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="CSV" onClick={() => { const spec = vehicleCsv(r, ym); downloadCSV(spec.filename, spec.headers, spec.rows); }}><Download className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Send" onClick={() => setShareTarget(r)}><Send className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ViewReportDialog
        report={viewTarget}
        ym={ym}
        onClose={() => setViewTarget(null)}
        onSend={(r) => { setViewTarget(null); setShareTarget(r); }}
      />

      <ShareReportDialog
        report={shareTarget}
        ym={ym}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

function ShareReportDialog({
  report,
  ym,
  onClose,
}: {
  report: VehicleReport | null;
  ym: string;
  onClose: () => void;
}) {
  const send = useServerFn(sendVehicleReport);
  const [channel, setChannel] = useState<"email" | "sms" | "both">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);

  const open = report !== null;

  async function handleSend() {
    if (!report) return;
    if ((channel === "email" || channel === "both") && !email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    if ((channel === "sms" || channel === "both") && !phone.trim()) {
      toast.error("Enter a phone number.");
      return;
    }
    setSending(true);
    try {
      const res = await send({
        data: {
          channel,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          recipientName: name.trim() || undefined,
          subject: `${report.title} (${report.plate}) — ${monthLabel(ym)} Statement`,
          html: buildVehicleReportHtml(report, ym),
          smsText: vehicleReportSmsText(report, ym),
        },
      });
      if (res.errors.length) {
        toast.error(res.errors.join(" "));
      } else {
        const parts: string[] = [];
        if (res.emailSent) parts.push("email");
        if (res.smsSent) parts.push("text");
        toast.success(`Report sent via ${parts.join(" & ")}.`);
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send report</DialogTitle>
          <DialogDescription>
            {report
              ? `${report.title} (${report.plate}) — ${monthLabel(ym)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Send via</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">Text message</SelectItem>
                <SelectItem value="both">Email & Text</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-name">Recipient name (optional)</Label>
            <Input
              id="share-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          {(channel === "email" || channel === "both") && (
            <div className="space-y-1.5">
              <Label htmlFor="share-email">Email</Label>
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
          )}
          {(channel === "sms" || channel === "both") && (
            <div className="space-y-1.5">
              <Label htmlFor="share-phone">Phone</Label>
              <Input
                id="share-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
              <p className="text-xs text-muted-foreground">
                Text messages include a summary; email includes the full report.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            <Send className="mr-1.5 h-4 w-4" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function vehicleCsv(r: VehicleReport, ym: string) {
  const rows: (string | number)[][] = [];
  rows.push(["Section", "Detail", "Date", "Amount"]);
  rows.push(["Income", "Rental", "", r.rentalIncome]);
  if (r.extensionIncome > 0) rows.push(["Income", "Extensions", "", r.extensionIncome]);
  r.renters.forEach((x) =>
    rows.push([
      "Renter",
      `${x.name} (${x.startDate}${x.endDate ? ` – ${x.endDate}` : " – ongoing"})`,
      "",
      x.paid,
    ]),
  );
  r.expenseLines.forEach((e) =>
    rows.push(["Expense", `${e.label}${e.vendor ? ` · ${e.vendor}` : ""}`, e.date, e.amount]),
  );
  rows.push(["Total", "Net", "", r.net]);
  const safe = `${r.title}-${r.plate}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return {
    filename: `vehicle-report-${safe}-${ym}.csv`,
    headers: rows[0] as string[],
    rows: rows.slice(1),
  };
}

function buildVehicleReportHtml(r: VehicleReport, ym: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const renters = r.renters.length
    ? r.renters
        .map(
          (x) =>
            `<li>${esc(x.name)} (${esc(fmtDate(x.startDate))} – ${
              x.endDate ? esc(fmtDate(x.endDate)) : "ongoing"
            })${x.paid > 0 ? ` — ${fmtMoney(x.paid)}` : ""}</li>`,
        )
        .join("")
    : "<li>—</li>";
  const exp = r.expenseLines.length
    ? r.expenseLines
        .map(
          (e) =>
            `<tr><td>${esc(e.label)}${e.vendor ? ` · ${esc(e.vendor)}` : ""}</td><td>${esc(
              fmtDate(e.date),
            )}</td><td style="text-align:right">${fmtMoney(e.amount)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3">—</td></tr>`;
  return `<!doctype html><html><head><title>${esc(r.title)} ${esc(
    r.plate,
  )} — ${esc(monthLabel(ym))}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px;color:#1a1a1a;background:#fff}
      .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:16px;margin-bottom:24px}
      .brand{display:flex;align-items:center;gap:14px}
      .brand img{height:52px;width:auto;object-fit:contain}
      .brand .co{font-size:18px;font-weight:700;letter-spacing:.5px}
      .brand .tag{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1.5px}
      .doc{text-align:right}
      .doc .t{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#444}
      .doc .d{font-size:12px;color:#777;margin-top:2px}
      h1{font-size:22px;margin:0 0 2px}
      .plate{display:inline-block;border:1px solid #ccc;border-radius:4px;padding:2px 8px;font-size:13px;color:#555;font-weight:600;margin-left:8px;vertical-align:middle}
      .net-banner{display:flex;justify-content:space-between;align-items:center;background:#f6f7f9;border-radius:8px;padding:14px 18px;margin:18px 0 26px}
      .net-banner .lbl{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#666}
      .net-banner .val{font-size:24px;font-weight:700}
      .pos{color:#047857}.neg{color:#b91c1c}
      h2{font-size:13px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:1px;color:#111;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td,th{padding:7px 8px}
      tbody tr:nth-child(even){background:#fafafa}
      th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;border-bottom:1px solid #e5e7eb}
      .totals td{font-weight:700;border-top:2px solid #111;font-size:14px}
      ul{margin:0;padding-left:18px;font-size:13px;line-height:1.7}
      .footer{margin-top:36px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#999;text-align:center}
    </style></head><body>
    <div class="header">
      <div class="brand">
        <img src="${CAMAUTO_LOGO_BASE64}" alt="Camauto Rentals" />
        <div>
          <div class="co">Camauto Rentals</div>
          <div class="tag">Vehicle Performance Report</div>
        </div>
      </div>
      <div class="doc">
        <div class="t">${ym === "all" ? "All-Time Statement" : "Monthly Statement"}</div>
        <div class="d">${esc(monthLabel(ym))}</div>
      </div>
    </div>
    <h1>${esc(r.title)}<span class="plate">${esc(r.plate)}</span></h1>
    <div class="net-banner">
      <span class="lbl">Net for ${esc(monthLabel(ym))}</span>
      <span class="val ${r.net >= 0 ? "pos" : "neg"}">${fmtMoney(r.net)}</span>
    </div>
    <h2>Income · ${fmtMoney(r.income)}</h2>
    <table><tbody><tr><td>Rental</td><td style="text-align:right">${fmtMoney(r.rentalIncome)}</td></tr>
    ${r.extensionIncome > 0 ? `<tr><td>Extensions</td><td style="text-align:right">${fmtMoney(r.extensionIncome)}</td></tr>` : ""}</tbody></table>
    <h2>Renters</h2><ul>${renters}</ul>
    <h2>Expenses · ${fmtMoney(r.expenseTotal)}</h2>
    <table><thead><tr><th>Item</th><th>Date</th><th style="text-align:right">Amount</th></tr></thead><tbody>${exp}</tbody></table>
    <table class="totals"><tbody><tr><td>Net</td><td style="text-align:right" class="${r.net >= 0 ? "pos" : "neg"}">${fmtMoney(r.net)}</td></tr></tbody></table>
    <div class="footer">Camauto Rentals · Generated ${esc(fmtDate(new Date().toISOString().slice(0, 10)))} · Confidential</div>
    </body></html>`;
}

function vehicleReportSmsText(r: VehicleReport, ym: string): string {
  return [
    `Camauto Rentals — ${r.title} (${r.plate})`,
    `${monthLabel(ym)} statement`,
    `Income: ${fmtMoney(r.income)}`,
    `Expenses: ${fmtMoney(r.expenseTotal)}`,
    `Net: ${fmtMoney(r.net)}`,
  ].join("\n");
}

function printVehicleReport(r: VehicleReport, ym: string) {
  if (typeof window === "undefined") return;
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(buildVehicleReportHtml(r, ym));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function ViewReportDialog({ report, ym, onClose, onSend }: { report: VehicleReport | null; ym: string; onClose: () => void; onSend: (r: VehicleReport) => void }) {
  return (
    <Dialog open={report !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {report && (
          <>
            <DialogHeader>
              <DialogTitle>{report.title} <span className="text-sm font-normal text-muted-foreground">{report.plate}</span></DialogTitle>
              <DialogDescription>{monthLabel(ym)} statement</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Income</div><div className="font-semibold">{fmtMoney(report.income)}</div></div>
              <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Expenses</div><div className="font-semibold">{fmtMoney(report.expenseTotal)}</div></div>
              <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Net</div><div className={`font-semibold ${report.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(report.net)}</div></div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="font-medium">Income</div>
              <Row label="Rental" value={fmtMoney(report.rentalIncome)} />
              {report.extensionIncome > 0 && <Row label="Extensions" value={fmtMoney(report.extensionIncome)} />}
            </div>
            <div className="text-sm">
              <div className="mb-1 font-medium">Renters</div>
              {report.renters.length === 0 ? <div className="text-muted-foreground">—</div> : (
                <table className="w-full"><tbody>
                  {report.renters.map((x) => (
                    <tr key={x.driverId} className="border-b border-border last:border-0">
                      <td className="py-1">{x.name}</td>
                      <td className="py-1 text-muted-foreground">{fmtDate(x.startDate)} – {x.endDate ? fmtDate(x.endDate) : "ongoing"}</td>
                      <td className="py-1 text-right">{fmtMoney(x.paid)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </div>
            <div className="text-sm">
              <div className="mb-1 font-medium">Expenses</div>
              {report.expenseLines.length === 0 ? <div className="text-muted-foreground">—</div> : (
                <table className="w-full"><tbody>
                  {report.expenseLines.map((e, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-1">{e.label}</td>
                      <td className="py-1 text-muted-foreground">{fmtDate(e.date)}</td>
                      <td className="py-1 text-right">{fmtMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { const spec = vehicleCsv(report, ym); downloadCSV(spec.filename, spec.headers, spec.rows); }}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
              <Button variant="outline" onClick={() => onSend(report)}><Send className="mr-1.5 h-4 w-4" />Send</Button>
              <Button onClick={() => printVehicleReport(report, ym)}><Printer className="mr-1.5 h-4 w-4" />Print / PDF</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function allDetailCsv(list: VehicleReport[], ym: string) {
  const rows: (string | number)[][] = [];
  list.forEach((r) => {
    const one = vehicleCsv(r, ym);
    one.rows.forEach((row) => rows.push([`${r.title} ${r.plate}`, ...row]));
  });
  return { filename: `vehicle-reports-detailed-${ym}.csv`, headers: ["Vehicle", "Section", "Detail", "Date", "Amount"], rows };
}

function printAllReports(list: VehicleReport[], ym: string) {
  if (typeof window === "undefined") return;
  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) return;
  const pages = list.map((r) => {
    const html = buildVehicleReportHtml(r, ym);
    const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
    return `<section style="page-break-after:always">${body}</section>`;
  });
  const first = buildVehicleReportHtml(list[0], ym);
  const head = first.slice(0, first.indexOf("<body>")).replace(/<title>[\s\S]*?<\/title>/, `<title>Vehicle Reports — ${monthLabel(ym)}</title>`);
  w.document.write(`${head}<body>${pages.join("")}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
