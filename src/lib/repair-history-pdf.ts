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

const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];
const RGB_GREEN: [number, number, number] = [45, 184, 75];

const money = (n: number | null) =>
  n == null || Number.isNaN(n)
    ? "—"
    : `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderRepairHistoryPdf(
  vehicle: Pick<Vehicle, "year" | "make" | "model" | "plate" | "vin">,
  rows: RepairHistoryRow[],
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  const contentW = right - left;
  let y = 50;

  const ensure = (need: number) => {
    if (y + need > pageH - 50) {
      doc.addPage();
      y = 50;
    }
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

  // Totals
  const totalRepairs = rows.filter(r => r.kind === "Repair").reduce((s, r) => s + r.amount, 0);
  const totalExpenses = rows.filter(r => r.kind === "Expense").reduce((s, r) => s + r.amount, 0);
  const grandTotal = totalRepairs + totalExpenses;

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

  // Table columns
  const widths = [64, 52, 82, 96, contentW - 64 - 52 - 82 - 96 - 60 - 60 - 70, 60, 60, 70];
  const headers = ["Date", "Type", "Category", "Vendor", "Description", "Parts", "Labor", "Amount"];
  const rightAligned = new Set([5, 6, 7]);

  const drawHeader = () => {
    doc.setFillColor(240, 240, 240);
    doc.rect(left, y, contentW, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    let x = left;
    headers.forEach((h, i) => {
      const align = rightAligned.has(i) ? "right" : "left";
      doc.text(h.toUpperCase(), align === "right" ? x + widths[i] - 4 : x + 4, y + 12, { align });
      x += widths[i];
    });
    y += 18;
  };

  drawHeader();
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.5);

  if (rows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text("No repair or expense records for this vehicle.", left + 4, y + 14);
    y += 24;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_TEXT);
    for (const r of rows) {
      const cells = [
        r.date,
        r.kind,
        r.category || "—",
        r.vendor || "—",
        r.description || "—",
        money(r.parts),
        money(r.labor),
        money(r.amount),
      ];
      // Wrap description for row height
      const descLines = doc.splitTextToSize(cells[4] || "—", widths[4] - 8) as string[];
      const rowH = Math.max(16, descLines.length * 10 + 6);
      ensure(rowH + 4);
      let x = left;
      cells.forEach((cell, i) => {
        const align = rightAligned.has(i) ? "right" : "left";
        if (i === 4) {
          doc.text(descLines, x + 4, y + 10);
        } else {
          doc.text(String(cell), align === "right" ? x + widths[i] - 4 : x + 4, y + 10, { align });
        }
        x += widths[i];
      });
      y += rowH;
      doc.setDrawColor(235, 235, 235);
      doc.line(left, y, right, y);
    }
  }

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

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(
      `Repair History — ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.plate || "—"})`,
      left,
      pageH - 20,
    );
    doc.text(`Page ${p} of ${pageCount}`, right, pageH - 20, { align: "right" });
  }

  return doc.output("blob");
}