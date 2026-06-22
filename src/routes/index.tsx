import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, Users, DollarSign, Wrench, AlertTriangle, TrendingUp, Clock, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vehicles, maintenance, drivers, rentals, fmtMoney, fmtDate, vehicleById, driverById } from "@/lib/mock/data";
import { isVehicleBookable, useStoreVersion } from "@/lib/mock/store";
import { rentalCanonicalOwed, rentalNextDueDate, rentalPastDueDays } from "@/lib/mock/store";
import { computeVehicleAlerts } from "@/lib/maintenance-utils";
import { AgreementReviewModal } from "@/components/app/AgreementReviewModal";
import { PendingPaymentReviews } from "@/components/app/PendingPaymentReviews";
import { ApprovedInspections } from "@/components/app/ApprovedInspections";
import { VerificationAlertsCard } from "@/components/app/VerificationAlertsCard";
import { PendingApprovalsCard } from "@/components/app/PendingApprovalsCard";
import { PartsQuotedCard } from "@/components/app/PartsQuotedCard";
import { NewDiagnosisAlertCard } from "@/components/app/NewDiagnosisAlertCard";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: Index,
});

function ReservationRow({
  rental: r,
  totalOwed,
  earliestDue,
  todayStr,
}: {
  rental: typeof rentals[number];
  totalOwed: number;
  earliestDue: string;
  todayStr: string;
}) {
  const navigate = useNavigate();
  const d = driverById(r.driverId);
  const v = vehicleById(r.vehicleId);
  const daysPastDue = Math.round(
    (new Date(todayStr).getTime() - new Date(earliestDue).getTime()) / 86400000,
  );
  let statusLabel: string;
  let statusClass: string;
  if (daysPastDue > 0) {
    statusLabel = `🔴 ${daysPastDue} day${daysPastDue === 1 ? "" : "s"} overdue`;
    statusClass = "bg-destructive/15 text-destructive";
  } else if (daysPastDue === 0) {
    statusLabel = "🟡 Due today";
    statusClass = "bg-amber-500/20 text-amber-700 dark:text-amber-400";
  } else {
    statusLabel = `🟡 Due in ${-daysPastDue} day${-daysPastDue === 1 ? "" : "s"}`;
    statusClass = "bg-amber-500/20 text-amber-700 dark:text-amber-400";
  }

  const handleRowClick = () => {
    navigate({ to: "/rentals", search: { detail: r.id } });
  };

  return (
    <div
      key={r.id}
      onClick={handleRowClick}
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/40 ${daysPastDue > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">
          <Link
            to="/rentals"
            search={{ detail: r.id }}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {d?.fullName ?? r.driverId}
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">{r.id}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <Link
            to="/fleet/$vehicleId"
            params={{ vehicleId: r.vehicleId }}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {v ? `${v.make} ${v.model}` : r.vehicleId}
          </Link>
          {" · Due "}{fmtDate(earliestDue)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-semibold">{fmtMoney(totalOwed)}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function Index() {
  useStoreVersion();
  const { role } = useAuth();
  const canReview = role === "admin" || role === "va";
  const counts = {
    available: vehicles.filter(v => isVehicleBookable(v.id)).length,
    rented: vehicles.filter(v => !isVehicleBookable(v.id) && v.status === "rented").length,
    maintenance: vehicles.filter(v => v.status === "maintenance").length,
    impound: vehicles.filter(v => v.status === "impound").length,
    pending: rentals.filter(r => r.reservationStatus === "pending" && !r.endDate).length,
  };
  const today = new Date();
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  const todayStr = today.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  // Consolidate all unpaid amounts per ON RENT reservation into a single line.
  const dueThisWeek = rentals
    .filter(r => (r.reservationStatus ?? "active") === "active") // exclude pending / returned / completed
    .map(r => {
      // Single source of truth: canonical engine (time charge − payments received).
      const totalOwed = rentalCanonicalOwed(r);
      const earliestDue = totalOwed > 0 ? rentalNextDueDate(r) : null;
      return { rental: r, totalOwed, earliestDue, pastDueDays: rentalPastDueDays(r) };
    })
    // Keep anything past due (always) plus anything due within the next 7 days.
    .filter(x => x.totalOwed > 0 && x.earliestDue !== null && (x.pastDueDays > 0 || x.earliestDue <= weekEndStr))
    // Past due first (most overdue on top), then due today / upcoming by soonest date.
    .sort((a, b) => {
      if (a.pastDueDays !== b.pastDueDays) return b.pastDueDays - a.pastDueDays;
      return a.earliestDue! < b.earliestDue! ? -1 : 1;
    });
  // Overdue = active rentals whose current period is past due, by canonical balance.
  const overdue = rentals.filter(
    r => (r.reservationStatus ?? "active") === "active" && rentalPastDueDays(r) > 0,
  );
  const overdueAmount = overdue.reduce((s, r) => s + Math.max(0, rentalCanonicalOwed(r)), 0);
  const serviceAlerts = maintenance.filter(m => m.nextServiceDue && new Date(m.nextServiceDue) <= weekEnd);
  const dedupedServiceAlerts = useMemo(() => {
    const byVehicle: Record<string, typeof maintenance[number]> = {};
    for (const m of serviceAlerts) {
      const existing = byVehicle[m.vehicleId];
      if (!existing || (m.nextServiceDue && existing.nextServiceDue && new Date(m.nextServiceDue) < new Date(existing.nextServiceDue))) {
        byVehicle[m.vehicleId] = m;
      }
    }
    return Object.values(byVehicle).sort((a, b) => {
      if (!a.nextServiceDue) return 1;
      if (!b.nextServiceDue) return -1;
      return new Date(a.nextServiceDue).getTime() - new Date(b.nextServiceDue).getTime();
    });
  }, [serviceAlerts]);
  const overdueServices = vehicles.flatMap(v =>
    computeVehicleAlerts(v).map(a => ({ vehicle: v, alert: a }))
  );
  const pendingReview = useMemo(
    () => rentals.filter(r => r.staffReviewStatus === "pending"),
    // re-derive whenever the store version changes (useStoreVersion above triggers re-render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rentals.length, rentals.map(r => r.staffReviewStatus ?? "").join("|")],
  );

  // Auto-open review modal for first un-dismissed pending agreement this session.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const pendingIdsKey = pendingReview.map(r => r.id).join(",");
  const nextToReviewId = useMemo(() => {
    if (!canReview) return null;
    if (typeof window === "undefined") return null;
    const next = pendingReview.find(r => {
      try { return !sessionStorage.getItem(`agreement-review-dismissed:${r.id}`); }
      catch { return true; }
    });
    return next?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIdsKey, canReview]);

  useEffect(() => {
    if (nextToReviewId && !reviewingId) setReviewingId(nextToReviewId);
  }, [nextToReviewId, reviewingId]);

  const reviewingRental = useMemo(
    () => (reviewingId ? rentals.find(r => r.id === reviewingId) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewingId],
  );

  const handleReviewClose = useCallback((open: boolean) => {
    if (open) return;
    setReviewingId(prev => {
      if (prev) {
        try { sessionStorage.setItem(`agreement-review-dismissed:${prev}`, "1"); } catch {}
      }
      return null;
    });
  }, []);

  return (
    <div>
      <PageHeader
        title="Admin Dashboard"
        subtitle="Fleet snapshot, payments, and alerts"
        action={
          <Button asChild>
            <Link to="/rentals">+ New Rental</Link>
          </Button>
        }
      />

      <AgreementReviewModal
        rental={reviewingRental}
        open={!!reviewingRental}
        onOpenChange={handleReviewClose}
      />

      {role === "admin" && <PendingPaymentReviews />}

      {role === "admin" && <VerificationAlertsCard />}

      {role === "admin" && <PartsQuotedCard />}

      {role === "admin" && <NewDiagnosisAlertCard />}

      {role === "admin" && <PendingApprovalsCard />}

      {role === "admin" && <ApprovedInspections />}

      {pendingReview.length > 0 && (
        <Link
          to="/pending-agreements"
          className="mb-4 flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 transition-colors hover:bg-amber-500/15"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400">
              <FileSignature className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">
                {pendingReview.length} {pendingReview.length === 1 ? "Agreement" : "Agreements"} Pending Review
              </div>
              <div className="text-xs text-muted-foreground">
                {pendingReview.slice(0, 3).map(r => {
                  const d = driverById(r.driverId); const v = vehicleById(r.vehicleId);
                  return `${d?.fullName ?? r.driverId} · ${v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId}${r.clientSignedAt ? ` · signed ${fmtDate(r.clientSignedAt)}` : ""}`;
                }).join(" — ")}
                {pendingReview.length > 3 && ` — +${pendingReview.length - 3} more`}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white">Review</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Available" value={counts.available} tone="success" icon={Car} to="/fleet" search={{ status: "available" }} />
        <StatCard label="Rented" value={counts.rented} tone="info" icon={Car} to="/fleet" search={{ status: "rented" }} />
        <StatCard label="Maintenance" value={counts.maintenance} tone="warning" icon={Wrench} to="/maintenance" />
        <StatCard label="Pending" value={counts.pending} tone="warning" icon={Clock} to="/rentals" />
        <StatCard label="Impound" value={counts.impound} tone="danger" icon={AlertTriangle} to="/fleet" search={{ status: "impound" }} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Payments due this week</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/payments">View all</Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {dueThisWeek.length === 0 && <p className="text-sm text-muted-foreground">No payments due this week.</p>}
            {dueThisWeek.map(({ rental: r, totalOwed, earliestDue }) => (
              <ReservationRow
                key={r.id}
                rental={r}
                totalOwed={totalOwed}
                earliestDue={earliestDue!}
                todayStr={todayStr}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{fmtMoney(overdueAmount)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{overdue.length} late or missed</div>
            <div className="mt-4 space-y-1 text-sm">
              <Row label="Active rentals" value={rentals.length} />
              <Row label="Active renters" value={drivers.filter(d => d.status === "active").length} />
              <Row label="Fleet size" value={vehicles.length} />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6 border-destructive/30">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overdue Services</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/fleet">View all</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {overdueServices.length === 0 && <p className="text-sm text-muted-foreground">No overdue services.</p>}
          {overdueServices.map(({ vehicle: v, alert: a }) => (
            <Link
              key={`${v.id}-${a.key}`}
              to="/fleet/$vehicleId"
              params={{ vehicleId: v.id }}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-destructive/50"
            >
              <div className="flex items-center gap-2 text-sm">
                <span aria-hidden>🔴</span>
                <span className="font-medium">{v.year} {v.make} {v.model}</span>
                <span className="text-muted-foreground">— {a.label} ({a.detail})</span>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Maintenance alerts (service log)</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/maintenance">View log</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {dedupedServiceAlerts.length === 0 && <p className="text-sm text-muted-foreground">No vehicles past service due.</p>}
          {dedupedServiceAlerts.map(m => {
            const v = vehicleById(m.vehicleId);
            return (
              <Link
                key={m.id}
                to="/fleet/$vehicleId"
                params={{ vehicleId: m.vehicleId }}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-primary/50"
              >
                <div>
                  <div className="text-sm font-medium">{v?.year} {v?.make} {v?.model} · {v?.plate}</div>
                  <div className="text-xs text-muted-foreground">Next service due {fmtDate(m.nextServiceDue)}</div>
                </div>
                <StatusBadge status="maintenance" />
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink to="/fleet" label="Manage Fleet" icon={Car} />
        <QuickLink to="/drivers" label="Renter Roster" icon={Users} />
        <QuickLink to="/pnl" label="View P&L" icon={TrendingUp} />
        <QuickLink to="/analytics/pnl-dashboard" label="P&L Dashboard" icon={TrendingUp} />
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, icon: Icon, to, search }: { label: string; value: number; tone: "success" | "info" | "warning" | "danger"; icon: any; to?: string; search?: Record<string, unknown> }) {
  const toneBar = {
    success: "bg-success", info: "bg-primary", warning: "bg-warning", danger: "bg-destructive",
  }[tone];
  const card = (
    <Card className={`overflow-hidden ${to ? "cursor-pointer transition-all hover:border-primary hover:shadow-md" : ""}`}>
      <div className={`h-1 w-full ${toneBar}`} />
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
  if (to) {
    return <Link to={to as any} search={search as any}>{card}</Link>;
  }
  return card;
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>
  );
}

function QuickLink({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  return (
    <Link to={to} className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <span className="font-medium">{label}</span>
      </div>
      <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">→</span>
    </Link>
  );
}
