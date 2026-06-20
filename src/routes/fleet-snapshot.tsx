import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { vehicles, rentals, driverById, fmtMoney } from "@/lib/mock/data";
import { rentalCanonicalOwed, rentalPeriodRate, useStoreVersion } from "@/lib/mock/store";
import { TrendingUp, AlertTriangle, ArrowUpDown } from "lucide-react";

export const Route = createFileRoute("/fleet-snapshot")({
  head: () => ({ meta: [{ title: "Fleet Snapshot — Camauto Rentals" }] }),
  component: FleetSnapshotPage,
});

type Bucket =
  | "EARNING"
  | "RENTED, NOT PAYING"
  | "IDLE"
  | "DOWN"
  | "IMPOUNDED";

const BUCKETS: Bucket[] = ["EARNING", "RENTED, NOT PAYING", "IDLE", "DOWN", "IMPOUNDED"];

const bucketMeta: Record<Bucket, { color: string; badge: string }> = {
  EARNING: { color: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
  "RENTED, NOT PAYING": { color: "text-red-600", badge: "bg-red-100 text-red-700" },
  IDLE: { color: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
  DOWN: { color: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
  IMPOUNDED: { color: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
};

interface Row {
  vehicleId: string;
  plate: string;
  bucket: Bucket;
  renter: string;
  balance: number;
  weeklyRate: number;
}

type SortKey = "plate" | "bucket" | "renter" | "balance" | "weeklyRate";

function FleetSnapshotPage() {
  useStoreVersion();
  const [sortKey, setSortKey] = useState<SortKey>("bucket");
  const [asc, setAsc] = useState(true);

  const rows = useMemo<Row[]>(() => {
    return vehicles.map((v) => {
      const active = rentals.find(
        (r) =>
          r.vehicleId === v.id &&
          (r.reservationStatus ?? "active") === "active" &&
          !r.returnedAt,
      );

      let bucket: Bucket;
      let balance = 0;
      let renter = "";
      let weeklyRate = Number(v.weeklyRate) || 0;

      if (active) {
        const driver = driverById(active.driverId);
        renter = driver?.fullName ?? "Unknown";
        balance = rentalCanonicalOwed(active);
        const { rate, weekly } = rentalPeriodRate(active);
        if (rate > 0) weeklyRate = weekly ? rate : rate * 7;
      }

      if (v.status === "impound") {
        bucket = "IMPOUNDED";
      } else if (v.status === "maintenance" || v.hasOpenIssues) {
        bucket = "DOWN";
      } else if (active) {
        bucket = balance > 1 ? "RENTED, NOT PAYING" : "EARNING";
      } else {
        bucket = "IDLE";
      }

      return { vehicleId: v.id, plate: v.plate, bucket, renter, balance, weeklyRate };
    });
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
    rows.forEach((r) => (c[r.bucket] += 1));
    return c;
  }, [rows]);

  const collecting = useMemo(
    () => rows.filter((r) => r.bucket === "EARNING").reduce((s, r) => s + r.weeklyRate, 0),
    [rows],
  );
  const atRisk = useMemo(
    () => rows.filter((r) => r.bucket !== "EARNING").reduce((s, r) => s + r.weeklyRate, 0),
    [rows],
  );

  const sorted = useMemo(() => {
    const order = (b: Bucket) => BUCKETS.indexOf(b);
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "bucket": cmp = order(a.bucket) - order(b.bucket); break;
        case "balance": cmp = a.balance - b.balance; break;
        case "weeklyRate": cmp = a.weeklyRate - b.weeklyRate; break;
        case "renter": cmp = a.renter.localeCompare(b.renter); break;
        default: cmp = a.plate.localeCompare(b.plate);
      }
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, asc]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((p) => !p);
    else { setSortKey(k); setAsc(true); }
  };

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Snapshot"
        subtitle="Live earning status of every vehicle in the fleet"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => (
          <Card key={b}>
            <CardContent className="p-4">
              <div className={`text-3xl font-bold ${bucketMeta[b].color}`}>{counts[b]}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {b}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            <div>
              <div className="text-sm text-muted-foreground">Collecting this week</div>
              <div className="text-2xl font-bold text-emerald-600">{fmtMoney(collecting)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <AlertTriangle className="h-6 w-6 text-red-600" />
            <div>
              <div className="text-sm text-muted-foreground">Revenue at risk</div>
              <div className="text-2xl font-bold text-red-600">{fmtMoney(atRisk)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="plate" label="Plate" />
                <SortHead k="bucket" label="Status" />
                <SortHead k="renter" label="Renter" />
                <SortHead k="balance" label="Balance" className="text-right" />
                <SortHead k="weeklyRate" label="Weekly Rate" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.vehicleId}>
                  <TableCell className="font-medium">{r.plate}</TableCell>
                  <TableCell>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${bucketMeta[r.bucket].badge}`}>
                      {r.bucket}
                    </span>
                  </TableCell>
                  <TableCell>{r.renter || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className={`text-right ${r.balance > 1 ? "text-red-600 font-medium" : ""}`}>
                    {fmtMoney(r.balance)}
                  </TableCell>
                  <TableCell className="text-right">{fmtMoney(r.weeklyRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
