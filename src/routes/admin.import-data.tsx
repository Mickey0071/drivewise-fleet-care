import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  importVehicles,
  importRentals,
  importCustomers,
  type VehicleImportResult,
  type RentalImportResult,
  type CustomerImportResult,
} from "@/lib/data-import.functions";

export const Route = createFileRoute("/admin/import-data")({
  head: () => ({ meta: [{ title: "Import Data — Camauto Rentals" }] }),
  component: ImportDataPage,
});

function FileDrop({ onRows, expected }: { onRows: (rows: Record<string, string>[], name: string) => void; expected: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const parse = (file: File) =>
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (res) => {
        onRows(res.data, file.name);
        toast.success(`Loaded ${res.data.length} rows from ${file.name}`);
      },
      error: (e) => toast.error(`Parse failed: ${e.message}`),
    });
  return (
    <div>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); e.target.value = ""; }} />
      <Button variant="outline" onClick={() => ref.current?.click()}>
        <Upload className="mr-2 h-4 w-4" /> Choose CSV
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">Expected columns: {expected}</p>
    </div>
  );
}

function VehiclesTab() {
  const run = useServerFn(importVehicles);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<VehicleImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    if (!rows.length) return toast.error("Upload a CSV first");
    setBusy(true);
    try {
      const r = await run({ data: { rows: rows as never, commit: false } });
      setResult(r);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await run({ data: { rows: rows as never, commit: true } });
      setResult(r);
      toast.success(`Imported: ${r.created} created, ${r.updated} updated`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-4 pt-6">
        <FileDrop expected="make, model, year, color, license_plate, vin, current_mileage, daily_allowed, daily_rate, weekly_rate, status" onRows={(r, n) => { setRows(r); setFileName(n); setResult(null); }} />
        {fileName && <p className="text-sm">{fileName} — <strong>{rows.length}</strong> rows</p>}
        <div className="flex gap-2">
          <Button onClick={preview} disabled={busy || !rows.length} variant="secondary">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Preview</Button>
          <Button onClick={commit} disabled={busy || !result || result.committed}>{result?.committed ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}Commit Import</Button>
        </div>
      </CardContent></Card>
      {result && (
        <Card><CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="default">Create: {result.created}</Badge>
            <Badge variant="secondary">Update: {result.updated}</Badge>
            <Badge variant="outline">Skip: {result.skipped}</Badge>
            {result.committed && <Badge className="bg-green-600 text-white">Committed</Badge>}
          </div>
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted"><tr><th className="p-2">#</th><th className="p-2">Action</th><th className="p-2">Plate</th><th className="p-2">Vehicle</th><th className="p-2">Changes</th></tr></thead>
              <tbody>
                {result.plans.map((p) => (
                  <tr key={p.row} className="border-t">
                    <td className="p-2">{p.row}</td>
                    <td className="p-2"><Badge variant={p.action === "create" ? "default" : p.action === "update" ? "secondary" : "outline"}>{p.action}</Badge></td>
                    <td className="p-2">{p.plate || "—"}</td>
                    <td className="p-2">{p.label}</td>
                    <td className="p-2 text-muted-foreground">{p.note || p.changes.map((c) => `${c.field}: ${c.before || "∅"}→${c.after}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

function RentalsTab() {
  const run = useServerFn(importRentals);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<RentalImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    if (!rows.length) return toast.error("Upload a CSV first");
    setBusy(true);
    try { setResult(await run({ data: { rows: rows as never, commit: false } })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await run({ data: { rows: rows as never, commit: true } });
      setResult(r);
      toast.success(`Imported ${r.rentalsCreated} rentals, ${r.driversCreated} new drivers`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-4 pt-6">
        <FileDrop expected="order_number, customer_name, vehicle_year, vehicle_make, vehicle_model, mileage, pickup_location, dropoff_location, pickup_date, return_date, status" onRows={(r, n) => { setRows(r); setFileName(n); setResult(null); }} />
        {fileName && <p className="text-sm">{fileName} — <strong>{rows.length}</strong> rows</p>}
        <div className="flex gap-2">
          <Button onClick={preview} disabled={busy || !rows.length} variant="secondary">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Preview</Button>
          <Button onClick={commit} disabled={busy || !result || result.committed}>{result?.committed ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}Commit Import</Button>
        </div>
      </CardContent></Card>
      {result && (
        <Card><CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="default">Rentals: {result.rentalsCreated}</Badge>
            <Badge variant="secondary">New drivers: {result.driversCreated}</Badge>
            <Badge variant="outline">Matched drivers: {result.driversMatched}</Badge>
            <Badge variant="outline">Skip: {result.skipped}</Badge>
            {result.committed && <Badge className="bg-green-600 text-white">Committed</Badge>}
          </div>
          {result.unmatchedVehicles.length > 0 && (
            <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Unmatched vehicles (import them first): {result.unmatchedVehicles.join("; ")}</div>
            </div>
          )}
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted"><tr><th className="p-2">#</th><th className="p-2">Action</th><th className="p-2">Order</th><th className="p-2">Customer</th><th className="p-2">Vehicle</th><th className="p-2">Note</th></tr></thead>
              <tbody>
                {result.plans.map((p) => (
                  <tr key={p.row} className="border-t">
                    <td className="p-2">{p.row}</td>
                    <td className="p-2"><Badge variant={p.action === "create" ? "default" : "outline"}>{p.action}</Badge></td>
                    <td className="p-2">{p.order || "—"}</td>
                    <td className="p-2">{p.customer}{p.driverAction === "create" && <span className="ml-1 text-[10px] text-muted-foreground">(new)</span>}</td>
                    <td className="p-2">{p.vehicle}</td>
                    <td className="p-2 text-muted-foreground">{p.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

function ImportDataPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Import Data" subtitle="Bulk import vehicles and historical rentals from CSV. Preview before committing." />
      <Tabs defaultValue="vehicles">
        <TabsList>
          <TabsTrigger value="vehicles">Import Vehicles</TabsTrigger>
          <TabsTrigger value="rentals">Import Rentals</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles"><VehiclesTab /></TabsContent>
        <TabsContent value="rentals"><RentalsTab /></TabsContent>
      </Tabs>
    </div>
  );
}