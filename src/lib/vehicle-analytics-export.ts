import { BRAND_COLORS, BRAND_RGB, FMT_CURRENCY, FMT_PERCENT } from "@/lib/branding";
import { addBrandedHeader, newBrandedWorkbook, saveWorkbook, styleHeaderRow } from "@/lib/branded-xlsx";
import { drawBrandedPdfHeader, finalizeBrandedPdf } from "@/lib/branded-pdf";
import type { VARow } from "@/lib/vehicle-analytics";

const HEADERS = ["Rank", "Vehicle", "Days Rented", "Util %", "Revenue", "Expenses", "Net"];
const fill = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF" + hex } });
const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function summarize(rows: VARow[]) {
  const rev = rows.reduce((s, r) => s + r.rev, 0);
  const exp = rows.reduce((s, r) => s + r.exp, 0);
  const days = rows.reduce((s, r) => s + r.daysRented, 0);
  return {
    rev, exp, net: rev - exp, days, fleet: rows.length,
    avgDays: rows.length ? days / rows.length : 0,
    best: rows[0], worst: rows.length ? rows[rows.length - 1] : undefined,
  };
}

export async function exportVehicleAnalyticsXlsx(rows: VARow[], period: string, filename: string) {
  const wb = await newBrandedWorkbook();
  const ws = wb.addWorksheet("Vehicle Analytics", {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: "&LCamauto Rentals — Confidential&RPage &P of &N" },
  });
  let r = addBrandedHeader(wb, ws, "Vehicle Analytics", period);
  const s = summarize(rows);
  const tiles: [string, string | number, string?][] = [
    ["Total Revenue", s.rev, FMT_CURRENCY], ["Total Expenses", s.exp, FMT_CURRENCY], ["Net", s.net, FMT_CURRENCY],
    ["Fleet Size", s.fleet], ["Avg Days Rented", Math.round(s.avgDays * 10) / 10],
    ["Best Performer", s.best ? `${s.best.label} (${money(s.best.net)})` : "—"],
    ["Worst Performer", s.worst ? `${s.worst.label} (${money(s.worst.net)})` : "—"],
  ];
  tiles.forEach(([k, v, f]) => {
    const a = ws.getCell(r, 1); a.value = k; a.font = { name: "Arial", bold: true, color: { argb: "FF" + BRAND_COLORS.green } };
    const b = ws.getCell(r, 2); b.value = v; b.font = { name: "Arial", bold: true };
    if (f) b.numFmt = f;
    r++;
  });
  r++;
  const headerRow = r;
  const hr = ws.getRow(r); HEADERS.forEach((h, i) => (hr.getCell(i + 1).value = h)); styleHeaderRow(hr);
  rows.forEach((v, i) => {
    const row = ws.getRow(++r);
    [i < 3 ? `#${i + 1}` : "", v.label, v.daysRented, v.utilization / 100, v.rev, v.exp, v.net].forEach((val, ci) => {
      const c = row.getCell(ci + 1); c.value = val as any;
      c.font = { name: "Arial", color: { argb: "FF" + (v.net < 0 ? BRAND_COLORS.red : BRAND_COLORS.dark) }, bold: i < 3 };
      if (ci === 3) c.numFmt = '0%';
      if (ci >= 4) c.numFmt = FMT_CURRENCY;
      if (i < 3) c.fill = fill("DDF3E5"); else if (v.net < 0) c.fill = fill("FDECEC"); else if (i % 2) c.fill = fill(BRAND_COLORS.band);
    });
  });
  const tr = ws.getRow(++r);
  tr.getCell(2).value = "TOTAL";
  const first = headerRow + 1, last = r - 1;
  if (rows.length) {
    tr.getCell(3).value = { formula: `SUM(C${first}:C${last})` } as any;
    ["E", "F", "G"].forEach((col, i) => { const c = tr.getCell(5 + i); c.value = { formula: `SUM(${col}${first}:${col}${last})` } as any; c.numFmt = FMT_CURRENCY; });
  }
  tr.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 7) { c.font = { name: "Arial", bold: true, color: { argb: "FF" + BRAND_COLORS.green } }; c.border = { top: { style: "medium", color: { argb: "FF" + BRAND_COLORS.green } } }; } });
  [8, 34, 13, 9, 15, 15, 15].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  void FMT_PERCENT;

  // Chart sheet: net profit by vehicle as horizontal data bars
  const cs = wb.addWorksheet("Net Profit Chart", { views: [{ showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  let cr = addBrandedHeader(wb, cs, "Net Profit by Vehicle", period);
  const ch = cs.getRow(cr); ["Vehicle", "Net", "Net Profit"].forEach((h, i) => (ch.getCell(i + 1).value = h)); styleHeaderRow(ch);
  const cFirst = cr + 1;
  rows.forEach((v) => {
    const row = cs.getRow(++cr);
    row.getCell(1).value = v.label;
    const n = row.getCell(2); n.value = v.net; n.numFmt = FMT_CURRENCY; n.font = { color: { argb: "FF" + (v.net < 0 ? BRAND_COLORS.red : BRAND_COLORS.green) } };
    row.getCell(3).value = v.net; row.getCell(3).numFmt = ';;;';
  });
  if (rows.length) {
    cs.addConditionalFormatting({
      ref: `C${cFirst}:C${cr}`,
      rules: [{ type: "dataBar", priority: 1, gradient: false, color: { argb: "FF" + BRAND_COLORS.green }, negativeFillColor: { argb: "FF" + BRAND_COLORS.red }, axisPosition: "middle" } as any],
    });
  }
  cs.getColumn(1).width = 34; cs.getColumn(2).width = 15; cs.getColumn(3).width = 70;
  cs.views = [{ state: "frozen", ySplit: cFirst - 1, showGridLines: false }];
  await saveWorkbook(wb, filename);
}

export async function exportVehicleAnalyticsPdf(rows: VARow[], period: string, filename: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const left = 36, width = W - 72;
  const head = () => drawBrandedPdfHeader(doc, "Vehicle Analytics", period);
  let y = head();
  const s = summarize(rows);
  const tiles: [string, string][] = [
    ["Total Revenue", money(s.rev)], ["Total Expenses", money(s.exp)], ["Net", money(s.net)],
    ["Fleet Size", String(s.fleet)], ["Avg Days Rented", s.avgDays.toFixed(1)],
    ["Best", s.best ? `${s.best.label} ${money(s.best.net)}` : "—"], ["Worst", s.worst ? `${s.worst.label} ${money(s.worst.net)}` : "—"],
  ];
  const tw = width / tiles.length;
  tiles.forEach(([k, v], i) => {
    const x = left + i * tw;
    doc.setDrawColor(...BRAND_RGB.green); doc.setLineWidth(1); doc.rect(x + 2, y, tw - 4, 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...BRAND_RGB.muted); doc.text(k.toUpperCase(), x + 6, y + 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(k === "Best" || k === "Worst" ? 7 : 11);
    doc.setTextColor(...(k === "Net" && s.net < 0 ? BRAND_RGB.red : BRAND_RGB.dark));
    doc.text(doc.splitTextToSize(v, tw - 12).slice(0, 2), x + 6, y + 26);
  });
  y += 54;
  const cols = [40, 250, 80, 70, 100, 100, width - 640];
  const xs = cols.reduce<number[]>((a, w, i) => [...a, i ? a[i - 1] + cols[i - 1] : left], []);
  const right = (i: number) => i >= 2;
  const drawHead = () => {
    doc.setFillColor(...BRAND_RGB.dark); doc.rect(left, y, width, 18, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    HEADERS.forEach((h, i) => doc.text(h, right(i) ? xs[i] + cols[i] - 4 : xs[i] + 4, y + 12, { align: right(i) ? "right" : "left" }));
    y += 18;
  };
  drawHead();
  const line = (cells: string[], bg: [number, number, number] | null, color: [number, number, number], bold: boolean) => {
    if (y + 16 > H - 40) { doc.addPage(); y = head(); drawHead(); }
    if (bg) { doc.setFillColor(...bg); doc.rect(left, y, width, 16, "F"); }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8); doc.setTextColor(...color);
    cells.forEach((t, i) => doc.text(t, right(i) ? xs[i] + cols[i] - 4 : xs[i] + 4, y + 11, { align: right(i) ? "right" : "left" }));
    y += 16;
  };
  rows.forEach((v, i) => line(
    [i < 3 ? `#${i + 1}` : "", v.label, String(v.daysRented), `${v.utilization.toFixed(0)}%`, money(v.rev), money(v.exp), money(v.net)],
    i < 3 ? [221, 243, 229] : v.net < 0 ? [253, 236, 236] : i % 2 ? BRAND_RGB.band : null,
    v.net < 0 ? BRAND_RGB.red : BRAND_RGB.dark, i < 3,
  ));
  doc.setDrawColor(...BRAND_RGB.green); doc.setLineWidth(1.5); doc.line(left, y, left + width, y);
  line(["", "TOTAL", String(s.days), "", money(s.rev), money(s.exp), money(s.net)], null, BRAND_RGB.green, true);

  // Bar chart
  doc.addPage(); y = head();
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BRAND_RGB.dark);
  doc.text("Net Profit by Vehicle", left, y); y += 14;
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  const labelW = 200, valW = 80, chartW = width - labelW - valW;
  const hasNeg = rows.some(r => r.net < 0);
  const zeroX = left + labelW + (hasNeg ? chartW / 2 : 0);
  const scale = (hasNeg ? chartW / 2 : chartW) / max;
  rows.forEach((v) => {
    if (y + 16 > H - 40) { doc.addPage(); y = head(); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_RGB.dark);
    doc.text(v.label.slice(0, 38), left, y + 10);
    const w = Math.abs(v.net) * scale;
    doc.setFillColor(...(v.net < 0 ? BRAND_RGB.red : BRAND_RGB.green));
    doc.rect(v.net < 0 ? zeroX - w : zeroX, y + 2, Math.max(w, 0.5), 10, "F");
    doc.setTextColor(...(v.net < 0 ? BRAND_RGB.red : BRAND_RGB.green));
    doc.text(money(v.net), left + width, y + 10, { align: "right" });
    y += 15;
  });
  finalizeBrandedPdf(doc, { headerOnPages: "none" });
  doc.save(filename);
}
