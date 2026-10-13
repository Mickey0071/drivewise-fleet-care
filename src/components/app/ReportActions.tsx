import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadCSV, printPage, type CsvRow } from "@/lib/exports";
import { downloadBrandedXlsx, titleFromFilename } from "@/lib/branded-xlsx";
import { downloadBrandedTablePdf } from "@/lib/branded-pdf";

interface CsvSpec {
  filename: string;
  headers: string[];
  rows: CsvRow[];
  /** Optional report title / period shown in the branded Excel + PDF header */
  title?: string;
  period?: string;
}

interface Props {
  /** Single export (back-compat) */
  csv?: CsvSpec;
  /** Multiple exports — renders a button set per spec */
  csvs?: CsvSpec[];
  hidePrint?: boolean;
}

export function ReportActions({ csv, csvs, hidePrint }: Props) {
  const all: CsvSpec[] = csvs ?? (csv ? [csv] : []);
  const [busy, setBusy] = useState<string | null>(null);
  const multi = all.length > 1;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {all.map((spec) => {
        const label = multi ? titleFromFilename(spec.filename) : "";
        const title = spec.title ?? titleFromFilename(spec.filename);
        const sheet = { name: title, title, period: spec.period, headers: spec.headers, rows: spec.rows };
        return (
          <div key={spec.filename} className="flex flex-wrap items-center gap-1">
            <Button size="sm" disabled={busy !== null}
              onClick={() => run(spec.filename + "x", () => downloadBrandedXlsx(spec.filename, [sheet]))}>
              {busy === spec.filename + "x" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}
              {multi ? `${label} (Excel)` : "Download Excel"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => run(spec.filename + "p", () => downloadBrandedTablePdf(spec.filename, sheet))}>
              <FileText className="mr-1.5 h-4 w-4" /> PDF
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground"
              onClick={() => downloadCSV(spec.filename, spec.headers, spec.rows)}>
              Raw data (CSV)
            </Button>
          </div>
        );
      })}
      {!hidePrint && (
        <Button variant="outline" size="sm" onClick={printPage}>
          <Printer className="mr-1.5 h-4 w-4" />
          Print
        </Button>
      )}
    </div>
  );
}
