import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Car, Users, DollarSign, Wrench, AlertTriangle, TrendingUp, Clock, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vehicles, payments, maintenance, drivers, rentals, fmtMoney, fmtDate, vehicleById, driverById } from "@/lib/mock/data";
import { isVehicleBookable, useStoreVersion } from "@/lib/mock/store";
import { AgreementReviewModal } from "@/components/app/AgreementReviewModal";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: Index,
});

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
  const dueThisWeek = payments.filter(p => p.status !== "paid" && new Date(p.dueDate) <= weekEnd);
  const overdue = payments.filter(p => p.status === "missed" || p.status === "late");
  const overdueAmount = overdue.reduce((s, p) => s + p.amount, 0);
  const serviceAlerts = maintenance.filter(m => m.nextServiceDue && new Date(m.nextServiceDue) <= weekEnd);
  const pendingReview = rentals.filter(r => r.staffReviewStatus === "pending");

  // Auto-open review modal for first un-dismissed pending agreement this session.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const nextToReview = useMemo(() => {
    if (!canReview) return null;
    if (typeof window === "undefined") return null;
    return pendingReview.find(r => {
      try { return !sessionStorage.getItem(`agreement-review-dismissed:${r.id}`); }
      catch { return true; }
    }) ?? null;
  }, [pendingReview, canReview]);

  useEffect(() => {
    if (nextToReview && !reviewingId) setReviewingId(nextToReview.id);
  }, [nextToReview, reviewingId]);

  const reviewingRental = reviewingId ? rentals.find(r => r.id === reviewingId) ?? null : null;

  function handleReviewClose(open: boolean) {
    if (!open && reviewingId) {
      try { sessionStorage.setItem(`agreement-review-dismissed:${reviewingId}`, "1"); } catch {}
      setReviewingId(null);
    }
  }

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
            {dueThisWeek.map(p => {
              const d = driverById(p.driverId);
              return (
                <div key={p.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{d?.fullName ?? p.driverId}</div>
                    <div className="text-xs text-muted-foreground">Due {fmtDate(p.dueDate)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{fmtMoney(p.amount)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              );
            })}
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

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Maintenance alerts</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/maintenance">View log</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {serviceAlerts.length === 0 && <p className="text-sm text-muted-foreground">No vehicles past service due.</p>}
          {serviceAlerts.map(m => {
            const v = vehicleById(m.vehicleId);
            return (
              <div key={m.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{v?.year} {v?.make} {v?.model} · {v?.plate}</div>
                  <div className="text-xs text-muted-foreground">Next service due {fmtDate(m.nextServiceDue)}</div>
                </div>
                <StatusBadge status="maintenance" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <QuickLink to="/fleet" label="Manage Fleet" icon={Car} />
        <QuickLink to="/drivers" label="Renter Roster" icon={Users} />
        <QuickLink to="/pnl" label="View P&L" icon={TrendingUp} />
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
