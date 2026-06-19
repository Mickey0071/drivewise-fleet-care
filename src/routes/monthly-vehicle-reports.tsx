import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ReportActions } from "@/components/app/ReportActions";
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
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";

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

        // Expenses tagged to this vehicle
        const expenseLines: ExpenseLine[] = [];
        expenses.forEach((e) => {
          if (e.vehicleId !== v.id || !inMonth(e.date)) return;
          expenseLines.push({
            label: e.category,
            vendor: e.vendor,
            date: e.date,
            amount: e.amount,
          });
        });
        // Maintenance / repair costs for this vehicle
        maintenance.forEach((m) => {
          const date = m.completionDate ?? m.dateCompleted;
          if (m.vehicleId !== v.id || !inMonth(date)) return;
          if (!m.cost) return;
          expenseLines.push({
            label: m.serviceType || "Maintenance",
            vendor: m.vendor,
            date: date ?? "",
            amount: m.cost,
          });
        });
        expenseLines.sort((a, b) => a.date.localeCompare(b.date));

        const income = rentalIncome + extensionIncome;
        const expenseTotal = expenseLines.reduce((s, e) => s + e.amount, 0);
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