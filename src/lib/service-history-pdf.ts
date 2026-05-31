import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";
import type { AgreementSettings } from "@/lib/agreementSettings";

export interface ServiceLogRow {
  date: string;
  type: string;
  cost: number;
  nextDue: string;
}
export interface RepairRow {
  date: string;
  type: string;
  vendor: string;
  parts: string;
  labor: string;
  total: number;
  status: string;
}
export interface OpenIssueRow {
  dateStarted: string;
  issue: string;
  vendor: string;
  estTotal: string;
  balance: string;
  estReturn: string;
}
export interface ServiceHistoryData {
  vehicle: { year: number | string; make: string; model: string; plate: string; vin: string };
  generatedAt: string;
  serviceLog: ServiceLogRow[];
  repairs: RepairRow[];
  openIssues: OpenIssueRow[];
  summary: {
    totalMaintenance: number;
    totalRepair: number;
    openBalance: number;
    lastService: string;
    nextDue: string;
  };
  notes: string;
  signedBy: string;
  dateSigned: string;
  signatureDataUrl: string | null;
  settings: AgreementSettings;
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export async function renderServiceHistoryPdf(data: ServiceHistoryData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const c = data.settings.company;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  const contentW = right - left;
  let y = 40;

  const ensure = (need: number) => {
    if (y + need > pageH - 50) {
      doc.addPage();
      y = 50;
    }
  };

  // ---- Logo + company header ----
  const logoW = 120;
  const logoH = 76;
  doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", (pageW - logoW) / 2, y, logoW, logoH);
  y += logoH + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...RGB_GREEN);
  doc.text(c.dba, left, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  [c.address, c.phone, c.website].forEach((line, i) => {
    doc.text(line, right, y + 4 + i * 10, { align: "right" });
  });
  y += 24;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);

  // ---- Title ----
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("VEHICLE SERVICE HISTORY REPORT", pageW / 2, y, { align: "center" });
  y += 18;

  // ---- Vehicle header block ----
  const v = data.vehicle;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  const headerLines: [string, string][] = [
    ["Vehicle", `${v.year} ${v.make} ${v.model}`],
    ["Tag / Plate", v.plate || "—"],
    ["VIN", v.vin || "—"],
    ["Report Generated", data.generatedAt],
  ];
  for (const [label, value] of headerLines) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_TEXT);
    doc.text(value, left + 120, y);
    y += 15;
  }
  y += 6;

  const sectionBar = (label: string) => {
    ensure(40);
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, contentW, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 6, y + 11);
    y += 20;
  };

  // Generic table renderer
  const table = (headers: string[], widths: number[], rows: string[][], empty: string) => {
    const rowH = 16;
    // header row
    ensure(rowH * 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    let x = left;
    headers.forEach((h, i) => {
      doc.text(h, x + 2, y + 10);
      x += widths[i];
    });
    y += rowH;
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.5);
    doc.line(left, y - 4, right, y - 4);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_TEXT);
    if (rows.length === 0) {
      doc.setTextColor(...COLOR_MUTED);
      doc.text(empty, left + 2, y + 8);
      y += rowH;
      return;
    }
    for (const row of rows) {
      ensure(rowH);
      x = left;
      row.forEach((cell, i) => {
        const wrapped = doc.splitTextToSize(cell || "—", widths[i] - 4);
        doc.text(Array.isArray(wrapped) ? wrapped[0] : wrapped, x + 2, y + 8);
        x += widths[i];
      });
      y += rowH;
      doc.setDrawColor(238, 238, 238);
      doc.line(left, y - 3, right, y - 3);
    }
  };

  // ---- Service log ----
  sectionBar("Service Log — Routine Maintenance");
  table(
    ["Date", "Service Type", "Cost", "Next Due"],
    [90, contentW - 90 - 90 - 110, 90, 110],
    data.serviceLog.map(r => [r.date, r.type, money(r.cost), r.nextDue]),
    "No routine service records.",
  );
  y += 8;

  // ---- Repair history ----
  sectionBar("Repair History — Completed Repairs");
  table(
    ["Date", "Repair Type", "Vendor", "Parts", "Labor", "Total", "Status"],
    [62, 110, 100, 50, 50, 55, contentW - 62 - 110 - 100 - 50 - 50 - 55],
    data.repairs.map(r => [r.date, r.type, r.vendor, r.parts, r.labor, money(r.total), r.status]),
    "No completed repairs.",
  );
  y += 8;

  // ---- Open issues ----
  sectionBar("Open Issues — Current Work");
  table(
    ["Started", "Issue", "Vendor", "Est. Total", "Balance", "Est. Return"],
    [70, 120, 100, 70, 70, contentW - 70 - 120 - 100 - 70 - 70],
    data.openIssues.map(r => [r.dateStarted, r.issue, r.vendor, r.estTotal, r.balance, r.estReturn]),
    "No open issues.",
  );
  y += 12;

  // ---- Summary box ----
  ensure(120);
  sectionBar("Summary");
  const sumRows: [string, string][] = [
    ["Total maintenance cost", money(data.summary.totalMaintenance)],
    ["Total repair cost", money(data.summary.totalRepair)],
    ["Open issues balance due", money(data.summary.openBalance)],
    ["Last service", data.summary.lastService],
    ["Next due", data.summary.nextDue],
  ];
  doc.setFontSize(10);
  for (const [label, value] of sumRows) {
    ensure(15);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left + 2, y + 4);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR_TEXT);
    doc.text(value, right - 2, y + 4, { align: "right" });
    y += 16;
  }
  y += 10;

  // ---- Notes & signature ----
  if (data.notes.trim() || data.signedBy.trim() || data.signatureDataUrl) {
    ensure(120);
    sectionBar("Inspection Notes & Certification");
    if (data.notes.trim()) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_TEXT);
      const wrapped = doc.splitTextToSize(data.notes.trim(), contentW);
      doc.text(wrapped, left, y + 4);
      y += (Array.isArray(wrapped) ? wrapped.length : 1) * 13 + 10;
    }
    ensure(90);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text("Signed By", left, y + 4);
    doc.text("Date Signed", left + 260, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(data.signedBy.trim() || "—", left, y + 20);
    doc.text(data.dateSigned || "—", left + 260, y + 20);
    y += 30;
    if (data.signatureDataUrl) {
      try {
        doc.addImage(data.signatureDataUrl, "PNG", left, y, 200, 70);
      } catch {
        /* ignore bad signature image */
      }
      doc.setDrawColor(...COLOR_BORDER);
      doc.line(left, y + 74, left + 200, y + 74);
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_MUTED);
      doc.text("Authorized Signature", left, y + 84);
      y += 92;
    }
  }

  // ---- Footer on every page ----
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 30, right, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(
      `${c.dba} — Service History for ${v.year} ${v.make} ${v.model} (${v.plate})`,
      left,
      pageH - 18,
    );
    doc.text(`Page ${p} of ${pageCount}`, right, pageH - 18, { align: "right" });
  }

  return doc.output("blob");
}