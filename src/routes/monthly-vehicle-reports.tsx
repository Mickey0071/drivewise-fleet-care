import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ReportActions } from "@/components/app/ReportActions";
import { Button } from "@/components/ui/button";
import { downloadCSV } from "@/lib/exports";
import {
  vehicles,
  rentals,
  payments,
  driverById,
  vehicleById,
  expenses,
  maintenance,
  fmtMoney,
  fmtDate,
} from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { getVehicleFinancials } from "@/lib/vehicle-financials";
import { TrendingUp, TrendingDown, Wallet, Printer, Download } from "lucide-react";
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export const Route = createFileRoute("/monthly-vehicle-reports")({
  head: () => ({ meta: [{ title: "Monthly Vehicle Reports — Camauto Rentals" }] }),
  component: MonthlyVehicleReportsPage,
});

const currentMonth = () => new Date().toISOString().slice(0, 7);
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function monthBounds(ym: string) {
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
  const [ym, setYm] = useState<string>(currentMonth());
  const [showAll, setShowAll] = useState(false);

  const reports = useMemo<VehicleReport[]>(() => {
    const { start, end } = monthBounds(ym);
    const inMonth = (d?: string) => !!d && d.slice(0, 7) === ym;
    const overlaps = (s: string, e?: string) =>
      s <= end && (!e || e >= start);

    const rentalById = new Map(rentals.map((r) => [r.id, r]));
    // Extension payment ids -> attribute as extension income
    const extensionPaymentIds = new Set<string>();
    rentals.forEach((r) =>
      r.extensions?.forEach((e) => {
        if (e.paymentId) extensionPaymentIds.add(e.paymentId);
      }),
    );

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

        // UNIFIED ENGINE — expenses (manual + repair/maintenance + violations)
        // and income come from getVehicleFinancials so this printable report
        // matches the vehicle's Analytics/P&L tab and the global P&L report.
        const fin = getVehicleFinancials(v.id, { from: start, to: end });
        const expenseLines: ExpenseLine[] = fin.expenseLineItems
          .map((e) => ({
            label: `${e.category} — ${e.description}`,
            date: e.date,
            amount: e.amount,
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

  const visible = showAll
    ? reports
    : reports.filter(
        (r) => r.income > 0 || r.expenseTotal > 0 || r.renters.length > 0,
      );

  const totals = useMemo(() => {
    const income = reports.reduce((s, r) => s + r.income, 0);
    const expense = reports.reduce((s, r) => s + r.expenseTotal, 0);
    return { income, expense, net: income - expense };
  }, [reports]);

  const csv = {
    filename: `monthly-vehicle-report-${ym}.csv`,
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
      <PageHeader title="Monthly Vehicle Reports" />

      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="month">Month</Label>
          <Input
            id="month"
            type="month"
            value={ym}
            onChange={(e) => setYm(e.target.value || currentMonth())}
            className="w-[180px]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            <Label htmlFor="show-all">Show all vehicles</Label>
          </div>
          <ReportActions csv={csv} />
        </div>
      </div>

      <div className="print-only hidden text-lg font-semibold">
        Monthly Vehicle Report — {monthLabel(ym)}
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
        <div className="space-y-4">
          {visible.map((r) => (
            <Card key={r.vehicleId}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">
                  {r.title}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {r.plate}
                  </span>
                </CardTitle>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Net</div>
                  <div className={`text-lg font-semibold ${r.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(r.net)}
                  </div>
                </div>
                <div className="no-print flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const spec = vehicleCsv(r, ym);
                      downloadCSV(spec.filename, spec.headers, spec.rows);
                    }}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => printVehicleReport(r, ym)}>
                    <Printer className="mr-1.5 h-4 w-4" />
                    Print
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-3">
                <div>
                  <div className="mb-2 text-sm font-medium">
                    Income · {fmtMoney(r.income)}
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <Row label="Rental" value={fmtMoney(r.rentalIncome)} />
                    {r.extensionIncome > 0 && (
                      <Row label="Extensions" value={fmtMoney(r.extensionIncome)} />
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Renters</div>
                  {r.renters.length === 0 ? (
                    <div className="text-sm text-muted-foreground">—</div>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {r.renters.map((x) => (
                        <li key={x.driverId} className="text-muted-foreground">
                          <span className="text-foreground">{x.name}</span>{" "}
                          ({fmtDate(x.startDate)} – {x.endDate ? fmtDate(x.endDate) : "ongoing"})
                          {x.paid > 0 && <> — {fmtMoney(x.paid)}</>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">
                    Expenses · {fmtMoney(r.expenseTotal)}
                  </div>
                  {r.expenseLines.length === 0 ? (
                    <div className="text-sm text-muted-foreground">—</div>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {r.expenseLines.map((e, i) => (
                        <li key={i} className="flex justify-between gap-2 text-muted-foreground">
                          <span className="truncate">
                            {e.label}
                            {e.vendor ? ` · ${e.vendor}` : ""}
                          </span>
                          <span className="shrink-0 text-foreground">{fmtMoney(e.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
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

function printVehicleReport(r: VehicleReport, ym: string) {
  if (typeof window === "undefined") return;
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
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${esc(r.title)} ${esc(
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
        <div class="t">Monthly Statement</div>
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
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}