import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { vehicleById, rentals, maintenance, violations, inspections, payments, driverById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { isVehicleBookable, uploadVehiclePhoto, updateVehicleImage, useStoreVersion } from "@/lib/mock/store";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { ShareRentalDialog } from "@/components/app/ShareRentalDialog";
import { EditVehicleDialog } from "@/components/app/EditVehicleDialog";
import { NewTaskDialog } from "@/components/app/NewTaskDialog";
import { VehicleGallery } from "@/components/app/VehicleGallery";
import { useRef, useState } from "react";
import { ArrowLeft, Link2, Camera, Pencil, Send } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { ResolveMaintenanceDialog } from "@/components/app/ResolveMaintenanceDialog";
import { MaintenanceSettingsDialog } from "@/components/app/MaintenanceSettingsDialog";
import type { Maintenance } from "@/lib/mock/data";
import { isServiceLogRecord, lastServiceFor, computeVehicleAlerts } from "@/lib/maintenance-utils";
import { toast } from "sonner";

const REPAIR_KEYWORDS = ["brake", "transmission", "repair", "pads", "engine", "battery", "tire", "body", "glass", "diagnostic"];

export const Route = createFileRoute("/fleet/$vehicleId")({
  component: VehicleDetail,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
});

function VehicleDetail() {
  useStoreVersion();
  const { vehicleId } = Route.useParams();
  const { tab } = Route.useSearch();
  const v = vehicleById(vehicleId);
  const { role } = useAuth();
  const [reserveOpen, setReserveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectionDetailId, setInspectionDetailId] = useState<string | null>(null);
  const [resolveRecord, setResolveRecord] = useState<Maintenance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  if (!v) return <div className="text-muted-foreground">Vehicle not found.</div>;

  const vRentals = rentals.filter(r => r.vehicleId === v.id);
  const vMx = maintenance.filter(m => m.vehicleId === v.id);
  const openIssues = vMx.filter(m => !m.dateCompleted);
  const serviceLog = vMx.filter(isServiceLogRecord)
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
  const lastSvc = lastServiceFor(maintenance, v.id);
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
  const activeRental = vRentals.find(r => !r.endDate && ((r.reservationStatus ?? "active") === "active" || r.reservationStatus === "pending")) ?? vRentals[0];
  const bookable = isVehicleBookable(v.id);
  const activeDriver = activeRental ? driverById(activeRental.driverId) : null;
  const isCurrentlyRented = v.status === "rented" && !!activeRental && !activeRental.endDate;
  const nextDue = vPayments.find(p => p.status !== "paid");
  const alerts = computeVehicleAlerts(v);

  const uniqueRenters = Array.from(new Map(vRentals.map(r => [r.driverId, driverById(r.driverId)])).entries())
    .map(([driverId, driver]) => {
      const rs = vRentals.filter(r => r.driverId === driverId);
      const totalPaid = vPayments.filter(p => p.driverId === driverId && p.status === "paid").reduce((s, p) => s + p.amount, 0);
      return { driverId, driver, count: rs.length, firstStart: rs.map(r => r.startDate).sort()[0], totalPaid };
    });

  return (
    <div>
      <Button variant="outline" size="sm" asChild className="mb-3">
        <Link to="/fleet"><ArrowLeft className="mr-1 h-4 w-4" />Back to Fleet</Link>
      </Button>
      <div className="relative mb-4 overflow-hidden rounded-xl border border-border bg-muted">
        <img
          key={v.imageUrl ?? `default-${v.id}`}
          src={v.imageUrl ?? carImage(v.model)}
          alt={`${v.year} ${v.make} ${v.model}`}
          width={800}
          height={512}
          className="aspect-[21/9] w-full object-cover"
        />
        <div className="absolute right-2 top-2 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                const url = await uploadVehiclePhoto(v.id, file);
                await updateVehicleImage(v.id, url);
                toast.success("Photo updated");
              } catch (err: any) {
                toast.error("Upload failed", { description: err?.message ?? "Try again" });
              } finally {
                setUploading(false);
                if (fileRef.current) fileRef.current.value = "";
              }
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Camera className="mr-1 h-4 w-4" />{uploading ? "Uploading…" : v.imageUrl ? "Change photo" : "Add photo"}
          </Button>
          {v.imageUrl && (
            <Button
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={async () => {
                try {
                  await updateVehicleImage(v.id, null);
                  toast.success("Photo removed");
                } catch (err: any) {
                  toast.error("Photo was not removed from cloud", { description: err?.message ?? "Try again" });
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <PageHeader
        title={`${v.year} ${v.make} ${v.model}`}
        subtitle={`${v.id} · Plate ${v.plate} · VIN ${v.vin}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={v.status} />
            {v.hasOpenIssues && (
              <Badge variant="outline" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 h-3 w-3" /> Open issue
              </Badge>
            )}
            {bookable && (
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                Share rental link
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 h-4 w-4" />Edit
            </Button>
            {role === "admin" && (
              <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}>
                <Send className="mr-1 h-4 w-4" />Send Task to Runner
              </Button>
            )}
            <Button
              size="sm"
              disabled={!bookable}
              onClick={() => setReserveOpen(true)}
            >
              Reserve
            </Button>
          </div>
        }
      />

      {openIssues.length > 0 && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Open Issues ({openIssues.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openIssues.map(m => (
              <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.serviceType}</div>
                  {m.notes && <div className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{m.notes}</div>}
                  <div className="mt-0.5 text-xs text-muted-foreground">Opened {fmtDate(m.createdAt?.slice(0, 10))}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.sourceInspectionId && (
                    <Button size="sm" variant="outline" onClick={() => setInspectionDetailId(m.sourceInspectionId!)}>
                      View inspection
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setResolveRecord(m)}>
                    Mark Resolved
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
              <div className="sm:col-span-2"><Field label="VIN" value={v.vin} /></div>
              <Field label="Plate" value={v.plate} />
              <Field label="Mileage" value={`${v.mileage.toLocaleString()} mi`} />
              <Field label="Risk tier" value={v.riskTier} />
              <Field label="Daily rate" value={fmtMoney(v.dailyRate)} />
              <Field label="Weekly rate" value={fmtMoney(v.weeklyRate)} />
            </CardContent>
          </Card>
          <VehicleGallery vehicleId={v.id} coverUrl={v.imageUrl} />
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Last service" value={lastSvc ? `${lastSvc.serviceType}` : "—"} />
            <Stat label="Next service due" value={lastSvc ? fmtDate(lastSvc.nextServiceDue) : "—"} />
          </div>
          <Section title={`Service log (${serviceLog.length})`}>
            {serviceLog.length === 0 ? <Empty/> : serviceLog.map(m => (
              <Row key={m.id} title={m.serviceType} sub={`${fmtDate(m.dateCompleted)} · ${m.vendor || "—"} · ${m.mileageAtService.toLocaleString()} mi · next due ${fmtDate(m.nextServiceDue)}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
            ))}
          </Section>
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
      <ShareRentalDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        vehicle={v}
      />
      <EditVehicleDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        vehicle={v}
      />
      <InspectionDetailDialog
        inspectionId={inspectionDetailId}
        open={!!inspectionDetailId}
        onOpenChange={(o) => { if (!o) setInspectionDetailId(null); }}
      />
      <NewTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        prefill={{ linked_vehicle_id: v.id }}
      />
      <ResolveMaintenanceDialog
        open={!!resolveRecord}
        onOpenChange={(o) => { if (!o) setResolveRecord(null); }}
        record={resolveRecord}
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
  return <div className="flex justify-between gap-3 border-b border-border/50 pb-1"><span className="text-muted-foreground shrink-0">{label}</span><span className="font-medium text-right break-all">{value}</span></div>;
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
