import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { staff, payrollRuns, staffById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { Banknote, Play } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/payroll")({
  head: () => ({ meta: [{ title: "Payroll — Camauto Rentals" }] }),
  component: PayrollPage,
});

function PayrollPage() {
  const draft = payrollRuns.find(r => r.status === "draft");
  return (
    <div>
      <PageHeader title="Payroll Manager" subtitle="Stripe Connect payouts to your team" action={<Button>+ New Run</Button>} />

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Active staff</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {staff.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{s.fullName}</div>
                <div className="text-xs text-muted-foreground">{s.role} · {s.payType} · {fmtMoney(s.payRate)}{s.payType === "hourly" ? "/hr" : s.payType === "per-vehicle" ? "/veh" : "/wk"}</div>
              </div>
              <StatusBadge status={s.stripeConnected ? "active" : "pending"} />
            </div>
          ))}
        </CardContent>
      </Card>

      {draft && (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Draft run · {draft.id}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{fmtDate(draft.periodStart)} – {fmtDate(draft.periodEnd)}</p>
            </div>
            <StatusBadge status={draft.status} />
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {draft.lines.map((l, idx) => {
                const s = staffById(l.staffId);
                return (
                  <div key={idx} className="grid grid-cols-12 items-center gap-2 p-3 text-sm">
                    <div className="col-span-4 font-medium">{s?.fullName}</div>
                    <div className="col-span-3 text-xs text-muted-foreground">
                      {l.hours > 0 && `${l.hours} hrs`}{l.vehicles > 0 && `${l.vehicles} veh`}{l.hours === 0 && l.vehicles === 0 && "Salary"}
                    </div>
                    <div className="col-span-2 text-right text-muted-foreground">{fmtMoney(l.gross)}</div>
                    <div className="col-span-2 text-right font-semibold">{fmtMoney(l.net)}</div>
                    <div className="col-span-1 text-right"><StatusBadge status={l.status} /></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Total payout</div>
                <div className="text-2xl font-bold">{fmtMoney(draft.totalPayout)}</div>
              </div>
              <Button size="lg" onClick={() => toast.success("Payroll triggered (demo)", { description: "Stripe Connect transfers would fire here." })}>
                <Play className="mr-2 h-4 w-4" />Run Payroll
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Past runs</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {payrollRuns.filter(r => r.status !== "draft").map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{r.id}</span>
                </div>
                <div className="text-xs text-muted-foreground">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{fmtMoney(r.totalPayout)}</span>
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
