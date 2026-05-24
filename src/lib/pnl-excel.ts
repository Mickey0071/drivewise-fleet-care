import ExcelJS from "exceljs";
import logoUrl from "@/assets/camauto-logo.jpeg";

export interface PnLExportData {
  periodLabel: string;
  revenue: { label: string; amount: number }[];
  expenses: { label: string; amount: number }[];
  payroll: {
    runId: string;
    period: string;
    staff: string;
    role: string;
    gross: number;
    net: number;
    status: string;
  }[];
  totals: { revenue: number; expenses: number; payroll: number; net: number; margin: number };
  paymentsDetail?: {
    id: string;
    paidDate: string;
    dueDate: string;
    rentalId: string;
    driver: string;
    vehicle: string;
    plate: string;
    method: string;
    status: string;
    amount: number;
  }[];
  expensesDetail?: {
    id: string;
    date: string;
    category: string;
    vendor: string;
    vehicle: string;
    plate: string;
    notes: string;
    receiptUrl: string;
    amount: number;
  }[];
  vehicleDetail?: {
    vehicleId: string;
    vehicle: string;
    plate: string;
    vin: string;
    revenue: number;
    expenses: number;
    net: number;
    roiPct: number | null;
  }[];
}

const BRAND = "0F172A"; // dark slate
const ACCENT = "2563EB"; // primary blue
const SOFT = "F1F5F9";

