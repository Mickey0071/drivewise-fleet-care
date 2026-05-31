import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";
import type { AgreementSettings } from "@/lib/agreementSettings";

export interface WorkOrderPdfData {
  workOrderNumber: string;
  vehicle: { year: number | string; make: string; model: string; plate: string; vin: string };
  scheduledDate: string;
  priority: string;
  status: string;
  serviceType: string;
  description: string;
  estimatedCost: number;
  assignedTo: string;
  // completion
  completedDate: string;
  actualCost: string;
  partsUsed: string;
  completionNotes: string;
  mechanicSignature: string | null;
  mechanicSignedAt: string;
  reviewedBy: string;
  adminSignature: string | null;
  adminSignedAt: string;
  generatedAt: string;
  settings: AgreementSettings;
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export async function renderWorkOrderPdf(data: WorkOrderPdfData): Promise<Blob> {
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
    if (y + need > pageH - 50) { doc.addPage(); y = 50; }
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
  doc.text("MAINTENANCE WORK ORDER", pageW / 2, y, { align: "center" });
  y += 18;

  // ---- Header block ----
  const v = data.vehicle;
  doc.setFontSize(10);
  const headerLines: [string, string][] = [
    ["Work Order #", data.workOrderNumber],
    ["Vehicle", `${v.year} ${v.make} ${v.model}`],
    ["Tag / Plate", v.plate || "—"],
    ["VIN", v.vin || "—"],
    ["Scheduled Date", data.scheduledDate],
    ["Priority", data.priority],
    ["Status", data.status],
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

  const field = (label: string, value: string, multiline = false) => {
    ensure(multiline ? 40 : 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    if (multiline) {
      const wrapped = doc.splitTextToSize(value || "—", contentW);
      doc.text(wrapped, left, y + 18);
      y += 18 + (Array.isArray(wrapped) ? wrapped.length : 1) * 12 + 4;
    } else {
      doc.text(value || "—", left + 120, y + 4);
      y += 16;
    }
  };

  // ---- Work details ----
  sectionBar("Work Details");
  field("Service Type", data.serviceType);
  field("Assigned To", data.assignedTo);
  field("Estimated Cost", money(data.estimatedCost));
  field("Description", data.description, true);
  y += 6;

  // ---- Mechanic checklist ----
  sectionBar("Mechanic Completion");
  const box = (checked: boolean) => (checked ? "[X]" : "[  ]");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  field(`${box(!!data.completedDate)} Work completed on`, data.completedDate || "________________");
  field(`${box(!!data.actualCost)} Actual cost`, data.actualCost || "________________");
  field(`${box(!!data.partsUsed)} Parts used`, data.partsUsed || "________________", true);
  field(`${box(!!data.completionNotes)} Notes`, data.completionNotes || "________________", true);
  y += 6;

  // ---- Signatures ----
  ensure(120);
  sectionBar("Signatures");
  const drawSig = (label: string, sig: string | null, who: string, when: string) => {
    ensure(100);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y + 4);
    y += 12;
    if (sig) {
      try { doc.addImage(sig, "PNG", left, y, 180, 60); } catch { /* ignore */ }
    }
    doc.setDrawColor(...COLOR_BORDER);
    doc.line(left, y + 64, left + 180, y + 64);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(who || "—", left, y + 76);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(when ? `Date: ${when}` : "Date: ________", left + 220, y + 76);
    y += 90;
  };
  drawSig("Mechanic Signature", data.mechanicSignature, data.assignedTo, data.mechanicSignedAt);
  drawSig("Admin Sign-Off", data.adminSignature, data.reviewedBy, data.adminSignedAt);

  // ---- Footer ----
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 30, right, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`${c.dba} — Work Order ${data.workOrderNumber} (${v.year} ${v.make} ${v.model})`, left, pageH - 18);
    doc.text(`Page ${p} of ${pageCount}`, right, pageH - 18, { align: "right" });
  }

  return doc.output("blob");
}