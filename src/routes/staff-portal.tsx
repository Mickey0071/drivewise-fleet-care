import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { payrollRuns, staff, fmtDate, fmtMoney } from "@/lib/mock/data";

export const Route = createFileRoute("/staff-portal")({
  head: () => ({ meta: [{ title: "Staff Portal — Camauto Rentals" }] }),
  component: StaffPortalPage,
});

function StaffPortalPage() {
  // Demo: show as Mia Cortez
  const me = staff.find(s => s.id === "S-02")!;
  const myStubs = payrollRuns.map(r => ({
    run: r, line: r.lines.find(l => l.staffId === me.id)!,
  }));

  return (
    <div>
      <PageHeader title="Staff Portal" subtitle={`Welcome, ${me.fullName}`} />

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Direct deposit</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm">Stripe Express account</div>
            <div className="text-xs text-muted-foreground">{me.stripeConnected ? "Linked · payouts active" : "Not linked yet"}</div>
          </div>
          {me.stripeConnected
            ? <StatusBadge status="active" />
            : <Button>Connect bank with Stripe</Button>}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Pay stubs</h2>
      <div className="space-y-3">
        {myStubs.map(({ run, line }) => (
          <Card key={run.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {line.hours > 0 ? `${line.hours} hours logged` : line.vehicles > 0 ? `${line.vehicles} vehicles handled` : "Salaried"}
                  </div>
                </div>
                <StatusBadge status={line.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Gross</span><div className="font-medium">{fmtMoney(line.gross)}</div></div>
                <div><span className="text-muted-foreground">Net</span><div className="font-bold text-success">{fmtMoney(line.net)}</div></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
