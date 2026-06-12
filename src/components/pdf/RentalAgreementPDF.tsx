import type { AgreementSettings } from "@/lib/agreementSettings";
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

/**
 * Server-rendered Vehicle Rental Agreement PDF using jsPDF (no WASM, no DOM).
 * Works in the Cloudflare Workers SSR runtime.
 */

export interface RentalAgreementPDFData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    billingCadence: string | null;
    billingPeriod: string | null;
    rateAmount: number | null;
    rate: number | null;
    weeklyRate: number | null;
    depositPaid: number;
    signedBy: string | null;
    signedAt: string | null;
    clientSignedAt: string | null;
    agreementVersion: string | null;
  };
  driver: {
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    middleInitial: string | null;
    dateOfBirth: string | null;
    licenseNumber: string;
    licenseExpiry: string | null;
    dlState: string | null;
    phone: string;
    email: string;
    streetAddress: string | null;
    aptUnit: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    address: string | null;
    altContactName: string | null;
    altContactPhone: string | null;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    color: string | null;
    plate: string;
    vin: string;
    mileage: number;
    fuelLevelPickup: string | null;
    ezPassTag: string | null;
  };
  extensions: Array<{
    id: string;
    extendedAt: string;
    previousEndDate: string | null;
    newEndDate: string;
    periods: number;
    periodLabel: string;
    additionalAmount: number;
    signedBy: string | null;
  }>;
  settings: AgreementSettings;
  /** PNG bytes of the renter's signature (Buffer or Uint8Array), or null. */
  signaturePng: Buffer | Uint8Array | null;
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const RGB_TEXT: [number, number, number] = [26, 26, 26];
const RGB_MUTED: [number, number, number] = [102, 102, 102];
const RGB_BORDER: [number, number, number] = [204, 204, 204];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function renderClauseText(body: string, s: AgreementSettings): string {
  return body
    .replaceAll("{{COMPANY}}", s.company.dba)
    .replaceAll("{{LEGAL_NAME}}", `${s.company.legalName} d/b/a ${s.company.dba}`)
    .replaceAll("{{GRACE_DAYS}}", s.fees.repossessionGraceDays)
    .replaceAll("{{EXCESS_MILEAGE}}", s.fees.excessMileageRate)
    .replaceAll("{{TOLL_ADMIN}}", s.fees.tollAdminFee)
    .replaceAll("{{FUEL_FEE}}", s.fees.fuelFeePerGallon)
    .replaceAll("{{CLEANING_FEE}}", s.fees.cleaningFeeRange);
}

