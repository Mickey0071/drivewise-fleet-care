import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import { downloadCSV, printPage, type CsvRow } from "@/lib/exports";

interface CsvSpec {
  filename: string;
  headers: string[];
  rows: CsvRow[];
}

interface Props {
  /** Single CSV export (back-compat) */
  csv?: CsvSpec;
  /** Multiple CSVs — renders a button per spec */
  csvs?: CsvSpec[];
  hidePrint?: boolean;
}

export function ReportActions({ csv, csvs, hidePrint }: Props) {
  const all: CsvSpec[] = csvs ?? (csv ? [csv] : []);
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {all.map(spec => (
        <Button
          key={spec.filename}
          variant="outline"
          size="sm"
          onClick={() => downloadCSV(spec.filename, spec.headers, spec.rows)}
        >
          <Download className="mr-1.5 h-4 w-4" />
          {all.length > 1 ? spec.filename.replace(/\.csv$/i, "") : "Export CSV"}
        </Button>
      ))}
      {!hidePrint && (
        <Button variant="outline" size="sm" onClick={printPage}>
          <Printer className="mr-1.5 h-4 w-4" />
          Print / PDF
        </Button>
      )}
    </div>
  );
}
