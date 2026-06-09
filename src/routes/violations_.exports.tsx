import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { downloadCSV } from "@/lib/exports";
import { exportTable, EXPORTABLE, type ExportTable } from "@/lib/data-exports.functions";

export const Route = createFileRoute("/violations_/exports")({
  head: () => ({ meta: [{ title: "Export Data — Camauto Rentals" }] }),
  component: ExportsPage,
});

const LABELS: Record<ExportTable, string> = {
  drivers: "Customers / Drivers",
  rentals: "Rentals / Reservations",
  vehicles: "Vehicles / Fleet",
  violations: "Violations",
  maintenance: "Maintenance Records",
  payments: "Payments",
};

function ExportsPage() {
  const exportFn = useServerFn(exportTable);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<ExportTable | "all" | null>(null);

  const run = async (table: ExportTable) => {
    setBusy(table);
    try {
      const res = await exportFn({
        data: { table, from: from || null, to: to || null },
      });
      if (!res.count) {
        toast.message(`No ${LABELS[table]} rows for that range`);
        return;
      }
      downloadCSV(`${table}-${new Date().toISOString().slice(0, 10)}`, res.headers, res.rows);
      toast.success(`Exported ${res.count} ${LABELS[table]} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    setBusy("all");
    try {
      for (const t of EXPORTABLE) {
        const res = await exportFn({ data: { table: t, from: from || null, to: to || null } });
        if (res.count) {
          downloadCSV(`${t}-${new Date().toISOString().slice(0, 10)}`, res.headers, res.rows);
        }
      }
      toast.success("Exported all data sets");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Export Data"
        subtitle="Download your data as CSV (Excel-compatible) for ownership and backups"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-4 p-6">
          <div>
            <Label className="text-xs">From (optional)</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To (optional)</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={runAll} disabled={busy !== null} className="ml-auto">
            {busy === "all" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export All Data
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EXPORTABLE.map((t) => (
          <Card key={t}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <span className="font-medium">{LABELS[t]}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => run(t)}
              >
                {busy === t ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}