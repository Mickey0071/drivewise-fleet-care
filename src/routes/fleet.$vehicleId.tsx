import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { vehicleById, rentals, maintenance, violations, inspections, payments, expenses, driverById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { isVehicleBookable, uploadVehiclePhoto, updateVehicleImage, updateVehicle, completeRepair, deleteMaintenance, deleteWorkOrder, updateWorkOrder, useStoreVersion } from "@/lib/mock/store";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { ShareRentalDialog } from "@/components/app/ShareRentalDialog";
import { EditVehicleDialog } from "@/components/app/EditVehicleDialog";
import { VehicleGallery } from "@/components/app/VehicleGallery";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Link2, Camera, Pencil, Send, FileText, ClipboardList } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { ResolveMaintenanceDialog } from "@/components/app/ResolveMaintenanceDialog";
import { MaintenanceSettingsDialog } from "@/components/app/MaintenanceSettingsDialog";
import { ServiceHistoryReportDialog } from "@/components/app/ServiceHistoryReportDialog";
import { CreateWorkOrderDialog } from "@/components/app/CreateWorkOrderDialog";
import { WorkOrderDialog } from "@/components/app/WorkOrderDialog";
import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { EditMaintenanceDialog } from "@/components/app/EditMaintenanceDialog";
import { ExpenseDialog } from "@/components/app/ExpenseDialog";
import { BlockVehicleTab } from "@/components/app/BlockVehicleTab";
import { RmHistoryTab } from "@/components/app/RmHistoryTab";
import type { Maintenance, WorkOrder } from "@/lib/mock/data";
import { workOrders } from "@/lib/mock/data";
import { lastServiceFor, computeVehicleAlerts } from "@/lib/maintenance-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/fleet/$vehicleId")({
  component: VehicleDetail,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    maint: search.maint === "1" || search.maint === 1 ? 1 : undefined,
  }),
});