async function fetchLogoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(logoUrl);
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function downloadPnLExcel(data: PnLExportData, filename = "pnl-summary.xlsx") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Camauto Rentals";
  wb.created = new Date();

  const logoBuf = await fetchLogoBuffer();
  let logoId: number | null = null;
  if (logoBuf) {
    logoId = wb.addImage({ buffer: logoBuf as any, extension: "jpeg" });
  }

  // ===== Summary sheet =====
  const ws = wb.addWorksheet("P&L Summary", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { width: 4 },
    { width: 38 },
    { width: 18 },
    { width: 14 },
    { width: 4 },
  ];

  if (logoId !== null) {
    ws.addImage(logoId, { tl: { col: 1, row: 0 }, ext: { width: 160, height: 100 }, editAs: "oneCell" });
  }
  ws.getRow(1).height = 24;
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 24;
  ws.getRow(4).height = 24;

  ws.mergeCells("C2:D2");
  const title = ws.getCell("C2");
  title.value = "Camauto Rentals";
  title.font = { name: "Calibri", size: 20, bold: true, color: { argb: "FF" + BRAND } };
  title.alignment = { vertical: "middle", horizontal: "right" };

  ws.mergeCells("C3:D3");
  const sub = ws.getCell("C3");
  sub.value = "Profit & Loss Statement";
  sub.font = { name: "Calibri", size: 12, color: { argb: "FF64748B" } };
  sub.alignment = { vertical: "middle", horizontal: "right" };

  ws.mergeCells("C4:D4");
  const period = ws.getCell("C4");
  period.value = data.periodLabel;
  period.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };
  period.alignment = { vertical: "middle", horizontal: "right" };

  // Divider
  for (const col of ["B", "C", "D"]) {
    ws.getCell(`${col}6`).border = { bottom: { style: "medium", color: { argb: "FF" + ACCENT } } };
  }

  let row = 8;

  const writeSection = (heading: string, items: { label: string; amount: number }[], totalLabel: string, totalValue: number) => {
    ws.mergeCells(`B${row}:D${row}`);
    const h = ws.getCell(`B${row}`);
    h.value = heading;
    h.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    h.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } };
    ws.getRow(row).height = 22;
    row++;

    items.forEach((it, i) => {
      const labelCell = ws.getCell(`B${row}`);
      labelCell.value = it.label;
      labelCell.font = { name: "Calibri", size: 11 };
      labelCell.alignment = { indent: 1 };
      ws.mergeCells(`B${row}:C${row}`);

      const amt = ws.getCell(`D${row}`);
      amt.value = it.amount;
      amt.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
      amt.font = { name: "Calibri", size: 11 };
      amt.alignment = { horizontal: "right" };

      if (i % 2 === 0) {
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + SOFT } };
        amt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + SOFT } };
      }
      row++;
    });

    const tLabel = ws.getCell(`B${row}`);
    tLabel.value = totalLabel;
    tLabel.font = { name: "Calibri", size: 11, bold: true };
    tLabel.alignment = { indent: 1 };
    ws.mergeCells(`B${row}:C${row}`);
    const tVal = ws.getCell(`D${row}`);
    tVal.value = totalValue;
    tVal.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
    tVal.font = { name: "Calibri", size: 11, bold: true };
    tVal.alignment = { horizontal: "right" };
    [tLabel, tVal].forEach(c => {
      c.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
    });
    row += 2;
  };

  writeSection("Revenue", data.revenue, "Total revenue", data.totals.revenue);
  writeSection("Expenses", data.expenses, "Total expenses", data.totals.expenses);

  // Net profit highlight
  ws.mergeCells(`B${row}:C${row}`);
  const netLabel = ws.getCell(`B${row}`);
  netLabel.value = "NET PROFIT";
  netLabel.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  netLabel.alignment = { vertical: "middle", indent: 1 };
  netLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ACCENT } };

  const netVal = ws.getCell(`D${row}`);
  netVal.value = data.totals.net;
  netVal.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
  netVal.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  netVal.alignment = { horizontal: "right", vertical: "middle" };
  netVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ACCENT } };
  ws.getRow(row).height = 26;
  row++;

  ws.mergeCells(`B${row}:C${row}`);
  const mLabel = ws.getCell(`B${row}`);
  mLabel.value = "Margin";
  mLabel.font = { name: "Calibri", size: 10, color: { argb: "FF64748B" } };
  mLabel.alignment = { indent: 1 };
  const mVal = ws.getCell(`D${row}`);
  mVal.value = data.totals.margin / 100;
  mVal.numFmt = "0.0%";
  mVal.font = { name: "Calibri", size: 10, color: { argb: "FF64748B" } };
  mVal.alignment = { horizontal: "right" };
  row += 2;

  // Footer note
  ws.mergeCells(`B${row}:D${row}`);
  const note = ws.getCell(`B${row}`);
  note.value = `Generated ${new Date().toLocaleString()} · Camauto Rentals confidential`;
  note.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF94A3B8" } };
  note.alignment = { horizontal: "center" };

  // ===== Payroll sheet =====
  if (data.payroll.length) {
    const ps = wb.addWorksheet("Payroll detail", { views: [{ showGridLines: false }] });
    ps.columns = [
      { header: "Run", key: "runId", width: 12 },
      { header: "Period", key: "period", width: 26 },
      { header: "Staff", key: "staff", width: 24 },
      { header: "Role", key: "role", width: 18 },
      { header: "Gross", key: "gross", width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Net", key: "net", width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Status", key: "status", width: 12 },
    ];
    const hdr = ps.getRow(1);
    hdr.eachCell(c => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } };
      c.alignment = { vertical: "middle" };
    });
    hdr.height = 20;
    data.payroll.forEach((p, i) => {
      const r = ps.addRow(p);
      if (i % 2 === 0) {
        r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + SOFT } }; });
      }
    });
    ps.views = [{ state: "frozen", ySplit: 1 }];
  }

  // ===== Payments detail (every paid invoice) =====
  if (data.paymentsDetail?.length) {
    const s = wb.addWorksheet("Payments detail", { views: [{ state: "frozen", ySplit: 1 }] });
    s.columns = [
      { header: "Payment ID", key: "id", width: 16 },
      { header: "Paid date", key: "paidDate", width: 14 },
      { header: "Due date", key: "dueDate", width: 14 },
      { header: "Rental ID", key: "rentalId", width: 14 },
      { header: "Driver", key: "driver", width: 22 },
      { header: "Vehicle", key: "vehicle", width: 26 },
      { header: "Plate", key: "plate", width: 12 },
      { header: "Method", key: "method", width: 12 },
      { header: "Status", key: "status", width: 10 },
      { header: "Amount", key: "amount", width: 14, style: { numFmt: '"$"#,##0.00' } },
    ];
    styleHeader(s.getRow(1));
    data.paymentsDetail.forEach((p, i) => {
      const r = s.addRow(p);
      if (i % 2 === 0) zebra(r);
    });
    const totalRow = s.addRow({ driver: "TOTAL", amount: data.paymentsDetail.reduce((a, b) => a + b.amount, 0) });
    totalRow.font = { bold: true };
    totalRow.getCell("amount").numFmt = '"$"#,##0.00';
  }

  // ===== Expenses detail (every logged expense) =====
  if (data.expensesDetail?.length) {
    const s = wb.addWorksheet("Expenses detail", { views: [{ state: "frozen", ySplit: 1 }] });
    s.columns = [
      { header: "Expense ID", key: "id", width: 18 },
      { header: "Date", key: "date", width: 14 },
      { header: "Category", key: "category", width: 16 },
      { header: "Vendor", key: "vendor", width: 22 },
      { header: "Vehicle", key: "vehicle", width: 26 },
      { header: "Plate", key: "plate", width: 12 },
      { header: "Notes", key: "notes", width: 36 },
      { header: "Receipt", key: "receiptUrl", width: 30 },
      { header: "Amount", key: "amount", width: 14, style: { numFmt: '"$"#,##0.00' } },
    ];
    styleHeader(s.getRow(1));
    data.expensesDetail.forEach((e, i) => {
      const r = s.addRow(e);
      if (i % 2 === 0) zebra(r);
      if (e.receiptUrl) {
        const cell = r.getCell("receiptUrl");
        cell.value = { text: "View receipt", hyperlink: e.receiptUrl };
        cell.font = { color: { argb: "FF" + ACCENT }, underline: true };
      }
    });
    const totalRow = s.addRow({ vendor: "TOTAL", amount: data.expensesDetail.reduce((a, b) => a + b.amount, 0) });
    totalRow.font = { bold: true };
    totalRow.getCell("amount").numFmt = '"$"#,##0.00';
  }

  // ===== Per-vehicle P&L =====
  if (data.vehicleDetail?.length) {
    const s = wb.addWorksheet("Per-vehicle P&L", { views: [{ state: "frozen", ySplit: 1 }] });
    s.columns = [
      { header: "Vehicle ID", key: "vehicleId", width: 12 },
      { header: "Vehicle", key: "vehicle", width: 28 },
      { header: "Plate", key: "plate", width: 12 },
      { header: "VIN", key: "vin", width: 22 },
      { header: "Revenue", key: "revenue", width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Expenses", key: "expenses", width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Net", key: "net", width: 14, style: { numFmt: '"$"#,##0.00;[Red]("$"#,##0.00)' } },
      { header: "ROI %", key: "roiPct", width: 10, style: { numFmt: '0.0"%";[Red]-0.0"%";"—"' } },
    ];
    styleHeader(s.getRow(1));
    data.vehicleDetail.forEach((v, i) => {
      const r = s.addRow({ ...v, roiPct: v.roiPct ?? "" });
      if (i % 2 === 0) zebra(r);
    });
    const tot = data.vehicleDetail.reduce(
      (a, v) => ({ revenue: a.revenue + v.revenue, expenses: a.expenses + v.expenses, net: a.net + v.net }),
      { revenue: 0, expenses: 0, net: 0 }
    );
    const totalRow = s.addRow({ vehicle: "TOTAL", ...tot });
    totalRow.font = { bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } };
    c.alignment = { vertical: "middle" };
  });
  row.height = 20;
}
function zebra(row: ExcelJS.Row) {
  row.eachCell(c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + SOFT } };
  });
}