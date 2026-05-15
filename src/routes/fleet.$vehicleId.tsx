import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { vehicleById, rentals, maintenance, violations, inspections, payments, driverById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useState } from "react";
import { ArrowLeft, Link2 } from "lucide-react";
import { toast } from "sonner";

const REPAIR_KEYWORDS = ["brake", "transmission", "repair", "pads", "engine", "battery", "tire", "body", "glass", "diagnostic"];

export const Route = createFileRoute("/fleet/$vehicleId")({
  component: VehicleDetail,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
});

function VehicleDetail() {
  const { vehicleId } = Route.useParams();
  const { tab } = Route.useSearch();
  const v = vehicleById(vehicleId);
  const [reserveOpen, setReserveOpen] = useState(false);
  if (!v) return <div className="text-muted-foreground">Vehicle not found.</div>;

  const vRentals = rentals.filter(r => r.vehicleId === v.id);
  const vMx = maintenance.filter(m => m.vehicleId === v.id);
  const vRepairs = vMx.filter(m => REPAIR_KEYWORDS.some(keyword => m.serviceType.toLowerCase().includes(keyword)));
  const vViol = violations.filter(x => x.vehicleId === v.id);
  const vInsp = inspections.filter(i => i.vehicleId === v.id);
  const rentalIds = new Set(vRentals.map(r => r.id));
  const vPayments = payments.filter(p => rentalIds.has(p.rentalId));

  const incomeTotal = vPayments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const maintenanceTotal = vMx.reduce((s, m) => s + m.cost, 0);
  const violationTotal = vViol.reduce((s, x) => s + x.amount, 0);
  const expenseTotal = maintenanceTotal + violationTotal;
  const netTotal = incomeTotal - expenseTotal;
  const activeRental = vRentals.find(r => !r.endDate) ?? vRentals[0];
  const activeDriver = activeRental ? driverById(activeRental.driverId) : null;
  const isCurrentlyRented = v.status === "rented" && !!activeRental && !activeRental.endDate;
  const nextDue = vPayments.find(p => p.status !== "paid");

  const uniqueRenters = Array.from(new Map(vRentals.map(r => [r.driverId, driverById(r.driverId)])).entries())
    .map(([driverId, driver]) => {
      const rs = vRentals.filter(r => r.driverId === driverId);
      const totalPaid = vPayments.filter(p => p.driverId === driverId && p.status === "paid").reduce((s, p) => s + p.amount, 0);
      return { driverId, driver, count: rs.length, firstStart: rs.map(r => r.startDate).sort()[0], totalPaid };
    });

  const slug = `${v.id}-${v.plate}`.replace(/\s+/g, "_");

  return (
    <div>
      <Button variant="outline" size="sm" asChild className="mb-3">
        <Link to="/fleet"><ArrowLeft className="mr-1 h-4 w-4" />Back to Fleet</Link>
      </Button>
      <div className="mb-4 overflow-hidden rounded-xl border border-border bg-muted">
        <img
          src={carImage(v.model)}
          alt={`${v.year} ${v.make} ${v.model}`}
          width={800}
          height={512}
          className="aspect-[21/9] w-full object-cover"
        />
      </div>
      <PageHeader
        title={`${v.year} ${v.make} ${v.model}`}
        subtitle={`${v.id} · Plate ${v.plate} · VIN ${v.vin}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={v.status} />
            <Button
              size="sm"
              disabled={v.status !== "available"}
              onClick={() => setReserveOpen(true)}
            >
              Reserve
            </Button>
            <ReportActions
              csvs={[
                {
                  filename: `${slug}-income.csv`,
                  headers: ["Payment ID", "Rental", "Driver", "Amount", "Due", "Paid", "Status", "Method"],
                  rows: vPayments.map(p => [p.id, p.rentalId, driverById(p.driverId)?.fullName ?? p.driverId, p.amount, p.dueDate, p.paidDate ?? "", p.status, p.method ?? ""]),
                },
                {
                  filename: `${slug}-expenses.csv`,
                  headers: ["Type", "ID", "Description", "Date", "Amount", "Vendor/Status"],
                  rows: [
                    ...vMx.map(m => ["maintenance", m.id, m.serviceType, m.dateCompleted, m.cost, m.vendor] as const),
                    ...vViol.map(x => ["violation", x.id, x.type, x.dateIssued, x.amount, x.status] as const),
                  ].map(r => [...r]),
                },
                {
                  filename: `${slug}-maintenance.csv`,
                  headers: ["ID", "Service", "Date", "Vendor", "Mileage", "Cost", "Next due"],
                  rows: vMx.map(m => [m.id, m.serviceType, m.dateCompleted, m.vendor, m.mileageAtService, m.cost, m.nextServiceDue]),
                },
                {
                  filename: `${slug}-repair-history.csv`,
                  headers: ["ID", "Repair", "Date", "Vendor", "Mileage", "Cost", "Notes"],
                  rows: vRepairs.map(m => [m.id, m.serviceType, m.dateCompleted, m.vendor, m.mileageAtService, m.cost, m.notes ?? ""]),
                },
                {
                  filename: `${slug}-rentals.csv`,
                  headers: ["Rental ID", "Driver", "Start", "End", "Weekly rate", "Deposit", "Status"],
                  rows: vRentals.map(r => [r.id, driverById(r.driverId)?.fullName ?? r.driverId, r.startDate, r.endDate ?? "", r.weeklyRate, r.depositPaid, r.paymentStatus]),
                },
              ]}
            />
          </div>
        }
      />

      {isCurrentlyRented && activeDriver && (
        <Card className="mb-4 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Currently rented to</div>
              <div className="mt-1 text-lg font-semibold">{activeDriver.fullName}</div>
              <div className="text-xs text-muted-foreground">
                Since {fmtDate(activeRental.startDate)} · {fmtMoney(activeRental.weeklyRate)}/wk · Deposit {fmtMoney(activeRental.depositPaid)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Next payment</div>
              {nextDue ? (
                <>
                  <div className="mt-1 font-semibold">{fmtMoney(nextDue.amount)}</div>
                  <div className="text-xs text-muted-foreground">due {fmtDate(nextDue.dueDate)}</div>
                </>
              ) : <div className="mt-1 text-sm text-muted-foreground">All paid</div>}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={tab ?? "overview"} className="mt-2">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics / P&amp;L</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="repairs">Repair History</TabsTrigger>
          <TabsTrigger value="renters">Renter History ({uniqueRenters.length})</TabsTrigger>
          <TabsTrigger value="other">Violations &amp; Inspections</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Vehicle description</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <Field label="Make / Model" value={`${v.make} ${v.model}`} />
              <Field label="Year" value={String(v.year)} />
              <Field label="VIN" value={v.vin} />
              <Field label="Plate" value={v.plate} />
              <Field label="Mileage" value={`${v.mileage.toLocaleString()} mi`} />
              <Field label="Risk tier" value={v.riskTier} />
              <Field label="Daily rate" value={fmtMoney(v.dailyRate)} />
              <Field label="Weekly rate" value={fmtMoney(v.weeklyRate)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Income (paid)" value={fmtMoney(incomeTotal)} />
            <Stat label="Expenses" value={fmtMoney(expenseTotal)} />
            <Stat label="Net P&L" value={fmtMoney(netTotal)} />
          </div>
          <Section title="Income (payments collected)">
            {vPayments.length === 0 ? <Empty/> : vPayments.map(p => (
              <Row key={p.id} title={fmtMoney(p.amount)} sub={`${driverById(p.driverId)?.fullName ?? p.driverId} · due ${fmtDate(p.dueDate)}`} right={<StatusBadge status={p.status} />} />
            ))}
          </Section>
          <Section title="Expense breakdown">
            <Row title="Maintenance and repairs" sub={`${vMx.length} service record${vMx.length === 1 ? "" : "s"}`} right={<span className="font-medium">{fmtMoney(maintenanceTotal)}</span>} />
            <Row title="Violations and impound costs" sub={`${vViol.length} vehicle charge${vViol.length === 1 ? "" : "s"}`} right={<span className="font-medium">{fmtMoney(violationTotal)}</span>} />
          </Section>
          <Button variant="outline" asChild className="w-full sm:w-auto"><Link to="/pnl">Open full P&amp;L report →</Link></Button>
        </TabsContent>

        <TabsContent value="maintenance" className="mt-4 space-y-4">
          <Section title={`Maintenance records (${vMx.length})`}>
            {vMx.length === 0 ? <Empty/> : vMx.map(m => (
              <Row key={m.id} title={m.serviceType} sub={`${fmtDate(m.dateCompleted)} · ${m.vendor} · ${m.mileageAtService.toLocaleString()} mi · next due ${fmtDate(m.nextServiceDue)}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
            ))}
          </Section>
          <Button variant="outline" asChild className="w-full sm:w-auto"><Link to="/maintenance">Open maintenance log →</Link></Button>
        </TabsContent>

        <TabsContent value="repairs" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = `${window.location.origin}/fleet/${v.id}?tab=repairs`;
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Repair History link copied", { description: url }),
                  () => toast.error("Could not copy link"),
                );
              }}
            >
              <Link2 className="mr-1 h-4 w-4" />Copy deep link
            </Button>
          </div>
          <Section title={`Repair history (${vRepairs.length})`}>
            {vRepairs.length === 0 ? <Empty/> : vRepairs.map(m => (
              <Row key={m.id} title={m.serviceType} sub={`${fmtDate(m.dateCompleted)} · ${m.vendor} · ${m.mileageAtService.toLocaleString()} mi${m.notes ? ` · ${m.notes}` : ""}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
            ))}
          </Section>
        </TabsContent>

        <TabsContent value="renters" className="mt-4 space-y-4">
          <Section title={`Renters of this vehicle (${uniqueRenters.length})`}>
            {uniqueRenters.length === 0 ? <Empty/> : uniqueRenters.map(u => (
              <Link key={u.driverId} to="/drivers" className="block">
                <Row
                  title={u.driver?.fullName ?? u.driverId}
                  sub={`${u.count} rental${u.count === 1 ? "" : "s"} · first started ${fmtDate(u.firstStart)}`}
                  right={<span className="font-medium">{fmtMoney(u.totalPaid)} paid</span>}
                />
              </Link>
            ))}
          </Section>
          <Section title="Rental history">
            {vRentals.length === 0 ? <Empty/> : vRentals.map(r => (
              <Row key={r.id} title={driverById(r.driverId)?.fullName ?? r.driverId} sub={`${fmtDate(r.startDate)} → ${r.endDate ? fmtDate(r.endDate) : "open"} · ${fmtMoney(r.weeklyRate)}/wk`} right={<StatusBadge status={r.paymentStatus} />} />
            ))}
          </Section>
        </TabsContent>

        <TabsContent value="other" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section title="Violations">
            {vViol.length === 0 ? <Empty/> : vViol.map(x => (
              <Row key={x.id} title={x.type.toUpperCase()} sub={fmtDate(x.dateIssued)} right={<><span className="mr-2 font-medium">{fmtMoney(x.amount)}</span><StatusBadge status={x.status} /></>} />
            ))}
          </Section>
          <Section title="Inspections">
            {vInsp.length === 0 ? <Empty/> : vInsp.map(i => (
              <Row key={i.id} title={i.type} sub={`${fmtDate(i.date)} · ${i.mileage.toLocaleString()} mi`} right={<StatusBadge status={i.damageNoted ? "missed" : "paid"} />} />
            ))}
          </Section>
        </TabsContent>
      </Tabs>
      <NewReservationDialog
        open={reserveOpen}
        onOpenChange={setReserveOpen}
        initialVehicleId={v.id}
      />
      <div className="mt-6 flex justify-start">
        <Button variant="outline" asChild>
          <Link to="/fleet"><ArrowLeft className="mr-1 h-4 w-4" />Back to Fleet</Link>
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-border/50 pb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></CardContent></Card>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-2">{children}</CardContent></Card>;
}
function Row({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"><div><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">{sub}</div></div><div className="flex items-center">{right}</div></div>;
}
function Empty() { return <p className="text-sm text-muted-foreground">No records yet.</p>; }
