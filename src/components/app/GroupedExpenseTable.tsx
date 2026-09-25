import type { ReactNode } from "react";
import type { FinancialExpenseItem } from "@/lib/vehicle-financials";
import { groupExpenseItems, groupedTotals, type GroupedExpenseRow } from "@/lib/grouped-expenses";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmt = (d: string) => {
  if (!d) return "—";
  const dt = new Date(`${d.slice(0, 10)}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function GroupedExpenseTable({
  items,
  actions,
}: {
  items: FinancialExpenseItem[];
  actions?: (row: GroupedExpenseRow) => ReactNode;
}) {
  const rows = groupExpenseItems(items);
  if (rows.length === 0) return <p className="py-4 text-sm text-muted-foreground">No records.</p>;
  const t = groupedTotals(rows);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-muted-foreground">
            <th className="py-2 text-left font-medium">Repair</th>
            <th className="py-2 text-right font-medium">Parts</th>
            <th className="py-2 text-right font-medium">Labor</th>
            <th className="py-2 text-right font-medium">Total</th>
            {actions && <th className="w-20" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0 align-top">
              <td className="py-2 pr-3">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {fmt(r.date)}
                  {r.vendor ? ` · ${r.vendor}` : ""}
                  {!r.isRepair && r.category ? ` · ${r.category}` : ""}
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">{r.parts == null ? "—" : money(r.parts)}</td>
              <td className="py-2 text-right tabular-nums">{r.labor == null ? "—" : money(r.labor)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{money(r.total)}</td>
              {actions && <td className="py-1 text-right">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-2">Total — {t.repairs} repair{t.repairs === 1 ? "" : "s"}{t.count > t.repairs ? `, ${t.count - t.repairs} other` : ""}</td>
            <td className="py-2 text-right tabular-nums">{money(t.parts)}</td>
            <td className="py-2 text-right tabular-nums">{money(t.labor)}</td>
            <td className="py-2 text-right tabular-nums">{money(t.grand)}</td>
            {actions && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