function composedName(d: RentalAgreementPDFData["driver"]) {
  const parts = [d.firstName, d.middleInitial, d.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : d.fullName;
}

function composedAddress(d: RentalAgreementPDFData["driver"]) {
  if (d.streetAddress || d.city || d.state || d.zipCode) {
    const line1 = [d.streetAddress, d.aptUnit ? `Apt ${d.aptUnit}` : null].filter(Boolean).join(" ");
    const line2 = [d.city, [d.state, d.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [line1, line2].filter(Boolean).join(", ");
  }
  return d.address ?? "";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available in Workers runtime
  return typeof btoa !== "undefined"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
}

/**
 * Render the rental agreement to a PDF Uint8Array using jsPDF (no WASM).
 */
export async function renderRentalAgreementPdf(data: RentalAgreementPDFData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { rental, driver, vehicle, extensions, settings, signaturePng } = data;
  const c = settings.company;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 32;
  const right = pageW - 32;
  const contentW = right - left;
  const bottomLimit = pageH - 34;
  let y = 28;

  const periodLabel =
    rental.billingCadence === "daily" || rental.billingPeriod === "daily"
      ? "day"
      : rental.billingCadence === "weekly" || rental.billingPeriod === "weekly"
        ? "week"
        : "period";
  const rate = Number(rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0);
  const currentEnd = extensions.length
    ? extensions[extensions.length - 1].newEndDate
    : rental.endDate;
  const fullName = composedName(driver);
  const fullAddress = composedAddress(driver);
  const dlStateExp = [driver.dlState, driver.licenseExpiry ? fmtDate(driver.licenseExpiry) : ""]
    .filter(Boolean)
    .join(" / ");

  const drawFooter = () => {
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 30, right, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...RGB_MUTED);
    const footer = `${c.legalName} d/b/a ${c.dba}  |  ${c.address}  |  ${c.phone}  |  ${c.website}${
      rental.agreementVersion ? `   |   Agreement version: ${rental.agreementVersion}` : ""
    }`;
    doc.text(footer, pageW / 2, pageH - 18, { align: "center" });
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      drawFooter();
      doc.addPage();
      y = 40;
    }
  };

  // ---- HEADER (first page) ----
  const logoW = 78;
  const logoH = 50;
  doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", (pageW - logoW) / 2, y, logoW, logoH);
  y += logoH + 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...RGB_GREEN);
  doc.text(c.dba, left, y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_MUTED);
  doc.text(c.legalName, left, y + 19);
  [c.address, `Phone: ${c.phone}`, c.website].forEach((line, i) => {
    doc.text(line, right, y + 8 + i * 8, { align: "right" });
  });
  y += 26;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(1.5);
  doc.line(left, y, right, y);
  y += 13;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...RGB_TEXT);
  doc.text("VEHICLE RENTAL AGREEMENT", pageW / 2, y, { align: "center" });
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_MUTED);
  doc.text(
    "Please read this agreement carefully before signing. All terms are binding upon execution.",
    pageW / 2,
    y,
    { align: "center" },
  );
  y += 8;

  const sectionBar = (label: string) => {
    ensureSpace(22);
    y += 4;
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, contentW, 11, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 5, y + 8);
    y += 15;
  };

  const drawFieldsRow = (
    fields: Array<{ label: string; value: string; widthPct: number }>,
  ) => {
    ensureSpace(22);
    let x = left;
    fields.forEach((f) => {
      const w = (contentW * f.widthPct) / 100;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...RGB_MUTED);
      doc.text(f.label.toUpperCase(), x + 2, y + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...RGB_TEXT);
      const v = f.value || " ";
      const wrapped = doc.splitTextToSize(v, w - 4);
      doc.text(wrapped, x + 2, y + 15);
      // bottom underline
      doc.setDrawColor(68, 68, 68);
      doc.setLineWidth(0.4);
      doc.line(x + 2, y + 18, x + w - 2, y + 18);
      x += w;
    });
    y += 23;
  };

  // ---- RENTER ----
  sectionBar("Renter Information");
  drawFieldsRow([
    { label: "Full Legal Name", value: fullName, widthPct: 50 },
    { label: "Date of Birth", value: driver.dateOfBirth ? fmtDate(driver.dateOfBirth) : "", widthPct: 50 },
  ]);
  drawFieldsRow([
    { label: "Phone", value: driver.phone, widthPct: 50 },
    { label: "Email", value: driver.email, widthPct: 50 },
  ]);
  drawFieldsRow([
    { label: "Driver's License #", value: driver.licenseNumber || "", widthPct: 50 },
    { label: "License State / Exp", value: dlStateExp, widthPct: 50 },
  ]);
  drawFieldsRow([{ label: "Address", value: fullAddress, widthPct: 100 }]);
  if (driver.altContactName || driver.altContactPhone) {
    drawFieldsRow([
      { label: "Alt Contact Name", value: driver.altContactName ?? "", widthPct: 50 },
      { label: "Alt Contact Phone", value: driver.altContactPhone ?? "", widthPct: 50 },
    ]);
  }

  // ---- VEHICLE ----
  sectionBar("Vehicle Information");
  drawFieldsRow([
    { label: "Year", value: String(vehicle.year ?? ""), widthPct: 16.66 },
    { label: "Make", value: vehicle.make, widthPct: 16.66 },
    { label: "Model", value: vehicle.model, widthPct: 16.66 },
    { label: "Color", value: vehicle.color ?? "", widthPct: 16.66 },
    { label: "Plate", value: vehicle.plate, widthPct: 16.66 },
    { label: "VIN", value: vehicle.vin, widthPct: 16.7 },
  ]);
  drawFieldsRow([
    { label: "Fuel Level Out", value: vehicle.fuelLevelPickup ?? "", widthPct: 33 },
    { label: "EZ-Pass Tag #", value: vehicle.ezPassTag ?? "", widthPct: 33 },
    { label: "Pickup Date", value: fmtDate(rental.startDate), widthPct: 34 },
  ]);

  // ---- TERMS ----
  sectionBar("Rental Terms");
  drawFieldsRow([
    { label: `Rate ($/${periodLabel})`, value: fmtMoney(rate), widthPct: 25 },
    { label: "Daily Late Fee", value: settings.fees.dailyLateFee, widthPct: 37 },
    { label: "Rental Start", value: fmtDate(rental.startDate), widthPct: 38 },
  ]);
  drawFieldsRow([
    { label: "Security Deposit", value: fmtMoney(Number(rental.depositPaid ?? 0)), widthPct: 33 },
    { label: "Payment Method", value: "", widthPct: 33 },
    { label: "Current End Date", value: currentEnd ? fmtDate(currentEnd) : "Open-ended", widthPct: 34 },
  ]);

  // ---- EXTENSIONS ----
  if (extensions.length > 0) {
    sectionBar("Extensions & Amendments");
    const cols = ["Extended", "Prev End", "New End", "Periods", "Additional", "Signed By"];
    const colW = contentW / cols.length;
    ensureSpace(20);
    doc.setFillColor(...RGB_GREEN);
    doc.rect(left, y, contentW, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    cols.forEach((cName, i) => doc.text(cName, left + i * colW + 4, y + 10));
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...RGB_TEXT);
    extensions.forEach((e) => {
      ensureSpace(16);
      const row = [
        fmtDate(e.extendedAt.slice(0, 10)),
        e.previousEndDate ? fmtDate(e.previousEndDate) : "—",
        fmtDate(e.newEndDate),
        `${e.periods} ${e.periodLabel}${e.periods === 1 ? "" : "s"}`,
        fmtMoney(e.additionalAmount),
        e.signedBy ?? "—",
      ];
      row.forEach((cell, i) => doc.text(String(cell), left + i * colW + 4, y + 10));
      doc.setDrawColor(...RGB_BORDER);
      doc.setLineWidth(0.4);
      doc.line(left, y + 14, right, y + 14);
      y += 14;
    });
    y += 4;
  }

  // ---- TERMS & CONDITIONS ----
  sectionBar("Terms & Conditions");
  settings.clauses.forEach((clause, i) => {
    const titleLine = `${i + 1}. ${clause.title}`;
    const bodyText = renderClauseText(clause.body, settings);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...RGB_TEXT);
    const titleLines = doc.splitTextToSize(titleLine, contentW);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const bodyLines = doc.splitTextToSize(bodyText, contentW);
    const needed = titleLines.length * 8 + bodyLines.length * 8 + 3;
    ensureSpace(needed);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...RGB_TEXT);
    doc.text(titleLines, left, y + 7);
    y += titleLines.length * 8 + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(34, 34, 34);
    doc.text(bodyLines, left, y + 7);
    y += bodyLines.length * 8 + 3;
  });

  // ---- VIOLATIONS ----
  sectionBar("Violations & Incidentals");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_TEXT);
  ensureSpace(11);
  doc.text("Your card on file will be charged for any of the following:", left, y + 7);
  y += 11;
  const bullets = [
    "Parking tickets or traffic violations: actual fine amount",
    `Late return fees: ${settings.fees.dailyLateFee} per day`,
    "Damage to vehicle: repair cost",
    `Cleaning fees: ${settings.fees.cleaningFeeRange} if excessively soiled`,
    "Other violations or damages: actual cost",
  ];
  bullets.forEach((b) => {
    ensureSpace(9);
    doc.text(`• ${b}`, left + 10, y + 7);
    y += 9;
  });
  ensureSpace(12);
  doc.text(
    doc.splitTextToSize(
      `You authorize ${c.dba} to charge your card without further notice for any of these charges.`,
      contentW,
    ),
    left,
    y + 7,
  );
  y += 12;

  // ---- SERVICE COVERAGE AREA ----
  sectionBar("Service Coverage Area");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_TEXT);
  ensureSpace(12);
  doc.text(
    doc.splitTextToSize(
      `${c.dba} provides mechanical failure and vehicle replacement coverage within a 30-mile radius of our main location (416 Sicklerville Road, Sicklerville, NJ 08081).`,
      contentW,
    ),
    left,
    y + 7,
  );
  y += 14;

  ensureSpace(11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...RGB_TEXT);
  doc.text("WITHIN 30-MILE RADIUS:", left, y + 7);
  y += 11;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const withinBullets = [
    "In the event of mechanical failure, Camauto will provide roadside assistance and arrange a replacement vehicle at no charge to you",
    "You are not responsible for towing or repair costs",
  ];
  withinBullets.forEach((b) => {
    ensureSpace(9);
    doc.text(`• ${b}`, left + 10, y + 7);
    y += 9;
  });

  ensureSpace(11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...RGB_TEXT);
  doc.text("OUTSIDE 30-MILE RADIUS:", left, y + 7);
  y += 11;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const outsideBullets = [
    "If you experience mechanical failure beyond the 30-mile radius, you are responsible for arranging and paying for towing to the nearest service facility",
    "Contact Camauto immediately at 1-866-625-5550 for guidance on authorized repair shops",
    "You may be reimbursed for towing costs if the failure is determined to be a manufacturing defect (review required)",
  ];
  outsideBullets.forEach((b) => {
    ensureSpace(9);
    doc.text(`• ${b}`, left + 10, y + 7);
    y += 9;
  });
  ensureSpace(6);
  y += 3;

  // ---- SIGNATURE ----
  sectionBar("Signature");
  ensureSpace(16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_TEXT);
  doc.text(
    doc.splitTextToSize(
      "By signing below, Renter acknowledges having read, understood, and agreed to all terms of this Vehicle Rental Agreement.",
      contentW,
    ),
    left,
    y + 7,
  );
  y += 13;

  ensureSpace(80);
  const sigTop = y;
  const sigBoxH = 36;

  // Renter signature box
  if (signaturePng) {
    try {
      const bytes = signaturePng instanceof Uint8Array ? signaturePng : new Uint8Array(signaturePng);
      // Detect format from magic bytes — signatures are pre-converted to
      // JPEG by the server (jsPDF in Worker SSR can't decode RGBA PNGs
      // reliably), but fall back to PNG if conversion was skipped.
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const fmt = isJpeg ? "JPEG" : "PNG";
      const mime = isJpeg ? "image/jpeg" : "image/png";
      const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
      doc.addImage(dataUrl, fmt, left + 4, sigTop, contentW - 8, sigBoxH - 4);
    } catch (e) {
      console.warn("[agreement-pdf] signature image embed failed", e);
    }
  }
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.2);
  doc.line(left, sigTop + sigBoxH, left + contentW, sigTop + sigBoxH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...RGB_MUTED);
  doc.text("RENTER SIGNATURE", left, sigTop + sigBoxH + 10);

  y = sigTop + sigBoxH + 18;

  // Print name / date rows
  drawFieldsRow([
    { label: "Print Name", value: rental.signedBy ?? fullName, widthPct: 50 },
    {
      label: "Date",
      value: rental.signedAt
        ? fmtDate(rental.signedAt.slice(0, 10))
        : rental.clientSignedAt
          ? fmtDate(rental.clientSignedAt.slice(0, 10))
          : "",
      widthPct: 50,
    },
  ]);

  drawFooter();

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}
