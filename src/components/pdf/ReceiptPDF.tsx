import type { AgreementSettings } from "@/lib/agreementSettings";
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

/**
 * Server-rendered Payment Receipt PDF using jsPDF (no WASM, no DOM).
 * Works in the Cloudflare Workers SSR runtime.
 */

export interface ReceiptPDFData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    billingCadence: string | null;
    rate: number | null;
    weeklyRate: number | null;
    rateAmount: number | null;
  };
  driver: {
    fullName: string;
    phone: string;
    email: string;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    plate: string;
    vin: string;
  };
  payment: {
    amount: number;
    method: string;
    paidAt: string;
    reference: string | null;
    totalCost: number;
    balanceDue: number;
  };
  lineItems?: { label: string; amount: number }[];
  durationLabel?: string;
  settings: AgreementSettings;
}

const COLOR_GREEN = "#2db84b";
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];
const RGB_GREEN: [number, number, number] = [45, 184, 75];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtMoney(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

/**
 * Render the receipt to a PDF Uint8Array using jsPDF (no WASM).
 * Units are points; page is US Letter (612 x 792 pt).
 */
export async function renderReceiptPdf(data: ReceiptPDFData): Promise<Uint8Array> {
  // Lazy-load jsPDF so it isn't pulled into the SSR/Worker bundle at module init.
  const { jsPDF } = await import("jspdf");
  const { rental, driver, vehicle, payment, settings } = data;
  const lineItems = data.lineItems ?? [];
  const durationLabel = data.durationLabel ?? "";
  const c = settings.company;
  const rateLabel = (() => {
    const cadence = (rental.billingCadence || "weekly").toLowerCase();
    const amt = rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0;
    return `${fmtMoney(Number(amt))} / ${cadence === "daily" ? "day" : cadence === "monthly" ? "month" : "week"}`;
  })();

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 40;

  // ---- Logo (centered, longer/wider look) ----
  const logoW = 140;
  const logoH = 90;
  doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", (pageW - logoW) / 2, y, logoW, logoH);
  y += logoH + 6;

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...RGB_GREEN);
  doc.text(c.dba, left, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(c.legalName, left, y + 26);

  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  [c.address, c.phone, c.website].forEach((line, i) => {
    doc.text(line, right, y + 10 + i * 10, { align: "right" });
  });

  y += 38;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);

  // ---- Title ----
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("PAYMENT RECEIPT", pageW / 2, y, { align: "center" });

  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Reservation #${rental.id}  •  Issued ${fmtDateTime(payment.paidAt)}`, pageW / 2, y, {
    align: "center",
  });

  y += 18;

  const sectionBar = (label: string) => {
    y += 6;
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, right - left, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 6, y + 11);
    y += 22;
  };

  const field = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    const v = value || "—";
    const wrapped = doc.splitTextToSize(v, right - left - 140);
    doc.text(wrapped, left + 140, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  };

  sectionBar("Customer");
  field("Name", driver.fullName);
  field("Phone", driver.phone);
  field("Email", driver.email);

  sectionBar("Vehicle");
  field("Vehicle", `${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  field("Plate", vehicle.plate);
  field("VIN", vehicle.vin);

  sectionBar("Rental Period");
  field("Start", fmtDate(rental.startDate));
  field("End", rental.endDate ? fmtDate(rental.endDate) : "Open-ended");
  if (durationLabel) field("Duration", durationLabel);
  field("Rate", rateLabel);

  sectionBar("Payment");
  field("Method", payment.method);
  field("Reference", payment.reference ?? "");
  field("Date", fmtDateTime(payment.paidAt));

  // ---- Totals box ----
  y += 8;
  const itemRows = lineItems.length;
  const boxTop = y;
  const rowH = 14;
  const boxH = (itemRows + 3) * rowH + 12;
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(1);
  doc.rect(left, boxTop, right - left, boxH);

  let rowIdx = 0;
  const rowY = (i: number) => boxTop + 14 + i * rowH;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  for (const li of lineItems) {
    doc.text(li.label, left + 10, rowY(rowIdx));
    doc.text(fmtMoney(li.amount), right - 10, rowY(rowIdx), { align: "right" });
    rowIdx += 1;
  }

  doc.setFont("helvetica", "bold");
  doc.text("Total Charge", left + 10, rowY(rowIdx));
  doc.text(fmtMoney(payment.totalCost), right - 10, rowY(rowIdx), { align: "right" });
  rowIdx += 1;

  doc.setFont("helvetica", "normal");
  doc.text("Amount Paid", left + 10, rowY(rowIdx));
  doc.setFont("helvetica", "bold");
  doc.text(fmtMoney(payment.amount), right - 10, rowY(rowIdx), { align: "right" });
  rowIdx += 1;

  doc.setDrawColor(...COLOR_BORDER);
  doc.line(left + 6, rowY(rowIdx) - 4, right - 6, rowY(rowIdx) - 4);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("Balance Due", left + 10, rowY(rowIdx) + 4);
  doc.setFontSize(12);
  doc.setTextColor(...RGB_GREEN);
  doc.text(fmtMoney(payment.balanceDue), right - 10, rowY(rowIdx) + 4, { align: "right" });

  y = boxTop + boxH + 18;

  // ---- PAID stamp ----
  if (payment.balanceDue <= 0) {
    const stampW = 110;
    const stampH = 30;
    const stampX = (pageW - stampW) / 2;
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(2);
    doc.rect(stampX, y, stampW, stampH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...RGB_GREEN);
    doc.text("PAID", pageW / 2, y + 21, { align: "center" });
  }

  // ---- Footer ----
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(1);
  doc.line(left, pageH - 30, right, pageH - 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    `${c.dba} — Receipt for Reservation #${rental.id}`,
    pageW / 2,
    pageH - 18,
    { align: "center" },
  );

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}