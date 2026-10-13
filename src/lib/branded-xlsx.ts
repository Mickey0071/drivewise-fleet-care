import type ExcelJSType from "exceljs";
import {
  BRAND_COLORS, BRAND_COMPANY, FMT_CURRENCY, FMT_PERCENT, generatedStamp, inferColumnKind, logoBytes,
  type ColumnKind,
} from "@/lib/branding";

type Cell = string | number | null | undefined;

export interface BrandedSheetSpec {
  name: string;
  title: string;
  period?: string;
  headers: string[];
  rows: Cell[][];
  /** Override inferred column kinds. Percent values are expected as fractions (0.25 = 25%) unless percentIsWhole. */
  kinds?: ColumnKind[];
  percentIsWhole?: boolean;
  totalsRow?: boolean;
}

const fill = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF" + hex } });

/** Writes the standard branded header (logo + company block + title/period/date). Returns next free row. */
export function addBrandedHeader(wb: ExcelJSType.Workbook, ws: ExcelJSType.Worksheet, title: string, period?: string): number {
  const id = wb.addImage({ buffer: logoBytes() as any, extension: "jpeg" });
  ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 76 }, editAs: "oneCell" });
  const lines: [string, boolean][] = [
    [BRAND_COMPANY.legal, true], [BRAND_COMPANY.address, false], [BRAND_COMPANY.contact, false],
  ];
  lines.forEach(([t, bold], i) => {
    const c = ws.getCell(i + 1, 3);
    c.value = t;
    c.font = { name: "Arial", size: bold ? 12 : 9, bold, color: { argb: "FF" + (bold ? BRAND_COLORS.green : BRAND_COLORS.dark) } };
  });
  ws.getRow(1).height = 20;
  const t = ws.getCell(6, 1);
  t.value = title;
  t.font = { name: "Arial", size: 16, bold: true, color: { argb: "FF" + BRAND_COLORS.dark } };
  const p = ws.getCell(7, 1);
  p.value = `${period ? `Period: ${period}   ·   ` : ""}Generated: ${generatedStamp()}`;
  p.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
  return 9;
}

export function styleHeaderRow(row: ExcelJSType.Row) {
  row.eachCell((c) => {
    c.fill = fill(BRAND_COLORS.dark);
    c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: "FF" + BRAND_COLORS.green } } };
  });
  row.height = 20;
}

export function addBrandedSheet(wb: ExcelJSType.Workbook, spec: BrandedSheetSpec) {
  const ws = wb.addWorksheet(spec.name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"), {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: `&L${BRAND_COMPANY.footer}&RPage &P of &N` },
  });
  const headerRowIdx = addBrandedHeader(wb, ws, spec.title, spec.period);
  const kinds = spec.headers.map((h, i) =>
    spec.kinds?.[i] ?? inferColumnKind(h, spec.rows.find((r) => typeof r[i] === "number")?.[i]),
  );

  const hr = ws.getRow(headerRowIdx);
  spec.headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  styleHeaderRow(hr);

  spec.rows.forEach((r, ri) => {
    const row = ws.getRow(headerRowIdx + 1 + ri);
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      const kind = kinds[ci];
      let val: Cell = v ?? null;
      if (kind === "percent" && typeof val === "number" && spec.percentIsWhole) val = val / 100;
      c.value = val as any;
      c.font = { name: "Arial", size: 10, color: { argb: "FF" + BRAND_COLORS.dark } };
      if (typeof val === "number") {
        if (kind === "currency") c.numFmt = FMT_CURRENCY;
        else if (kind === "percent") c.numFmt = FMT_PERCENT;
        if (kind === "currency" || kind === "percent") {
          c.font = { ...c.font, color: { argb: "FF" + (val < 0 ? BRAND_COLORS.red : val > 0 ? BRAND_COLORS.green : BRAND_COLORS.dark) } };
        }
        c.alignment = { horizontal: "right" };
      }
      if (ri % 2 === 1) c.fill = fill(BRAND_COLORS.band);
    });
  });

  const lastData = headerRowIdx + spec.rows.length;
  if (spec.totalsRow !== false && spec.rows.length > 0 && kinds.some((k) => k === "currency")) {
    const tr = ws.getRow(lastData + 1);
    tr.getCell(1).value = "TOTAL";
    kinds.forEach((k, i) => {
      if (k !== "currency") return;
      const col = ws.getColumn(i + 1).letter;
      const c = tr.getCell(i + 1);
      c.value = { formula: `SUM(${col}${headerRowIdx + 1}:${col}${lastData})` } as any;
      c.numFmt = FMT_CURRENCY;
      c.alignment = { horizontal: "right" };
    });
    tr.eachCell({ includeEmpty: true }, (c, n) => {
      if (n > spec.headers.length) return;
      c.font = { name: "Arial", bold: true, color: { argb: "FF" + BRAND_COLORS.green } };
      c.border = { top: { style: "medium", color: { argb: "FF" + BRAND_COLORS.green } } };
    });
  }

  // auto-fit
  spec.headers.forEach((h, i) => {
    let w = h.length;
    for (const r of spec.rows) {
      const v = r[i];
      const len = typeof v === "number" ? 14 : String(v ?? "").length;
      if (len > w) w = len;
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 60);
  });
  if (ws.getColumn(1).width! < 18) ws.getColumn(1).width = 18;

  ws.views = [{ state: "frozen", ySplit: headerRowIdx, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${headerRowIdx}:${headerRowIdx}`;
  return ws;
}

export async function newBrandedWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Camauto Rentals";
  wb.created = new Date();
  return wb;
}

export async function saveWorkbook(wb: ExcelJSType.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename.replace(/\.csv$/i, "")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One-call branded Excel download for any tabular report. */
export async function downloadBrandedXlsx(filename: string, sheets: BrandedSheetSpec[]) {
  const wb = await newBrandedWorkbook();
  for (const s of sheets) addBrandedSheet(wb, s);
  await saveWorkbook(wb, filename);
}

export function titleFromFilename(filename: string) {
  return filename.replace(/\.(csv|xlsx)$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
