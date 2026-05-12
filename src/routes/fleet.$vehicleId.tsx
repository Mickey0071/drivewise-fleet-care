import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vehicleById, rentals, maintenance, violations, inspections, driverById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";

export const Route = createFileRoute("/fleet/$vehicleId")({
  component: VehicleDetail,
});

function VehicleDetail() {
  const { vehicleId } = Route.useParams();
  const v = vehicleById(vehicleId);
  if (!v) return <div className="text-muted-foreground">Vehicle not found.</div>;

  const vRentals = rentals.filter(r => r.vehicleId === v.id);
  const vMx = maintenance.filter(m => m.vehicleId === v.id);
  const vViol = violations.filter(x => x.vehicleId === v.id);
  const vInsp = inspections.filter(i => i.vehicleId === v.id);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3"><Link to="/fleet">← Back to fleet</Link></Button>
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
        action={<StatusBadge status={v.status} />}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Mileage" value={`${v.mileage.toLocaleString()} mi`} />
        <Stat label="Weekly rate" value={fmtMoney(v.weeklyRate)} />
        <Stat label="Daily rate" value={fmtMoney(v.dailyRate)} />
        <Stat label="Risk tier" value={v.riskTier} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Rental history">
          {vRentals.length === 0 ? <Empty/> : vRentals.map(r => (
            <Row key={r.id} title={driverById(r.driverId)?.fullName ?? r.driverId} sub={`Started ${fmtDate(r.startDate)}`} right={<StatusBadge status={r.paymentStatus} />} />
          ))}
        </Section>
        <Section title="Maintenance log">
          {vMx.length === 0 ? <Empty/> : vMx.map(m => (
            <Row key={m.id} title={m.serviceType} sub={`${fmtDate(m.dateCompleted)} · ${m.vendor}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
          ))}
        </Section>
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
      </div>
    </div>
  );
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
