import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Wrench, UserCog, ArrowLeftRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { rentals } from "@/lib/mock/data";
import type { Vehicle } from "@/lib/mock/data";
import type { ScheduledItem } from "@/lib/maintenance-utils";
import { scheduledRemainingLabel } from "@/lib/maintenance-utils";

export function MaintenanceActionDialog({
  vehicle,
  items,
  onClose,
}: {
  vehicle: Vehicle | null;
  items: ScheduledItem[];
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const overdue = useMemo(
    () => items.filter((i) => !i.unconfigured && i.status === "overdue"),
    [items],
  );
  const dueSoon = useMemo(
    () => items.filter((i) => !i.unconfigured && i.status === "due_soon"),
    [items],
  );
  const flagged = overdue.length ? overdue : dueSoon;
  const flaggedNames = flagged.map((i) => i.label);

  if (!vehicle) return null;
  const v = vehicle;

  const label = `${v.year} ${v.make} ${v.model}${v.plate ? ` · ${v.plate}` : ""}`;
  const summary =
    overdue.length > 0
      ? `${overdue.length} item${overdue.length === 1 ? "" : "s"} overdue`
      : dueSoon.length > 0
        ? `${dueSoon.length} item${dueSoon.length === 1 ? "" : "s"} due soon`
        : "All clear";

  const activeRental = rentals.find(
    (r) => r.vehicleId === v.id && (r.reservationStatus ?? "active") === "active",
  );

  function scheduleMechanic() {
    onClose();
    toast.message("Opening Repairs — create a mechanic job for this vehicle.");
    navigate({ to: "/repairs" });
  }

  function sendRunnerToMechanic() {
    onClose();
    const itemParam = flagged[0]?.type ?? "overall";
    navigate({
      to: "/admin/create-task",
      search: {
        vehicleId: v.id,
        item: itemParam,
        preset: "maintenance_item",
        items: flaggedNames.join(","),
      } as never,
    });
  }

  function swapCustomerVehicle() {
    onClose();
    if (!activeRental) {
      toast.error("No active rental for this vehicle to swap.");
      return;
    }
    navigate({
      to: "/rentals",
      search: { detail: activeRental.id, status: "on_rent" } as never,
    });
  }

  function openVehicle() {
    onClose();
    navigate({ to: "/fleet/$vehicleId", params: { vehicleId: v.id } });
  }

  return (
    <Dialog open={!!vehicle} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>{label}</span>
            {overdue.length > 0 ? (
              <Badge className="bg-red-600 text-white hover:bg-red-600">{summary}</Badge>
            ) : dueSoon.length > 0 ? (
              <Badge className="bg-amber-500 text-white hover:bg-amber-500">{summary}</Badge>
            ) : (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{summary}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {flagged.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {overdue.length > 0 ? "Overdue" : "Due soon"}
            </div>
            <ul className="space-y-1">
              {flagged.map((it) => (
                <li key={it.key} className="flex items-center justify-between gap-2">
                  <span className="font-medium">{it.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {scheduledRemainingLabel(it)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-2 pt-1">
          <Button variant="outline" className="justify-start" onClick={scheduleMechanic}>
            <Wrench className="mr-2 h-4 w-4" />
            Schedule Mechanic
          </Button>
          <Button variant="outline" className="justify-start" onClick={sendRunnerToMechanic}>
            <UserCog className="mr-2 h-4 w-4" />
            Send Runner to Mechanic
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            onClick={swapCustomerVehicle}
            disabled={!activeRental}
            title={activeRental ? undefined : "No active rental to swap"}
          >
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            Swap Customer Vehicle
            {!activeRental && (
              <span className="ml-2 text-[11px] text-muted-foreground">(no active rental)</span>
            )}
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={openVehicle}>
            <ExternalLink className="mr-1 h-4 w-4" />
            Open vehicle
          </Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}