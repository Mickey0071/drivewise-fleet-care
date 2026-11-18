import { BRAND_RGB } from "@/lib/branding";
import { drawBrandedPdfHeader, finalizeBrandedPdf } from "@/lib/branded-pdf";
import type { Vehicle } from "@/lib/mock/data";

// ---------------------------------------------------------------------------
// Rendering only. This module does NOT decide what counts as a repair or
// expense — callers must build the `rows` array from the single source of
// truth (getVehicleFinancials.expenseLineItems in src/lib/vehicle-financials.ts
// which delegates to src/lib/money-rules.ts). The subtotals below are a
// straight sum of whatever the caller passed in and add no independent logic.
// ---------------------------------------------------------------------------

export interface RepairHistoryRow {
  date: string;
  kind: "Repair" | "Expense";
  category: string;
  vendor: string;
  description: string;
  parts: number | null;
  labor: number | null;
  amount: number;
}

const COLOR_TEXT: [number, number, number] = BRAND_RGB.dark;
const COLOR_MUTED: [number, number, number] = BRAND_RGB.muted;
const RGB_GREEN: [number, number, number] = BRAND_RGB.green;

const money = (n: number | null) =>
  n == null || Number.isNaN(n)
    ? "—"
    : `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderRepairHistoryPdf(
  vehicle: Pick<Vehicle, "year" | "make" | "model" | "plate" | "vin">,
  rows: RepairHistoryRow[],
  totals: { repairs: number; expenses: number; grand: number },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  const contentW = right - left;
  let y = drawBrandedPdfHeader(doc) + 10;

  const ensure = (need: number) => {
    if (y + need > pageH - 50) {
      doc.addPage();
      y = 100;
      return true;
    }
    return false;
  };

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("REPAIR HISTORY & EXPENSES", left, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    `${vehicle.year} ${vehicle.make} ${vehicle.model}  ·  Plate ${vehicle.plate || "—"}  ·  VIN ${vehicle.vin || "—"}`,
    left,
    y,
  );
  y += 14;
  doc.text(`Generated ${new Date().toLocaleString("en-US")}`, left, y);
  y += 14;

  // Totals — authoritative values from getVehicleFinancials (single source of
  // truth in src/lib/money-rules.ts + src/lib/vehicle-financials.ts). Rendered
  // rows below are display-only and MUST NOT feed any sum.
  const totalRepairs = totals.repairs;
  const totalExpenses = totals.expenses;
  const grandTotal = totals.grand;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  doc.text(
    `Repairs: ${money(totalRepairs)}   ·   Expenses: ${money(totalExpenses)}   ·   Total: ${money(grandTotal)}`,
    left,
    y,
  );
  y += 10;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(1.5);
  doc.line(left, y, right, y);
  y += 16;

  // Use a wide service column, keeping prices separate from descriptions.
  // Classification and subtotals stay exactly as supplied by the caller.
  const section = (kind: RepairHistoryRow["kind"], label: string, subtotal: number) => {
    const sectionRows = rows.filter(row => row.kind === kind);
    const isRepair = kind === "Repair";
    const widths = isRepair
      ? [66, contentW - 66 - 62 - 62 - 76, 62, 62, 76]
      : [66, contentW - 66 - 90, 90];
    const headers = isRepair
      ? ["Date", "Repair / Service", "Parts", "Labor", "Total"]
      : ["Date", "Expense / Service", "Price"];

    const drawHeader = (continued = false) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...RGB_GREEN);
      doc.text(`${label.toUpperCase()}${continued ? " (CONTINUED)" : ` (${sectionRows.length})`}`, left, y + 12);
      y += 24;
      doc.setFillColor(...BRAND_RGB.band);
      doc.rect(left, y, contentW, 22, "F");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_TEXT);
      let x = left;
      headers.forEach((header, i) => {
        const align = i >= 2 ? "right" : "left";
        doc.text(header, align === "right" ? x + widths[i] - 6 : x + 6, y + 14, { align });
        x += widths[i];
      });
      y += 22;
    };

    ensure(92);
    drawHeader();
    if (sectionRows.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(`No ${label.toLowerCase()} recorded.`, left + 6, y + 16);
      y += 30;
    }

    for (const row of sectionRows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const serviceLines = doc.splitTextToSize(row.description || row.category || "—", widths[1] - 12) as string[];
      const detail = [row.category, row.vendor && `Vendor: ${row.vendor}`].filter(Boolean).join(" | ");
      doc.setFontSize(8);
      const detailLines = detail ? doc.splitTextToSize(detail, widths[1] - 12) as string[] : [];
      const dateLines = doc.splitTextToSize(row.date || "—", widths[0] - 12) as string[];
      const lineCount = Math.max(dateLines.length, serviceLines.length + detailLines.length);
      let line = 0;
      // Split unusually long entries safely, repeating section/column headings.
      while (line < lineCount) {
        if (ensure(34)) drawHeader(true);
        const available = Math.max(1, Math.floor((pageH - 50 - y - 12) / 12));
        const chunk = Math.min(lineCount - line, available);
        const rowHeight = chunk * 12 + 12;
        const serviceX = left + widths[0] + 6;
        for (let offset = 0; offset < chunk; offset++) {
          const index = line + offset;
          const baseline = y + 15 + offset * 12;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...COLOR_MUTED);
          if (dateLines[index]) doc.text(dateLines[index], left + 6, baseline);
          if (index < serviceLines.length) {
            doc.setFontSize(9);
            doc.setTextColor(...COLOR_TEXT);
            doc.text(serviceLines[index], serviceX, baseline);
          } else if (detailLines[index - serviceLines.length]) {
            doc.text(detailLines[index - serviceLines.length], serviceX, baseline);
          }
        }
        if (line === 0) {
          const prices = isRepair ? [money(row.parts), money(row.labor), money(row.amount)] : [money(row.amount)];
          let x = left + widths[0] + widths[1];
          doc.setFontSize(9);
          doc.setTextColor(...COLOR_TEXT);
          prices.forEach((price, i) => {
            doc.setFont("helvetica", i === prices.length - 1 ? "bold" : "normal");
            doc.text(price, x + widths[i + 2] - 6, y + 15, { align: "right" });
            x += widths[i + 2];
          });
        }
        y += rowHeight;
        doc.setDrawColor(...BRAND_RGB.band);
        doc.setLineWidth(0.5);
        doc.line(left, y, right, y);
        line += chunk;
      }
    }
    if (ensure(32)) drawHeader(true);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(`${label} subtotal`, left + 6, y + 18);
    doc.text(money(subtotal), right - 6, y + 18, { align: "right" });
    y += 44;
  };

  section("Repair", "Repairs & Service", totalRepairs);
  section("Expense", "Expenses", totalExpenses);

  y += 14;
  ensure(60);
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(1);
  doc.line(left, y, right, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("Grand Total", left, y);
  doc.text(money(grandTotal), right, y, { align: "right" });

  finalizeBrandedPdf(doc, { title: "Repair History & Expenses" });
  return doc.output("blob");
}