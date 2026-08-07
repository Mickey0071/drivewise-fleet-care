import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { vehicles, maintenance, fmtMoney, type Maintenance, type Vehicle } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { repairCost } from "@/lib/money-rules";
import { ArrowUpDown, CarFront, Clock, DollarSign } from "lucide-react";

export const Route = createFileRoute("/vehicles-down")({
  head: () => ({
    meta: [
      { title: "Vehicles Down — Camauto Rentals" },
      { name: "description", content: "Every out-of-service vehicle with its repair status, open repair cost and days down." },
      { property: "og:title", content: "Vehicles Down — Camauto Rentals" },
      { property: "og:description", content: "Every out-of-service vehicle with its repair status, open repair cost and days down." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VehiclesDownPage,
});

type DownStatus =
  | "Awaiting diag"
  | "Repair pending"
  | "In repair"
  | "Blocked"
  | "Impounded"
  | "Dead"
  | "Down — no ticket";

const statusTone: Record<DownStatus, string> = {
  "Awaiting diag": "bg-amber-100 text-amber-800",
  "Repair pending": "bg-blue-100 text-blue-800",
  "In repair": "bg-indigo-100 text-indigo-800",
  Blocked: "bg-red-100 text-red-700",
  Impounded: "bg-orange-100 text-orange-800",
  Dead: "bg-neutral-200 text-neutral-700",
  "Down — no ticket": "bg-muted text-muted-foreground",
};

interface Row {
  id: string;
  plate: string;
  vehicleLabel: string;
  status: DownStatus;
  detail: string;
  cost: number;
  daysDown: number;
  ticketCount: number;
}

const DAY = 86_400_000;

function isOpenTicket(m: Maintenance) {
  return !!m.status && m.status !== "complete" && !m.dateCompleted;
}

function ticketStart(m: Maintenance): number {
  const raw = m.createdAt ?? m.nextServiceDue;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

function deriveStatus(v: Vehicle, tickets: Maintenance[]): { status: DownStatus; detail: string } {
  if (v.archived) return { status: "Dead", detail: v.archiveNotes || "Sold / retired" };
  if (v.status === "impound") return { status: "Impounded", detail: v.notes || "" };

  const blocking = tickets.find((t) => t.isRentalBlocking);
  const label = (m?: Maintenance) =>
    m?.diagnosisTitle || m?.issueDescription || m?.problemCategory || m?.serviceType || "";

  if (blocking) return { status: "Blocked", detail: label(blocking) };

  const inProgress = tickets.find((t) => t.status === "in_progress");
  if (inProgress) return { status: "In repair", detail: label(inProgress) };

  const diag = tickets.find((t) => t.status === "reported" || t.status === "diagnosing");
  if (diag) return { status: "Awaiting diag", detail: label(diag) };

  if (tickets.length) return { status: "Repair pending", detail: label(tickets[0]) };

  return { status: "Down — no ticket", detail: v.notes || "" };
}

type SortKey = "plate" | "status" | "cost" | "days";

function VehiclesDownPage() {
  useStoreVersion();
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [asc, setAsc] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const out: Row[] = [];

    for (const v of vehicles) {
      const tickets = maintenance.filter((m) => m.vehicleId === v.id && isOpenTicket(m));
      const isDown =
        v.status === "maintenance" ||
        v.status === "impound" ||
        !!v.hasOpenIssues ||
        tickets.some((t) => t.isRentalBlocking);
      if (!isDown) continue;

      const { status, detail } = deriveStatus(v, tickets);
      const cost = tickets.reduce((s, t) => s + repairCost(t), 0);
      const start = tickets.length ? Math.min(...tickets.map(ticketStart)) : now;
      const daysDown = Math.max(0, Math.round((now - start) / DAY));

      out.push({
        id: v.id,
        plate: v.plate,
        vehicleLabel: `${v.year} ${v.make} ${v.model}`,
        status,
        detail,
        cost,
        daysDown,
        ticketCount: tickets.length,
      });
    }
    return out;
  }, []);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "cost": cmp = a.cost - b.cost; break;
        case "days": cmp = a.daysDown - b.daysDown; break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        default: cmp = a.plate.localeCompare(b.plate);
      }
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, asc]);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const avgDays = rows.length ? Math.round(rows.reduce((s, r) => s + r.daysDown, 0) / rows.length) : 0;

  const toggle = (k: SortKey) => {
    if (k === sortKey) setAsc((p) => !p);
    else { setSortKey(k); setAsc(false); }
  };

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={className}>
      <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles Down"
        subtitle="Every out-of-service vehicle with its repair status, open cost and days down"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <CarFront className="h-6 w-6 text-red-600" />
            <div>
              <div className="text-sm text-muted-foreground">Vehicles down</div>
              <div className="text-2xl font-bold">{rows.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <DollarSign className="h-6 w-6 text-amber-600" />
            <div>
              <div className="text-sm text-muted-foreground">Open repair cost</div>
              <div className="text-2xl font-bold">{fmtMoney(totalCost)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Clock className="h-6 w-6 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">Avg days down</div>
              <div className="text-2xl font-bold">{avgDays}d</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No vehicles are currently down. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead k="plate" label="Plate" />
                    <TableHead>Year / Make / Model</TableHead>
                    <SortHead k="status" label="Status" />
                    <SortHead k="cost" label="Repair Cost" className="text-right" />
                    <SortHead k="days" label="Days Down" className="text-right" />
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.plate}</TableCell>
                      <TableCell>{r.vehicleLabel}</TableCell>
                      <TableCell>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[r.status]}`}>
                          {r.status}
                        </span>
                        {r.detail && (
                          <div className="mt-0.5 max-w-[22rem] truncate text-xs text-muted-foreground">{r.detail}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.cost > 0 ? fmtMoney(r.cost) : <span className="text-muted-foreground">—</span>}
                        {r.ticketCount > 1 && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">{r.ticketCount} tickets</Badge>
                        )}
                      </TableCell>
                      <TableCell className={`text-right ${r.daysDown >= 30 ? "font-semibold text-red-600" : ""}`}>
                        {r.daysDown}d
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="link" className="h-auto p-0 text-xs">
                          <Link to="/fleet/$vehicleId" params={{ vehicleId: r.id }}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}