function VehicleDetail() {
  useStoreVersion();
  const { vehicleId } = Route.useParams();
  const { tab, maint } = Route.useSearch();
  const v = vehicleById(vehicleId);
  const { role } = useAuth();
  const [reserveOpen, setReserveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [createWoOpen, setCreateWoOpen] = useState(false);
  const [activeWo, setActiveWo] = useState<WorkOrder | null>(null);
  const [inspectionDetailId, setInspectionDetailId] = useState<string | null>(null);
  const [resolveRecord, setResolveRecord] = useState<Maintenance | null>(null);
  const [completedRepair, setCompletedRepair] = useState<Maintenance | null>(null);
  const [editRecord, setEditRecord] = useState<Maintenance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  // Live last-inspection data (reflects approved runner inspections from the backend).
  const [liveInsp, setLiveInsp] = useState<{ at: string | null; mileage: number | null; status: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    supabase
      .from("vehicles")
      .select("last_inspection_at, last_inspection_mileage, status")
      .eq("id", vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setLiveInsp({
          at: (data as any).last_inspection_at ?? null,
          mileage: (data as any).last_inspection_mileage ?? null,
          status: (data as any).status ?? null,
        });
      });
    return () => { active = false; };
  }, [vehicleId]);
  useEffect(() => {
    if (maint === 1) setSettingsOpen(true);
  }, [maint]);
  if (!v) return <div className="text-muted-foreground">Vehicle not found.</div>;

  const vRentals = rentals.filter(r => r.vehicleId === v.id);
  const vMx = maintenance.filter(m => m.vehicleId === v.id);
  const openIssues = vMx.filter(m => !m.dateCompleted);
  const lastSvc = lastServiceFor(maintenance, v.id);
  const SCHEDULED_KEYWORDS = ["oil", "battery", "alternator", "inspection"];
  const completedRepairs = vMx
    .filter(m => m.status === "complete")
    .filter(m => {
      const label = `${m.serviceType ?? ""} ${m.issueDescription ?? ""}`.toLowerCase();
      return !SCHEDULED_KEYWORDS.some(k => label.includes(k));
    })
    .sort((a, b) =>
      (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""),
    );
  const vViol = violations.filter(x => x.vehicleId === v.id);
  const vInsp = inspections.filter(i => i.vehicleId === v.id);
  const rentalIds = new Set(vRentals.map(r => r.id));
  const vPayments = payments.filter(p => rentalIds.has(p.rentalId));

  const incomeTotal = vPayments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const maintenanceTotal = vMx.reduce((s, m) => s + m.cost, 0);
  const violationTotal = vViol.reduce((s, x) => s + x.amount, 0);
  // Expense ledger is the canonical source for vehicle-tied spend (parts, labour,
  // fuel, etc.). Completed repairs auto-post here, so we don't add maintenance.cost
  // on top (that would double-count).
  const vehExpenses = expenses
    .filter(e => e.vehicleId === v.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const vehExpenseTotal = vehExpenses.reduce((s, e) => s + e.amount, 0);
  const vehExpenseByCat = vehExpenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount; return acc;
  }, {});
  const expenseTotal = vehExpenseTotal + violationTotal;
  const netTotal = incomeTotal - expenseTotal;
  const roiPct = expenseTotal > 0 ? (netTotal / expenseTotal) * 100 : null;
  const activeRental = vRentals.find(r => !r.endDate && ((r.reservationStatus ?? "active") === "active" || r.reservationStatus === "pending")) ?? vRentals[0];
  const bookable = isVehicleBookable(v.id);
  const activeDriver = activeRental ? driverById(activeRental.driverId) : null;
  const isCurrentlyRented = v.status === "rented" && !!activeRental && !activeRental.endDate;
  const nextDue = vPayments.find(p => p.status !== "paid");
  const alerts = computeVehicleAlerts(v);
  // Single source of truth for maintenance history: the maintenance ledger.
  // Work orders are mirrored into maintenance rows (sourceWorkOrderId), so we
  // derive Open vs Completed from one list — no duplicate sections.
  const woById = (id?: string) => (id ? workOrders.find(w => w.id === id) : undefined);
  const openMaint = vMx
    .filter(m => m.status !== "complete" && !m.dateCompleted)
    .sort((a, b) => (a.nextServiceDue ?? "").localeCompare(b.nextServiceDue ?? ""));
  const completedMaint = vMx
    .filter(m => m.status === "complete" || !!m.dateCompleted)
    .sort((a, b) =>
      (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""),
    );

  const uniqueRenters = Array.from(new Map(vRentals.map(r => [r.driverId, driverById(r.driverId)])).entries())
    .map(([driverId, driver]) => {
      const rs = vRentals.filter(r => r.driverId === driverId);
      const totalPaid = vPayments.filter(p => p.driverId === driverId && p.status === "paid").reduce((s, p) => s + p.amount, 0);
      return { driverId, driver, count: rs.length, firstStart: rs.map(r => r.startDate).sort()[0], totalPaid };
    });

  const lastInsp = [...vInsp].sort((a, b) =>
    ((b.submittedAt ?? b.date ?? "") as string).localeCompare((a.submittedAt ?? a.date ?? "") as string),
  )[0];

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
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              Maintenance settings
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
              <FileText className="mr-1 h-4 w-4" />Generate Service History Report
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreateWoOpen(true)}>
              <ClipboardList className="mr-1 h-4 w-4" />Create Maintenance Schedule
            </Button>
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

      {(liveInsp?.at || lastInsp) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
          <span className="flex items-center gap-1 text-muted-foreground">
            <ClipboardList className="h-4 w-4" /> Last inspection
          </span>
          <span><span className="text-muted-foreground">Date:</span> {fmtDate(liveInsp?.at ?? lastInsp?.date)}</span>
          <span><span className="text-muted-foreground">Mileage:</span> {(liveInsp?.mileage ?? lastInsp?.mileage ?? v.mileage)?.toLocaleString()} mi</span>
          <span className="flex items-center gap-1"><span className="text-muted-foreground">Status:</span> <StatusBadge status={liveInsp?.status ?? v.status} /></span>
        </div>
      )}

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

      {alerts.length > 0 && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Maintenance Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {alerts.map(a => (
              <div key={a.key} className="flex items-center gap-2 text-sm">
                <span aria-hidden>🔴</span>
                <span className="font-medium">{a.label}:</span>
                <span className="text-muted-foreground">{a.detail}</span>
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
          <TabsTrigger value="block">Block Vehicle</TabsTrigger>
          <TabsTrigger value="analytics">Analytics / P&amp;L</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="repairs">Repair History</TabsTrigger>
          <TabsTrigger value="rm">RM History</TabsTrigger>
          <TabsTrigger value="renters">Renter History ({uniqueRenters.length})</TabsTrigger>
          <TabsTrigger value="other">Violations &amp; Inspections</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
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

        <TabsContent value="block" className="mt-4">
          <BlockVehicleTab vehicle={v} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Income (paid)" value={fmtMoney(incomeTotal)} />
            <Stat label="Expenses" value={fmtMoney(expenseTotal)} />
            <Stat label="Net P&L" value={fmtMoney(netTotal)} />
            <Stat label="ROI" value={roiPct == null ? "—" : `${roiPct.toFixed(0)}%`} />
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Work orders ({vWorkOrders.length})</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setCreateWoOpen(true)}>
                <ClipboardList className="mr-1 h-4 w-4" />New work order
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {vWorkOrders.length === 0 ? <Empty/> : vWorkOrders.map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setActiveWo(w)}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-accent"
                >
                  <div>
                    <div className="text-sm font-medium">{w.serviceType}</div>
                    <div className="text-xs text-muted-foreground">
                      Scheduled {fmtDate(w.scheduledDate)}{w.assignedTo ? ` · ${w.assignedTo}` : ""} · {fmtMoney(w.estimatedCost)}
                    </div>
                  </div>
                  <StatusBadge status={w.status} />
                </button>
              ))}
            </CardContent>
          </Card>
          <Section title={`Service log (${serviceLog.length})`}>
            {serviceLog.length === 0 ? <Empty/> : serviceLog.map(m => (
              <Row key={m.id} title={m.serviceType} sub={`${m.vendor || "—"} · ${fmtDate(m.dateCompleted)} · by ${m.completedBy || "—"} · ${m.mileageAtService.toLocaleString()} mi · next due ${fmtDate(m.nextServiceDue)}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
            ))}
          </Section>
          <Section title={`Maintenance records (${vMx.length})`}>
            {vMx.length === 0 ? <Empty/> : vMx.map(m => (
              <Row key={m.id} title={m.serviceType} sub={`${m.vendor || "—"} · ${fmtDate(m.dateCompleted)} · by ${m.completedBy || "—"} · ${m.mileageAtService.toLocaleString()} mi · next due ${fmtDate(m.nextServiceDue)}`} right={<span className="font-medium">{fmtMoney(m.cost)}</span>} />
            ))}
          </Section>
          <Button variant="outline" asChild className="w-full sm:w-auto"><Link to="/maintenance">Open maintenance log →</Link></Button>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Total spent on this vehicle</div>
              <div className="text-2xl font-bold">{fmtMoney(vehExpenseTotal)}</div>
            </div>
            <Button size="sm" onClick={() => setExpenseOpen(true)}>Add expense</Button>
          </div>
          {Object.keys(vehExpenseByCat).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(vehExpenseByCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <span key={cat} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                  {cat}: <span className="font-semibold">{fmtMoney(amt)}</span>
                </span>
              ))}
            </div>
          )}
          <Section title={`Expenses (${vehExpenses.length})`}>
            {vehExpenses.length === 0 ? <Empty/> : vehExpenses.map(e => (
              <Row key={e.id}
                title={e.category}
                sub={`${fmtDate(e.date)}${e.vendor ? ` · ${e.vendor}` : ""}${e.notes ? ` · ${e.notes}` : ""}`}
                right={<span className="font-medium">{fmtMoney(e.amount)}</span>} />
            ))}
          </Section>
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
          <Section title={`Repair history (${completedRepairs.length})`}>
            {completedRepairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No repair history.</p>
            ) : (
              completedRepairs.map(m => {
                const issue = m.issueDescription || m.selectedSolution?.name || m.serviceType;
                const mechanic = m.completedBy || m.vendor || "—";
                const parts = m.partsCost ?? m.selectedSolution?.partsCost ?? 0;
                const labor = m.laborCost ?? m.selectedSolution?.laborCost ?? 0;
                const total = m.cost ?? parts + labor;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{issue}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(m.completionDate ?? m.dateCompleted)} · {mechanic}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{fmtMoney(total)}</span>
                      <Button variant="outline" size="sm" onClick={() => setCompletedRepair(m)}>View Details</Button>
                    </div>
                  </div>
                );
              })
            )}
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

        <TabsContent value="rm" className="mt-4">
          <RmHistoryTab vehicleId={v.id} />
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
        <TabsContent value="notes" className="mt-4">
          <VehicleNotesTab vehicleId={v.id} notes={v.notes} />
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
      <ResolveMaintenanceDialog
        open={!!resolveRecord}
        onOpenChange={(o) => { if (!o) setResolveRecord(null); }}
        record={resolveRecord}
      />
      <CompletedRepairDetailDialog
        open={!!completedRepair}
        onOpenChange={(o) => { if (!o) setCompletedRepair(null); }}
        record={completedRepair}
      />
      <MaintenanceSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        vehicle={v}
      />
      <ServiceHistoryReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        vehicle={v}
      />
      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        defaultVehicleId={v.id}
      />
      <CreateWorkOrderDialog
        open={createWoOpen}
        onOpenChange={setCreateWoOpen}
        vehicle={v}
      />
      {activeWo && (
        <WorkOrderDialog
          open={!!activeWo}
          onOpenChange={(o) => { if (!o) setActiveWo(null); }}
          workOrder={activeWo}
          vehicle={v}
        />
      )}
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

function VehicleNotesTab({ vehicleId, notes }: { vehicleId: string; notes?: string }) {
  const [value, setValue] = useState(notes ?? "");
  useEffect(() => { setValue(notes ?? ""); }, [vehicleId, notes]);
  const dirty = value !== (notes ?? "");
  function save() {
    updateVehicle(vehicleId, { notes: value.trim() || undefined })
      .then(() => toast.success("Notes saved"))
      .catch((e: any) => toast.error("Could not save notes", { description: e?.message }));
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Vehicle notes</CardTitle>
        <Button size="sm" disabled={!dirty} onClick={save}>Save</Button>
      </CardHeader>
      <CardContent>
        <Textarea
          className="min-h-[160px]"
          placeholder="Add notes about this vehicle (condition, quirks, history, reminders)…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </CardContent>
    </Card>
  );
}
function Row({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"><div><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">{sub}</div></div><div className="flex items-center">{right}</div></div>;
}
function Empty() { return <p className="text-sm text-muted-foreground">No records yet.</p>; }
