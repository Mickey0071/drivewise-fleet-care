// Per-vehicle analytics — same money rules as the P&L dashboard breakdown.
import { activeVehicles as getActiveFleet } from "@/lib/mock/store";
import { payments, expenses, maintenance, rentals, vehicleById } from "@/lib/mock/data";
import { repairCost, isRepairCost, countableExpenses } from "@/lib/money-rules";

export type VAPeriod = "lifetime" | "year" | "month";
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00");
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
const inRange = (d: string | undefined, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export interface VARow { id: string; label: string; daysRented: number; utilization: number; rev: number; exp: number; net: number }

export function periodRange(p: VAPeriod): { from: string; to: string } {
  const now = new Date();
  const today = iso(now);
  if (p === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (p === "year") return { from: `${now.getFullYear()}-01-01`, to: today };
  const dates = [
    ...rentals.map(r => r.startDate), ...payments.map(p => p.paidDate),
    ...expenses.map(e => e.date), ...maintenance.map(m => m.dateCompleted),
  ].filter(Boolean).map(d => d!.slice(0, 10)).sort();
  return { from: dates[0] && dates[0] < today ? dates[0] : today, to: "9999-12-31" };
}

export function periodLabel(p: VAPeriod): string {
  const now = new Date();
  if (p === "lifetime") return "All Time";
  if (p === "year") return `January 1 – ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

export function periodFileTag(p: VAPeriod): string {
  const now = new Date();
  if (p === "lifetime") return "AllTime";
  if (p === "year") return `YTD${now.getFullYear()}`;
  return `${MONTHS[now.getMonth()].slice(0, 3)}${now.getFullYear()}`;
}

function label(id: string) {
  const v = vehicleById(id);
  if (!v) return id;
  return `${v.year} ${v.make} ${v.model}`.trim() || (v.plate ?? id);
}

export function computeVehicleAnalytics(p: VAPeriod): VARow[] {
  const { from, to } = periodRange(p);
  const today = iso(new Date());
  const periodDays = Math.max(1, daysBetween(from, to > today ? today : to) + 1);
  const paid = payments.filter(x => x.status === "paid" && inRange(x.paidDate, from, to));
  const periodExpenses = expenses.filter(e => inRange(e.date, from, to));
  const countable = countableExpenses(periodExpenses, maintenance);
  const rentalVehicle = new Map(rentals.map(r => [r.id, r.vehicleId]));
  const rows = getActiveFleet().map(v => {
    const rev = paid.filter(x => rentalVehicle.get(x.rentalId) === v.id).reduce((s, x) => s + (x.amount || 0), 0);
    const exp = countable.filter(e => e.vehicleId === v.id).reduce((s, e) => s + (e.amount || 0), 0)
      + maintenance.filter(m => m.vehicleId === v.id && isRepairCost(m) && !!m.dateCompleted && inRange(m.dateCompleted, from, to))
        .reduce((s, m) => s + repairCost(m), 0);
    let daysRented = 0;
    rentals.filter(r => r.vehicleId === v.id && r.startDate).forEach(r => {
      const rs = r.startDate.slice(0, 10);
      const re = r.returnedAt?.slice(0, 10) || r.endDate || today;
      const s = rs > from ? rs : from;
      const e = re < to ? re : to;
      if (e >= s) daysRented += daysBetween(s, e) + 1;
    });
    return { id: v.id, label: label(v.id), daysRented, utilization: Math.min(100, (daysRented / periodDays) * 100), rev, exp, net: rev - exp };
  });
  return rows.filter(r => r.rev > 0 || r.daysRented > 0 || r.exp > 0).sort((a, b) => b.net - a.net);
}
