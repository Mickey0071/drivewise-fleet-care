import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Car, AlertTriangle, PackageSearch, DollarSign, CalendarClock } from "lucide-react";
import { vehicleById, fmtMoney, type Maintenance, type Vehicle } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { repairDisplayTitle } from "@/lib/maintenance-utils";
import { repairCost as effectiveRepairCost } from "@/lib/money-rules";

export type RepairPhase =
  | "awaiting part"
  | "in progress"
  | "not started"
  | "awaiting approval"
  | "needs diagnosis";

const PHASE_CLASS: Record<RepairPhase, string> = {
  "awaiting part": "text-amber-600",
  "in progress": "text-blue-600",
  "not started": "text-muted-foreground",
  "awaiting approval": "text-amber-600",
  "needs diagnosis": "text-muted-foreground",
};

/** Is this maintenance row an open (not completed) repair? */
export function isOpenRepair(m: Maintenance): boolean {
  if (!m.status) return false;
  if (m.status === "complete") return false;
  return !m.dateCompleted;
}

export function repairPhase(m: Maintenance): RepairPhase {
  if (m.approvalStatus === "pending" || m.status === "pending_deposit") return "awaiting approval";
  if (m.status === "reported") return "not started";
  if (m.status === "diagnosing") return "needs diagnosis";
  const parts = Number(m.partsCost ?? 0);
  if (parts > 0 && m.status !== "pending_complete") return "awaiting part";
  return "in progress";
}

function daysSince(iso?: string): number {
  if (!iso) return 0;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export interface OffRoadGroup {
  vehicle: Vehicle | undefined;
  vehicleId: string;
  repairs: Maintenance[];
  daysDown: number;
  mechanic: string;
  needsApproval: Maintenance | null;
  openCost: number;
}

export function buildOffRoadGroups(all: Maintenance[]): OffRoadGroup[] {
  const byVehicle = new Map<string, Maintenance[]>();
  for (const m of all) {
    if (!isOpenRepair(m)) continue;
    const list = byVehicle.get(m.vehicleId) ?? [];
    list.push(m);
    byVehicle.set(m.vehicleId, list);
  }
  const groups: OffRoadGroup[] = [];
  for (const [vehicleId, repairs] of byVehicle) {
    const oldest = repairs
      .map((m) => m.createdAt ?? m.nextServiceDue)
      .filter(Boolean)
      .sort()[0];
    groups.push({
      vehicleId,
      vehicle: vehicleById(vehicleId),
      repairs,
      daysDown: daysSince(oldest as string | undefined),
      mechanic: repairs.find((m) => m.mechanicName)?.mechanicName ?? "",
      needsApproval: repairs.find((m) => repairPhase(m) === "awaiting approval") ?? null,
      openCost: repairs.reduce((s, m) => s + (effectiveRepairCost(m) || 0), 0),
    });
  }
  return groups.sort((a, b) => b.daysDown - a.daysDown || b.repairs.length - a.repairs.length);
}

function Tile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "red" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "red" ? "text-destructive" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={toneClass}>{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
    </Card>
  );
}

export function OffRoadVehicles({
  repairs,
  onViewRepairs,
  onMechanic,
  onApprove,
}: {
  repairs: Maintenance[];
  onViewRepairs: (g: OffRoadGroup) => void;
  onMechanic: (g: OffRoadGroup) => void;
  onApprove: (m: Maintenance) => void;
}) {
  const navigate = useNavigate();
  const groups = useMemo(() => buildOffRoadGroups(repairs), [repairs]);

  const openRepairs = groups.flatMap((g) => g.repairs);
  const awaitingParts = openRepairs.filter((m) => repairPhase(m) === "awaiting part").length;
  const openCost = groups.reduce((s, g) => s + g.openCost, 0);
  const totalDaysDown = groups.reduce((s, g) => s + g.daysDown, 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Off road" value={String(groups.length)} tone="red" icon={<AlertTriangle className="h-4 w-4" />} />
        <Tile label="Awaiting parts" value={String(awaitingParts)} tone="amber" icon={<PackageSearch className="h-4 w-4" />} />
        <Tile label="Open repair cost" value={fmtMoney(openCost)} tone="neutral" icon={<DollarSign className="h-4 w-4" />} />
        <Tile label="Days down (total)" value={String(totalDaysDown)} tone="neutral" icon={<CalendarClock className="h-4 w-4" />} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Off road — in repair
        </h2>
        {groups.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No vehicles are off road right now.</Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const v = g.vehicle;
              const urgent = !!g.needsApproval || g.daysDown > 7;
              const border = urgent ? "border-destructive/60" : "border-amber-500/50";
              const badgeClass = urgent
                ? "bg-destructive/10 text-destructive"
                : "bg-amber-500/15 text-amber-600";
              return (
                <Card key={g.vehicleId} className={`overflow-hidden border-l-4 ${border}`}>
                  <div className="flex flex-col sm:flex-row">
                    <div className="h-32 w-full shrink-0 bg-muted sm:h-auto sm:w-[150px]">
                      {v?.imageUrl || v?.model ? (
                        <img
                          src={v?.imageUrl ?? carImage(v?.model ?? "")}
                          alt={v ? `${v.year} ${v.make} ${v.model}` : "Vehicle"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Car className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <button
                            type="button"
                            className="text-left text-base font-bold hover:underline"
                            onClick={() => v && navigate({ to: "/fleet/$vehicleId", params: { vehicleId: v.id } })}
                          >
                            {v?.plate ? `${v.plate} · ` : ""}
                            {v ? `${v.year} ${v.make} ${v.model}` : g.vehicleId}
                          </button>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {v?.mileage ? `${v.mileage.toLocaleString()} mi · ` : ""}
                            Down {g.daysDown} day{g.daysDown === 1 ? "" : "s"}
                            {g.mechanic ? ` · ${g.mechanic}` : ""}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                          {g.repairs.length} repair{g.repairs.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <ul className="mt-3 space-y-1.5 border-l-2 border-border pl-3">
                        {g.repairs.map((m) => {
                          const phase = repairPhase(m);
                          const cost = effectiveRepairCost(m) || 0;
                          return (
                            <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate">
                                {repairDisplayTitle(m)}
                                <span className={`ml-2 text-xs font-medium ${PHASE_CLASS[phase]}`}>— {phase}</span>
                              </span>
                              <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                                {cost > 0 ? fmtMoney(cost) : "—"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => onViewRepairs(g)}>
                          View repairs
                        </Button>
                        {g.mechanic ? (
                          <Button size="sm" variant="outline" onClick={() => onMechanic(g)}>
                            Message mechanic
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => onMechanic(g)}>
                            Assign mechanic
                          </Button>
                        )}
                        {g.needsApproval && (
                          <Button
                            size="sm"
                            className="bg-amber-500 text-white hover:bg-amber-600"
                            onClick={() => onApprove(g.needsApproval!)}
                          >
                            Approve {fmtMoney(effectiveRepairCost(g.needsApproval) || 0)}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
