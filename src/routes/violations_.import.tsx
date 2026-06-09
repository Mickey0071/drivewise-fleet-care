import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  importFleetFinesse,
  type FleetImportRow,
  type FleetImportResult,
} from "@/lib/fleet-import.functions";

export const Route = createFileRoute("/violations_/import")({
  head: () => ({ meta: [{ title: "Import Rentals (Fleet Finesse) — Camauto Rentals" }] }),
  component: ImportPage,
});

type TargetKey = keyof FleetImportRow;

const FIELDS: { key: TargetKey; label: string; aliases: string[] }[] = [
  { key: "fullName", label: "Full Name", aliases: ["name", "full name", "renter", "customer", "driver"] },
  { key: "firstName", label: "First Name", aliases: ["first", "first name", "fname"] },
  { key: "lastName", label: "Last Name", aliases: ["last", "last name", "lname", "surname"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "mail"] },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "cell", "tel"] },
  { key: "licenseNumber", label: "License #", aliases: ["license", "license number", "dl", "dl number", "license #", "lic"] },
  { key: "dlState", label: "License State", aliases: ["dl state", "license state", "state issued", "lic state"] },
  { key: "licenseExpiry", label: "License Expiry", aliases: ["expiry", "expiration", "dl exp", "license exp", "exp date"] },
  { key: "dateOfBirth", label: "Date of Birth", aliases: ["dob", "birth", "date of birth", "birthday"] },
  { key: "plate", label: "Plate", aliases: ["plate", "license plate", "tag", "vehicle plate", "reg"] },
  { key: "startDate", label: "Start Date", aliases: ["start", "start date", "pickup", "rental start", "from"] },
  { key: "endDate", label: "End Date", aliases: ["end", "end date", "return", "rental end", "to", "dropoff"] },
  { key: "tags", label: "Tags", aliases: ["tag", "tags", "label", "labels", "category", "notes"] },
];

const NONE = "__none__";

function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const importFn = useServerFn(importFleetFinesse);

  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<TargetKey, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f.key, NONE])) as Record<TargetKey, string>,
  );
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<FleetImportResult | null>(null);

  const handleFile = (file: File) => {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = (res.meta.fields ?? []).filter(Boolean);
        setColumns(cols);
        setRows(res.data);
        setFileName(file.name);
        // Auto-map by alias matching
        const next = Object.fromEntries(FIELDS.map((f) => [f.key, NONE])) as Record<TargetKey, string>;
        for (const f of FIELDS) {
          const hit = cols.find((c) => {
            const lc = c.toLowerCase().trim();
            return lc === f.label.toLowerCase() || f.aliases.includes(lc) || f.aliases.some((a) => lc.includes(a));
          });
          if (hit) next[f.key] = hit;
        }
        setMapping(next);
        toast.success(`Loaded ${res.data.length} rows from ${file.name}`);
      },
      error: (e) => toast.error(`Parse failed: ${e.message}`),
    });
  };

  const mappedRows: FleetImportRow[] = useMemo(() => {
    return rows.map((r) => {
      const out: FleetImportRow = {};
      for (const f of FIELDS) {
        const col = mapping[f.key];
        if (col && col !== NONE) (out as any)[f.key] = (r[col] ?? "").toString();
      }
      return out;
    });
  }, [rows, mapping]);

  const hasNameMapped = mapping.fullName !== NONE || mapping.firstName !== NONE;

  const doImport = async () => {
    if (!mappedRows.length) return;
    setImporting(true);
    try {
      const res = await importFn({ data: { rows: mappedRows, fileName } });
      setResult(res);
      toast.success(
        `Imported: ${res.driversCreated} new renters, ${res.rentalsCreated} rentals`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Import Rentals"
        subtitle="Upload a Fleet Finesse CSV — auto-map columns and import renters + rentals"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{fileName || "No file selected"}</p>
              <p className="text-sm text-muted-foreground">
                CSV from Fleet Finesse (or any rental export)
              </p>
            </div>
            <Button onClick={() => fileRef.current?.click()} variant="outline">
              <Upload className="mr-2 h-4 w-4" /> Choose CSV File
            </Button>
          </div>
        </CardContent>
      </Card>

      {columns.length > 0 && (
        <>
          <Card className="mb-4">
            <CardContent className="p-6">
              <h2 className="mb-1 font-semibold">Map Columns</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                We auto-matched what we could. Adjust any field below. Map either Full Name, or First
                + Last name.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <Label className="text-xs">{f.label}</Label>
                    <Select
                      value={mapping[f.key]}
                      onValueChange={(val) =>
                        setMapping((m) => ({ ...m, [f.key]: val }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— Not mapped —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— Not mapped —</SelectItem>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/40 text-left uppercase text-muted-foreground">
                    <tr>
                      {FIELDS.filter((f) => mapping[f.key] !== NONE).map((f) => (
                        <th key={f.key} className="p-2">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {FIELDS.filter((f) => mapping[f.key] !== NONE).map((f) => (
                          <td key={f.key} className="p-2">
                            {(r as any)[f.key] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">{rows.length} rows ready</span>
            <Button
              size="lg"
              disabled={importing || !hasNameMapped}
              onClick={doImport}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Import {rows.length} Rows
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {result && (
        <Card className="mt-4 border-emerald-300 bg-emerald-50">
          <CardContent className="p-6 text-sm">
            <h2 className="mb-2 font-semibold text-emerald-900">Import Complete</h2>
            <ul className="space-y-1 text-emerald-900">
              <li>✅ {result.driversCreated} new renters created</li>
              <li>🔗 {result.driversMatched} matched to existing renters</li>
              <li>✅ {result.rentalsCreated} rentals created</li>
              <li>⏭️ {result.rentalsSkipped} rentals skipped (no vehicle match / duplicate / no date)</li>
            </ul>
            {result.unmatchedVehicles.length > 0 && (
              <p className="mt-3 text-amber-800">
                ⚠️ Plates with no matching fleet vehicle: {result.unmatchedVehicles.join(", ")}
              </p>
            )}
            {result.errors.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-red-700">
                  {result.errors.length} error(s)
                </summary>
                <ul className="mt-1 list-disc pl-5 text-red-700">
                  {result.errors.slice(0, 30).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
