import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Wrench, Send, CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useStoreVersion } from "@/lib/mock/store";
import { computeAllFixedItems, scheduledRemainingLabel, type ScheduledItem } from "@/lib/maintenance-utils";
import type { Vehicle } from "@/lib/mock/data";
import { MarkMaintenanceDoneDialog } from "@/components/app/MarkMaintenanceDoneDialog";

function fmt(v?: string | number) {
  if (v == null || v === "") return "—";
  return String(v);
}

function statusBadge(it: ScheduledItem) {
  if (it.unconfigured) return <Badge variant="outline">Not configured</Badge>;
  if (it.status === "overdue") return <Badge className="bg-red-600 text-white hover:bg-red-600">Overdue</Badge>;
  if (it.status === "due_soon") return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Due soon</Badge>;
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">OK</Badge>;
}

export function VehicleScheduledMaintenance({ vehicle }: { vehicle: Vehicle }) {
  useStoreVersion();
  const navigate = useNavigate();
  const [markItem, setMarkItem] = useState<ScheduledItem | null>(null);

  const items = useMemo(() => computeAllFixedItems(vehicle), [vehicle]);

  const overdue = items.filter((i) => i.status === "overdue" && !i.unconfigured).length;
  const dueSoon = items.filter((i) => i.status === "due_soon" && !i.unconfigured).length;
  const ok = items.filter((i) => i.status === "upcoming" && !i.unconfigured).length;

  function sendRm(it: ScheduledItem) {
    navigate({
      to: "/admin/create-task",
      search: { vehicleId: vehicle.id, item: it.type, preset: "maintenance_item" } as never,
    });
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 py-2">
          <CardTitle className="text-sm font-semibold">
            <Wrench className="mr-1 inline h-4 w-4" />
            Scheduled Maintenance
          </CardTitle>
          <div className="flex gap-1 text-[11px]">
            <Badge className="bg-red-600 text-white hover:bg-red-600">{overdue} overdue</Badge>
            <Badge className="bg-amber-500 text-white hover:bg-amber-500">{dueSoon} soon</Badge>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{ok} ok</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {items.map((it) => (
            <div key={it.key} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{it.label}</div>
                {statusBadge(it)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {it.unconfigured
                  ? "Set intervals in Maintenance settings."
                  : `${it.dueDate ? `Due ${fmt(it.dueDate)}` : ""}${it.dueMileage ? ` · @ ${it.dueMileage.toLocaleString()} mi` : ""} · ${scheduledRemainingLabel(it)}`}
              </div>
              <div className="mt-2 flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setMarkItem(it)}>
                  <CheckCircle2 className="mr-1 h-3 w-3" />Mark done
                </Button>
                <Button size="sm" variant="ghost" onClick={() => sendRm(it)}>
                  <Send className="mr-1 h-3 w-3" />Send RM
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <MarkMaintenanceDoneDialog
        open={!!markItem}
        onOpenChange={(o) => { if (!o) setMarkItem(null); }}
        item={markItem}
        vehicle={vehicle}
      />
    </>
  );
}