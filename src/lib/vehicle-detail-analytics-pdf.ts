import type { Vehicle } from "@/lib/mock/data";
import { fmtMoney, fmtDate } from "@/lib/mock/data";
import type { VehicleFinancials } from "@/lib/vehicle-financials";
import type { AvgExpRow } from "@/lib/vehicle-analytics";
import { groupExpenseItems } from "@/lib/grouped-expenses";
import { drawBrandedPdfHeader, finalizeBrandedPdf } from "@/lib/branded-pdf";
import { BRAND_RGB } from "@/lib/branding";

/** Values are supplied by the visible vehicle tab; no independent financial math. */
export async function renderVehicleDetailAnalyticsPdf(vehicle: Vehicle, fin: VehicleFinancials,
  average: { mine?: AvgExpRow; fleetAvgPerVehicle: number }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 36, width = doc.internal.pageSize.getWidth() - 72;
  const bottom = doc.internal.pageSize.getHeight() - 44;
  const header = () => drawBrandedPdfHeader(doc, "Vehicle Analytics / P&L", "All Time");
  let y = header();
  function room(height: number) {
    if (y + height > bottom) { doc.addPage(); y = header(); }
  }
  function line(text: string, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 11 : 9);
    doc.setTextColor(...BRAND_RGB.dark);
    const lines: string[] = doc.splitTextToSize(text, width);
    for (const textLine of lines) { room(15); doc.text(textLine, left, y + 11); y += 15; }
  }
  function section(title: string) {
    room(45); y += 10;
    doc.setDrawColor(...BRAND_RGB.green); doc.line(left, y, left + width, y);
    y += 5; line(title, true); y += 4;
  }
  function entry(description: string, amount: number) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const lines: string[] = doc.splitTextToSize(description, width - 95);
    const height = Math.max(1, lines.length) * 13 + 8;
    room(height);
    doc.setTextColor(...BRAND_RGB.dark);
    doc.text(lines, left, y + 11);
    doc.setTextColor(...(amount < 0 ? BRAND_RGB.red : BRAND_RGB.dark));
    doc.text(fmtMoney(amount), left + width, y + 11, { align: "right" });
    y += height;
  }
  line(`${vehicle.make} ${vehicle.model} · ${vehicle.year}`.toUpperCase(), true);
  line(`${vehicle.id} · Plate ${vehicle.plate} · VIN ${vehicle.vin}`);
  section("Summary");
  entry("Income (paid)", fin.totalIncome);
  entry("Expenses", fin.totalExpenses);
  entry("Net P&L", fin.netPnl);
  line(`ROI: ${fin.roi == null ? "—" : `${fin.roi.toFixed(0)}%`}`);
  entry("Average expense per month", average.mine?.avg ?? 0);
  line(average.mine ? `${fmtMoney(average.mine.total)} over ${average.mine.months.toFixed(1)} months` : "No expenses yet");
  entry("Fleet average expense per month", average.fleetAvgPerVehicle);
  section("Income (payments collected)");
  if (!fin.incomeLineItems.length) line("No income entries.");
  for (const item of fin.incomeLineItems) {
    entry(`${fmtDate(item.date)} · ${item.renterName} · ${item.method ?? "paid"}`, item.amount);
  }
  section("Expense breakdown");
  const grouped = groupExpenseItems(fin.expenseLineItems);
  if (!grouped.length) line("No expense entries.");
  for (const item of grouped) {
    const split = [item.parts != null ? `Parts ${fmtMoney(item.parts)}` : "",
      item.labor != null ? `Labor ${fmtMoney(item.labor)}` : "",
      item.other ? `Other ${fmtMoney(item.other)}` : ""].filter(Boolean).join(" · ");
    entry(`${fmtDate(item.date)} · ${item.name}${item.vendor ? ` · ${item.vendor}` : ""}\n${split || item.category}`, item.total);
  }
  finalizeBrandedPdf(doc, { headerOnPages: "none" });
  return doc.output("blob");
}