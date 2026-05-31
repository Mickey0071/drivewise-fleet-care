import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";
import type { AgreementSettings } from "@/lib/agreementSettings";

export interface FieldFormData {
  workOrderNumber: string;
  vehicle: { year: number | string; make: string; model: string; plate: string; vin: string };
  serviceType: string;
  description: string;
  scheduledDate: string;
  assignedTo: string;
  estimatedCost: string;
  settings: AgreementSettings;
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [160, 160, 160];

/**
 * Renders a BLANK printable field form the mechanic takes to the job site and
 * fills out by hand (checkboxes, blank lines, photo spaces, signature line).
 */
export async function renderFieldFormPdf(data: FieldFormData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const c = data.settings.company;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  const contentW = right - left;
  let y = 36;

  // ---- Logo + header ----
  const logoW = 96;
  const logoH = 60;
  doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", (pageW - logoW) / 2, y, logoW, logoH);
  y += logoH + 6;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);

  // ---- Title ----
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("FIELD WORK ORDER — MECHANIC COPY", pageW / 2, y, { align: "center" });
  y += 16;

  // ---- Header block (pre-filled) ----
  const v = data.vehicle;
  doc.setFontSize(10);
  const rows: [string, string][] = [
    ["Work Order #", data.workOrderNumber],
    ["Vehicle", `${v.year} ${v.make} ${v.model}`],
    ["Tag / Plate", v.plate || "—"],
    ["Assigned To", data.assignedTo || "—"],
    ["Scheduled Date", data.scheduledDate],
    ["Service Type", data.serviceType],
    ["Estimated Cost", data.estimatedCost || "—"],
  ];
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_TEXT);
    doc.text(value, left + 110, y);
    y += 14;
  }
  if (data.description) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR_MUTED);
    doc.text("Work Requested", left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_TEXT);
    const wrapped = doc.splitTextToSize(data.description, contentW - 110);
    doc.text(wrapped, left + 110, y);
    y += (Array.isArray(wrapped) ? wrapped.length : 1) * 12;
  }
  y += 8;

  const sectionBar = (label: string) => {
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, contentW, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 6, y + 11);
    y += 24;
  };

  const blankLine = (label: string, indent = 0) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(label, left + indent, y);
    const lineStart = left + indent + doc.getTextWidth(label) + 8;
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.75);
    doc.line(lineStart, y + 2, right, y + 2);
    y += 22;
  };

  const writeLines = (n: number) => {
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.75);
    for (let i = 0; i < n; i++) {
      doc.line(left, y + 2, right, y + 2);
      y += 20;
    }
    y += 2;
  };

  // ---- Completion (filled by hand) ----
  sectionBar("Mechanic — Fill Out On Site");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("Work Completed:    [  ] Yes        [  ] No", left, y);
  y += 22;
  blankLine("Date / Time Completed:");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Labor Hours: ______________     Minutes: ______________", left, y);
  y += 22;
  blankLine("Actual Cost:  $");
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("PARTS USED", left, y); y += 8;
  writeLines(2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("ISSUES FOUND", left, y); y += 8;
  writeLines(2);

  // ---- Photos ----
  sectionBar("Photos");
  const boxW = (contentW - 16) / 2;
  const boxH = 70;
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(left, y, boxW, boxH);
  doc.rect(left + boxW + 16, y, boxW, boxH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("BEFORE PHOTOS", left + 4, y + 11);
  doc.text("AFTER PHOTOS", left + boxW + 20, y + 11);
  y += boxH + 16;

  // ---- Signature ----
  sectionBar("Sign-Off");
  y += 8;
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.75);
  doc.line(left, y, left + 240, y);
  doc.line(right - 160, y, right, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Mechanic Signature", left, y);
  doc.text("Date", right - 160, y);

  // ---- Footer ----
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(1);
  doc.line(left, pageH - 30, right, pageH - 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`${c.dba} — Field Work Order ${data.workOrderNumber}`, left, pageH - 18);
  doc.text("Return completed form to the office.", right, pageH - 18, { align: "right" });

  return doc.output("blob");
}