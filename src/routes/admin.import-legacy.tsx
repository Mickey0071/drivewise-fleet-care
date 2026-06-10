import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, Trash2, AlertTriangle, FileText, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/admin/import-legacy")({
  head: () => ({ meta: [{ title: "Import Legacy Rentals — Camauto Rentals" }] }),
  component: ImportLegacyPage,
});

// Columns mapped by exact name from the CSV.
const COLUMNS = [
  "source",
  "order_number",
  "vehicle",
  "year",
  "color",
  "plate",
  "renter_name",
  "pickup_location",
  "start_datetime",
  "end_datetime",
  "status",
  "notes",
] as const;

type LegacyRow = Partial<Record<(typeof COLUMNS)[number], string | null>>;

const BATCH = 50;

function ImportLegacyPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const handleFile = (file: File) => {
    setNeedsConfirm(false);
    setProgress(0);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        setHeaders((res.meta.fields ?? []).filter(Boolean));
        setRows(res.data);
        setFileName(file.name);
        toast.success(`Loaded ${res.data.length} rows from ${file.name}`);
      },
      error: (e) => toast.error(`Parse failed: ${e.message}`),
    });
  };

  const mapRows = (): LegacyRow[] =>
    rows.map((r) => {
      const out: LegacyRow = {};
      for (const c of COLUMNS) {
        const v = r[c];
        out[c] = v != null && String(v).trim() !== "" ? String(v).trim() : null;
      }
      return out;
    });

  const startImport = async () => {
    if (!rows.length) return;
    // Check existing count first.
    const { count, error } = await supabase
      .from("legacy_rentals")
      .select("id", { count: "exact", head: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((count ?? 0) > 0 && !needsConfirm) {
      setExistingCount(count ?? 0);
      setNeedsConfirm(true);
      return;
    }
    await runImport();
  };

  const runImport = async () => {
    setNeedsConfirm(false);
    setImporting(true);
    setProgress(0);
    const payload = mapRows();
    let inserted = 0;
    try {
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase.from("legacy_rentals").insert(slice as never);
        if (error) throw new Error(error.message);
        inserted += slice.length;
        setProgress(inserted);
      }
      toast.success(`Imported ${inserted} rows.`);
      setRows([]);
      setHeaders([]);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Delete ALL rows in legacy_rentals? This cannot be undone.")) return;
    setClearing(true);
    try {
      const { error } = await supabase
        .from("legacy_rentals")
        .delete()
        .not("id", "is", null);
      if (error) throw new Error(error.message);
      toast.success("All legacy rentals cleared.");
      setExistingCount(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Import Legacy Rentals"
        subtitle="Upload a CSV of historical rentals — writes only to the legacy_rentals table"
        action={
          <Button variant="outline" onClick={clearAll} disabled={clearing}>
            {clearing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Clear all legacy rentals
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
                Columns mapped by exact name: {COLUMNS.join(", ")}
              </p>
            </div>
            <Button onClick={() => fileRef.current?.click()} variant="outline">
              <Upload className="mr-2 h-4 w-4" /> Choose CSV File
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-6">
            <p className="mb-3 text-sm text-muted-foreground">
              {rows.length} rows ready. Detected headers:{" "}
              <span className="font-mono">{headers.join(", ") || "—"}</span>
            </p>

            {needsConfirm && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  legacy_rentals already has <strong>{existingCount}</strong> rows. Importing will
                  add {rows.length} more (existing rows are kept). Click{" "}
                  <strong>Confirm Import</strong> to proceed.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              {importing ? (
                <span className="text-sm text-muted-foreground">
                  Imported {progress} of {rows.length}…
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Ready to import</span>
              )}
              <Button
                size="lg"
                disabled={importing}
                onClick={startImport}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing… {progress}/
                    {rows.length}
                  </>
                ) : needsConfirm ? (
                  <>Confirm Import ({rows.length})</>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" /> Import {rows.length} Rows
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AgreementUploadSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy agreement PDF uploads — matched to legacy_rentals by renter name.
// Files are stored in the private `legacy-agreements` bucket and a 1-year
// signed URL is saved on legacy_rentals.agreement_pdf_url.
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "") // drop extension
    .replace(/[^a-z]+/g, " ") // keep letters only
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");
}

type UploadResult = {
  file: string;
  status: "matched" | "no-match" | "error";
  renter?: string;
  message?: string;
};

function AgreementUploadSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    setResults([]);
    const out: UploadResult[] = [];
    try {
      const { data: rentals, error } = await supabase
        .from("legacy_rentals")
        .select("id, renter_name");
      if (error) throw new Error(error.message);

      const index = new Map<string, { id: string; renter_name: string | null }>();
      for (const r of rentals ?? []) {
        if (r.renter_name) index.set(normalizeName(r.renter_name), r);
      }

      for (const file of files) {
        const key = normalizeName(file.name);
        const match = index.get(key);
        if (!match) {
          out.push({ file: file.name, status: "no-match" });
          setResults([...out]);
          continue;
        }
        try {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${match.id}/${Date.now()}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from("legacy-agreements")
            .upload(path, file, { contentType: file.type || "application/pdf", upsert: true });
          if (upErr) throw new Error(upErr.message);
          const { data: signed, error: signErr } = await supabase.storage
            .from("legacy-agreements")
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "sign failed");
          const { error: updErr } = await supabase
            .from("legacy_rentals")
            .update({ agreement_pdf_url: signed.signedUrl })
            .eq("id", match.id);
          if (updErr) throw new Error(updErr.message);
          out.push({ file: file.name, status: "matched", renter: match.renter_name ?? "" });
        } catch (e) {
          out.push({ file: file.name, status: "error", message: e instanceof Error ? e.message : String(e) });
        }
        setResults([...out]);
      }
      const ok = out.filter((r) => r.status === "matched").length;
      toast.success(`Uploaded ${ok} of ${files.length} agreements.`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardContent className="p-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Upload old rental agreements (PDFs)</h3>
          <p className="text-sm text-muted-foreground">
            Name each file with the renter's name (e.g. <span className="font-mono">John Smith.pdf</span>).
            Files are matched to legacy rentals by renter name and saved securely.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">
            {files.length ? `${files.length} file(s) selected` : "No PDFs selected"}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => inputRef.current?.click()} variant="outline" disabled={busy}>
              <Upload className="mr-2 h-4 w-4" /> Choose PDF Files
            </Button>
            {files.length > 0 && (
              <Button onClick={run} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload &amp; Match {files.length}
              </Button>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="mt-4 space-y-1 text-sm">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                {r.status === "matched" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-600" />
                )}
                <span className="font-mono">{r.file}</span>
                <span className="text-muted-foreground">
                  {r.status === "matched"
                    ? `→ ${r.renter}`
                    : r.status === "no-match"
                      ? "→ no matching renter found"
                      : `→ error: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}