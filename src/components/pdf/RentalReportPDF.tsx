/**
 * Server-rendered comprehensive Rental Report PDF using jsPDF.
 * Works in the Cloudflare Workers SSR runtime (no DOM, no WASM).
 */
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export interface RentalReportData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    returnedAt: string | null;
    reservationStatus: string | null;
    paymentStatus: string | null;
    billingCadence: string | null;
    rate: number | null;
    weeklyRate: number | null;
    rateAmount: number | null;
    depositPaid: number | null;
    finalChargeAmount: number | null;
    mileageOut: number | null;
    mileageIn: number | null;
    cardholderName: string | null;
  };
  driver: {
    fullName: string;
    phone: string;
    email: string;
    licenseNumber: string;
    dlState: string;
    address: string;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    plate: string;
    vin: string;
    color: string;
  };
  payments: Array<{
    id: string;
    amount: number;
    dueDate: string;
    paidDate: string | null;
    method: string | null;
    status: string;
  }>;
  charges: Array<{
    amount: number;
    chargeDate: string;
    status: string;
    periodLabel: string | null;
  }>;
  violations: Array<{
    id: string;
    type: string;
    amount: number;
    dateIssued: string;
    status: string;
    notes: string | null;
  }>;
  extensions: Array<{
    id: string;
    periods: number;
    periodLabel: string;
    additionalAmount: number;
    previousEndDate: string | null;
    newEndDate: string;
    extendedAt: string;
  }>;
  inspections: Array<{
    id: string;
    date: string;
    type: string;
    mileage: number;
    fuelLevel: string;
    damageNoted: boolean;
    readyToRent: boolean | null;
    isReturn: boolean;
    notes: string | null;
    inspector: string | null;
  }>;
  cardLast4: string | null;
  images: {
    license: { mime: string; bytes: Uint8Array } | null;
    selfie: { mime: string; bytes: Uint8Array } | null;
    signature: { mime: string; bytes: Uint8Array } | null;
  };
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${(Math.round(v * 100) / 100).toFixed(2)}`;
}

function daysBetween(start: string, end: string | null): number {
  if (!start) return 0;
  const s = new Date(start.length === 10 ? `${start}T00:00:00` : start);
  const e = new Date(
    end ? (end.length === 10 ? `${end}T00:00:00` : end) : new Date().toISOString(),
  );
  return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
}

export async function renderRentalReportPdf(data: RentalReportData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { rental, driver, vehicle, payments, charges, violations, extensions, inspections, images, cardLast4 } = data;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 40;

  function ensure(space: number) {
    if (y + space > pageH - 50) {
      doc.addPage();
      y = 40;
    }
  }

  function sectionBar(label: string) {
    ensure(28);
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, right - left, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 6, y + 11);
    y += 22;
  }

  function field(label: string, value: string) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    const wrapped = doc.splitTextToSize(value || "—", right - left - 140);
    doc.text(wrapped, left + 140, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  }

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...RGB_GREEN);
  doc.text("RENTAL REPORT", left, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Reservation #${rental.id}`, left, y + 28);
  doc.text(
    `Generated ${new Date().toLocaleString("en-US")}`,
    right,
    y + 14,
    { align: "right" },
  );
  doc.text(
    `Status: ${(rental.reservationStatus || "—").toUpperCase()}`,
    right,
    y + 28,
    { align: "right" },
  );
  y += 40;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);
  y += 10;

  // ---- Renter ----
  sectionBar("Renter");
  field("Name", driver.fullName);
  field("Phone", driver.phone);
  field("Email", driver.email);
  field("License #", `${driver.licenseNumber}${driver.dlState ? ` (${driver.dlState})` : ""}`);
  if (driver.address) field("Address", driver.address);

  // ---- Vehicle ----
  sectionBar("Vehicle");
  field("Vehicle", `${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  field("Plate", vehicle.plate);
  field("VIN", vehicle.vin);
  if (vehicle.color) field("Color", vehicle.color);

  // ---- Rental period ----
  const days = daysBetween(rental.startDate, rental.returnedAt ?? rental.endDate);
  const rateAmt = Number(rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0);
  const cadence = (rental.billingCadence || "weekly").toLowerCase();
  sectionBar("Rental Period");
  field("Pickup", fmtDate(rental.startDate));
  field("Scheduled End", fmtDate(rental.endDate));
  field("Returned", rental.returnedAt ? fmtDate(rental.returnedAt) : "—");
  field("Duration", `${days} day${days === 1 ? "" : "s"}`);
  field(
    "Rate",
    `${fmtMoney(rateAmt)} / ${cadence === "daily" ? "day" : cadence === "monthly" ? "month" : "week"}`,
  );
  if (rental.cardholderName || cardLast4) {
    field(
      "Payment Method",
      `${rental.cardholderName ?? "Card on file"}${cardLast4 ? ` •••• ${cardLast4}` : ""}`,
    );
  }

  // ---- Extensions / Billing periods ----
  if (extensions.length > 0) {
    sectionBar("Extensions");
    for (const ext of extensions) {
      ensure(16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_TEXT);
      const line = `${fmtDate(ext.extendedAt)} — +${ext.periods} ${ext.periodLabel} (${fmtDate(ext.previousEndDate)} → ${fmtDate(ext.newEndDate)})`;
      doc.text(line, left, y);
      doc.text(fmtMoney(ext.additionalAmount), right, y, { align: "right" });
      y += 14;
    }
  }

  // ---- Inspections ----
  if (inspections.length > 0) {
    sectionBar("Inspections");
    for (const ins of inspections) {
      ensure(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_TEXT);
      doc.text(
        `${ins.isReturn ? "RETURN" : ins.type.toUpperCase()} — ${fmtDate(ins.date)}`,
        left,
        y,
      );
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(
        `Mileage: ${ins.mileage}    Fuel: ${ins.fuelLevel || "—"}    Damage: ${ins.damageNoted ? "YES" : "no"}    Ready: ${ins.readyToRent ? "yes" : "NO"}    Inspector: ${ins.inspector || "—"}`,
        left,
        y,
      );
      y += 12;
      if (ins.notes) {
        const wrapped = doc.splitTextToSize(`Notes: ${ins.notes}`, right - left);
        doc.setTextColor(...COLOR_TEXT);
        doc.text(wrapped, left, y);
        y += 11 * wrapped.length;
      }
      y += 6;
    }
  }

  // ---- Violations ----
  let violationsTotal = 0;
  if (violations.length > 0) {
    sectionBar("Violations & Incidentals");
    for (const v of violations) {
      ensure(14);
      violationsTotal += Number(v.amount);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_TEXT);
      const lbl = `${fmtDate(v.dateIssued)} — ${v.type}${v.notes ? ` (${v.notes})` : ""}`;
      const wrapped = doc.splitTextToSize(lbl, right - left - 80);
      doc.text(wrapped, left, y);
      doc.text(fmtMoney(v.amount), right, y, { align: "right" });
      y += 12 * wrapped.length;
    }
  }

  // ---- Payments ----
  let paidTotal = 0;
  if (payments.length > 0 || charges.length > 0) {
    sectionBar("Payments");
    for (const p of payments) {
      ensure(14);
      const isPaid = p.status === "paid" || !!p.paidDate;
      if (isPaid) paidTotal += Number(p.amount);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_TEXT);
      const lbl = `${fmtDate(p.paidDate ?? p.dueDate)} — ${p.method ?? "—"} (${p.status})`;
      doc.text(lbl, left, y);
      doc.text(fmtMoney(p.amount), right, y, { align: "right" });
      y += 12;
    }
    for (const c of charges) {
      ensure(14);
      if (c.status === "succeeded") paidTotal += Number(c.amount);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_TEXT);
      const lbl = `${fmtDate(c.chargeDate)} — Stripe ${c.periodLabel ?? ""} (${c.status})`;
      doc.text(lbl, left, y);
      doc.text(fmtMoney(c.amount), right, y, { align: "right" });
      y += 12;
    }
  }

  // ---- Totals ----
  ensure(80);
  y += 6;
  const baseRental = rateAmt; // first-period charge baseline
  const totalCharged = baseRental + violationsTotal +
    extensions.reduce((s, e) => s + Number(e.additionalAmount), 0);
  const balanceDue = Math.max(0, totalCharged - paidTotal);
  const boxTop = y;
  const boxH = 80;
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(1);
  doc.rect(left, boxTop, right - left, boxH);

  const rowY = (i: number) => boxTop + 14 + i * 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXT);
  doc.text("Base Rental", left + 10, rowY(0));
  doc.text(fmtMoney(baseRental), right - 10, rowY(0), { align: "right" });
  doc.text("Extensions", left + 10, rowY(1));
  doc.text(
    fmtMoney(extensions.reduce((s, e) => s + Number(e.additionalAmount), 0)),
    right - 10,
    rowY(1),
    { align: "right" },
  );
  doc.text("Violations / Incidentals", left + 10, rowY(2));
  doc.text(fmtMoney(violationsTotal), right - 10, rowY(2), { align: "right" });
  doc.text("Total Paid", left + 10, rowY(3));
  doc.text(fmtMoney(paidTotal), right - 10, rowY(3), { align: "right" });
  doc.setDrawColor(...COLOR_BORDER);
  doc.line(left + 6, rowY(4) - 4, right - 6, rowY(4) - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Balance Due", left + 10, rowY(4) + 4);
  doc.setTextColor(...RGB_GREEN);
  doc.setFontSize(12);
  doc.text(fmtMoney(balanceDue), right - 10, rowY(4) + 4, { align: "right" });
  y = boxTop + boxH + 18;

  // ---- Images ----
  function addImagePage(title: string, img: { mime: string; bytes: Uint8Array } | null) {
    if (!img) return;
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...RGB_GREEN);
    doc.text(title, left, 50);
    try {
      const fmt = img.mime.includes("png") ? "PNG" : "JPEG";
      // jsPDF accepts Uint8Array via TypedArray; cast as any for older types.
      const maxW = right - left;
      const maxH = pageH - 100;
      doc.addImage(img.bytes as unknown as string, fmt, left, 70, maxW, maxH, undefined, "FAST");
    } catch (e) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(`Could not embed ${title}: ${e instanceof Error ? e.message : String(e)}`, left, 80);
    }
  }
  addImagePage("Driver's License", images.license);
  addImagePage("Selfie", images.selfie);
  addImagePage("Signature", images.signature);

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 30, right, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Camauto Rentals — Report for #${rental.id}`, left, pageH - 18);
    doc.text(`Page ${i} of ${pages}`, right, pageH - 18, { align: "right" });
  }

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}