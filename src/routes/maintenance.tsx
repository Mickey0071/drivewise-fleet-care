import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bell, Wrench, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { activeVehicles } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import {
  computeAllFixedItems,
  FLEET_ITEM_TYPES,
  scheduledRemainingLabel,
  type ScheduledItem,
  type ScheduledType,
} from "@/lib/maintenance-utils";
import type { Vehicle } from "@/lib/mock/data";
import { MaintenanceActionDialog } from "@/components/app/MaintenanceActionDialog";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance Overview — Camauto Rentals" }] }),
  component: MaintenanceOverviewPage,
});

function StatusCell({ item }: { item?: ScheduledItem }) {
  if (!item) return <span className="text-muted-foreground">—</span>;
  if (item.unconfigured) {
    return <Badge variant="outline" className="text-[10px]">Not set</Badge>;
  }
  if (item.status === "overdue") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-600">
        Overdue{" "}
        <span className="ml-1 opacity-90">
          {(item.daysRemaining != null && item.daysRemaining < 0)
            ? `${Math.abs(item.daysRemaining)}d`
            : (item.milesRemaining != null && item.milesRemaining < 0)
              ? `${Math.abs(item.milesRemaining).toLocaleString()}mi`
              : ""}
        </span>
      </Badge>
    );
  }
  if (item.status === "due_soon") {
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        {item.daysRemaining != null && item.daysRemaining <= 7
          ? `${item.daysRemaining}d`
          : item.milesRemaining != null
            ? `${item.milesRemaining.toLocaleString()}mi`
            : "Soon"}
      </Badge>
    );
  }
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">OK</Badge>;
}

function rowUrgency(items: ScheduledItem[]): number {
  if (items.some((it) => it.status === "overdue")) return 0;
  if (items.some((it) => it.status === "due_soon")) return 1;
  return 2;
}

function MaintenanceOverviewPage() {
  useStoreVersion();
  const navigate = useNavigate();
  const [actionFor, setActionFor] = useState<{ vehicle: Vehicle; items: ScheduledItem[] } | null>(null);

  const rows = useMemo(() => {
    return activeVehicles()
      .map((v) => {
        const all = computeAllFixedItems(v);
        const byType = new Map<ScheduledType, ScheduledItem>();
        for (const it of all) if (it.type !== "custom") byType.set(it.type, it);
        const cells = FLEET_ITEM_TYPES.map((c) => byType.get(c.type));
        const overdue = cells.filter((it) => it && it.status === "overdue").length;
        const dueSoon = cells.filter((it) => it && it.status === "due_soon").length;
        return { vehicle: v, cells, overdue, dueSoon, urgency: rowUrgency(cells.filter(Boolean) as ScheduledItem[]) };
      })
      .sort((a, b) => a.urgency - b.urgency);
  }, []);

  const totalOverdueItems = rows.reduce((s, r) => s + r.overdue, 0);
  const vehiclesOverdue = rows.filter((r) => r.overdue > 0).length;
  const vehiclesDueSoon = rows.filter((r) => r.overdue === 0 && r.dueSoon > 0).length;
  const vehiclesClear = rows.filter((r) => r.overdue === 0 && r.dueSoon === 0).length;

  const overdueVehicleIds = rows.filter((r) => r.overdue > 0).map((r) => r.vehicle.id);

  function sendAllOverdueRMs() {
    if (overdueVehicleIds.length === 0) {
      toast.info("No overdue vehicles to dispatch.");
      return;
    }
    // Send admin to the create-task page with the fleet pre-selected so they
    // can pick a runner and dispatch in one go.
    toast.success(`Dispatching RMs for ${overdueVehicleIds.length} vehicle(s)`);
    navigate({
      to: "/admin/create-task",
      search: { vehicleIds: overdueVehicleIds.join(","), preset: "overdue_maintenance" } as never,
    });
  }

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle={`${activeVehicles().length} active vehicles · scheduled maintenance status`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={sendAllOverdueRMs} disabled={overdueVehicleIds.length === 0}>
              <Send className="mr-1 h-4 w-4" />
              Send all overdue RMs ({overdueVehicleIds.length})
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/maintenance-notifications">
                <Bell className="mr-1 h-4 w-4" />
                Notification settings
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 px-2 pb-3 md:grid-cols-4 md:px-4">
        <StatTile tone="red" label="Vehicles overdue" value={vehiclesOverdue} />
        <StatTile tone="amber" label="Due this week" value={vehiclesDueSoon} />
        <StatTile tone="green" label="All clear" value={vehiclesClear} />
        <StatTile tone="red" label="Total overdue items" value={totalOverdueItems} />
      </div>

      <div className="px-2 md:px-4">
        <Card>
          <CardHeader className="py-2">
            <CardTitle className="text-sm font-semibold">
              <Wrench className="mr-1 inline h-4 w-4" />
              Fleet maintenance status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Vehicle</TableHead>
                    {FLEET_ITEM_TYPES.map((c) => (
                      <TableHead key={c.type} className="text-center">{c.label}</TableHead>
                    ))}
                    <TableHead className="text-center">Overall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.vehicle.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        setActionFor({
                          vehicle: r.vehicle,
                          items: (r.cells.filter(Boolean) as ScheduledItem[]),
                        })
                      }
                    >
                      <TableCell>
                        <div className="font-medium">{r.vehicle.year} {r.vehicle.make} {r.vehicle.model}</div>
                        <div className="text-[11px] text-muted-foreground">{r.vehicle.plate}</div>
                      </TableCell>
                      {r.cells.map((it, i) => (
                        <TableCell key={i} className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <StatusCell item={it} />
                            {it && !it.unconfigured && it.status !== "upcoming" && (
                              <span className="text-[10px] text-muted-foreground">
                                {scheduledRemainingLabel(it)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        {r.overdue > 0 ? (
                          <Badge className="bg-red-600 text-white hover:bg-red-600">{r.overdue} overdue</Badge>
                        ) : r.dueSoon > 0 ? (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500">{r.dueSoon} due soon</Badge>
                        ) : (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={FLEET_ITEM_TYPES.length + 2} className="py-6 text-center text-sm text-muted-foreground">
                        No active vehicles.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Configure per-vehicle intervals from the vehicle detail page → Maintenance settings.
        </p>
      </div>

      <MaintenanceActionDialog
        vehicle={actionFor?.vehicle ?? null}
        items={actionFor?.items ?? []}
        onClose={() => setActionFor(null)}
      />
    </div>
  );
}

function StatTile({ tone, label, value }: { tone: "red" | "amber" | "green"; label: string; value: number }) {
  const cls =
    tone === "red"
      ? "border-red-400/50 bg-red-500/10 text-red-700 dark:text-red-300"
      : tone === "amber"
        ? "border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1 text-xs opacity-80">{label}</div>
    </div>
  );
}