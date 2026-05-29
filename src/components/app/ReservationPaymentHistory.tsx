import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, CreditCard, Link2, Banknote, ShieldAlert, CalendarPlus, Receipt } from "lucide-react";
import { payments, violations, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";
import type { Rental, Payment, Violation } from "@/lib/mock/data";

type RowType = "rental" | "violation" | "extension";
type RowStatus = "paid" | "pending" | "failed";

interface HistoryRow {
  id: string;
  date: string;
  amount: number;
  type: RowType;
  source: string;
  status: RowStatus;
  method?: string;
  stripeId?: string;
  payment?: Payment;
  violation?: Violation;
}

const FILTERS: { key: "all" | RowType; label: string }[] = [
  { key: "all", label: "All Payments" },
  { key: "rental", label: "Rental" },
  { key: "violation", label: "Violations" },
  { key: "extension", label: "Extensions" },
];

function sourceFromMethod(method?: string, last4?: string): string {
  switch (method) {
    case "card":
      return last4 ? `Card •••• ${last4}` : "Card";
    case "Stripe":
      return "Stripe (Payment Link)";
    case "cash":
      return "Manual (cash)";
    case "Zelle":
      return "Manual (Zelle)";
    default:
      return "Manual";
  }
}

function mapStatus(s: string): RowStatus {
  if (s === "paid") return "paid";
  if (s === "missed") return "failed";
  return "pending";
}

export function ReservationPaymentHistory({ rental }: { rental: Rental }) {
  const [filter, setFilter] = useState<"all" | RowType>("all");
  const [selected, setSelected] = useState<HistoryRow | null>(null);

  const driver = driverById(rental.driverId);
  const last4 = (driver as { card_last4?: string } | undefined)?.card_last4;

  const rows = useMemo<HistoryRow[]>(() => {
    const sched = payments.filter((p) => p.rentalId === rental.id);
    const extPaymentIds = new Set(
      (rental.extensions ?? []).map((e) => e.paymentId).filter(Boolean) as string[],
    );

    const paymentRows: HistoryRow[] = sched.map((p) => {
      const isExt = extPaymentIds.has(p.id);
      return {
        id: p.id,
        date: p.paidDate ?? p.dueDate,
        amount: Number(p.amount || 0),
        type: isExt ? "extension" : "rental",
        source: sourceFromMethod(p.method, last4),
        status: mapStatus(p.status),
        method: p.method,
        payment: p,
      };
    });

    // Extensions without a linked payment record (still show them)
    const extraExtRows: HistoryRow[] = (rental.extensions ?? [])
      .filter((e) => !e.paymentId)
      .map((e) => ({
        id: e.id,
        date: e.extendedAt?.slice(0, 10) ?? rental.startDate,
        amount: Number(e.additionalAmount || 0),
        type: "extension" as RowType,
        source: "Extension charge",
        status: "paid" as RowStatus,
      }));

    const rentalEnd = rental.endDate ?? new Date().toISOString().slice(0, 10);
    const violationRows: HistoryRow[] = violations
      .filter(
        (x) =>
          x.vehicleId === rental.vehicleId &&
          x.driverId === rental.driverId &&
          x.dateIssued >= rental.startDate &&
          x.dateIssued <= rentalEnd,
      )
      .map((x) => ({
        id: x.id,
        date: x.dateIssued,
        amount: Number(x.amount || 0),
        type: "violation" as RowType,
        source: "Violation charge",
        status: x.status === "paid" ? "paid" : "pending",
        violation: x,
      }));

    return [...paymentRows, ...extraExtRows, ...violationRows].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [rental, last4]);

  const visible = filter === "all" ? rows.filter((r) => r.type === "rental") : rows.filter((r) => r.type === filter);
  const total = visible
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + r.amount, 0);

  function typeIcon(t: RowType) {
    if (t === "violation") return <ShieldAlert className="h-4 w-4 text-muted-foreground" />;
    if (t === "extension") return <CalendarPlus className="h-4 w-4 text-muted-foreground" />;
    return <CreditCard className="h-4 w-4 text-muted-foreground" />;
  }

  function sourceIcon(source: string) {
    if (source.startsWith("Card")) return <CreditCard className="h-3.5 w-3.5" />;
    if (source.startsWith("Stripe")) return <Link2 className="h-3.5 w-3.5" />;
    if (source.startsWith("Manual")) return <Banknote className="h-3.5 w-3.5" />;
    return <Receipt className="h-3.5 w-3.5" />;
  }

  function exportCsv() {
    const header = ["Date", "Amount", "Source", "Type", "Status"];
    const lines = rows.map((r) =>
      [fmtDate(r.date), r.amount.toFixed(2), r.source, r.type, r.status]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-history-${rental.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Payment history
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-sm text-muted-foreground">No payments to show.</div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((r) => (
            <li key={`${r.type}-${r.id}`}>
              <button
                onClick={() => setSelected(r)}
                className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {typeIcon(r.type)}
                  <div className="min-w-0">
                    <div className="font-medium">{fmtMoney(r.amount)}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {sourceIcon(r.source)}
                      <span className="truncate">{r.source}</span>
                      <span>· {fmtDate(r.date)}</span>
                    </div>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted-foreground">Total paid ({filter})</span>
        <span className="font-semibold">{fmtMoney(total)}</span>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Payment details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <DetailRow label="Amount" value={fmtMoney(selected.amount)} />
              <DetailRow label="Date" value={fmtDate(selected.date)} />
              <DetailRow
                label="For"
                value={
                  selected.type === "violation"
                    ? "Violation"
                    : selected.type === "extension"
                      ? "Rental extension"
                      : "Rental"
                }
              />
              <DetailRow label="Source" value={selected.source} />
              <DetailRow
                label="Status"
                value={
                  selected.status === "paid"
                    ? "Paid ✓"
                    : selected.status === "failed"
                      ? "Failed"
                      : "Pending"
                }
              />
              <DetailRow
                label="Stripe transaction"
                value={selected.stripeId ?? (selected.source.includes("Stripe") || selected.source.startsWith("Card") ? "On file (Stripe)" : "—")}
              />
              <DetailRow
                label="Receipt"
                value={
                  rental.receiptPdfUrl && selected.type === "rental"
                    ? "Available"
                    : selected.status === "paid"
                      ? "Recorded"
                      : "—"
                }
                action={
                  rental.receiptPdfUrl && selected.type === "rental" ? (
                    <a
                      href={rental.receiptPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline"
                    >
                      View receipt
                    </a>
                  ) : undefined
                }
              />
              <DetailRow
                label="Confirmation email"
                value={selected.status === "paid" ? `Sent to ${driver?.email ?? "renter"}` : "Not sent"}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">
        {value}
        {action ? <div className="mt-0.5">{action}</div> : null}
      </span>
    </div>
  );
}