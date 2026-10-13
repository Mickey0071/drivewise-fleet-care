import { BRAND_COMPANY, BRAND_RGB, logoBytes } from "@/lib/branding";

export const ACKNOWLEDGEMENTS = [
  {
    key: "valid_license",
    text: "I hold a valid, unexpired driver's license and my driving privileges are not suspended, revoked, or restricted.",
  },
  { key: "age_21", text: "I am at least 21 years of age." },
  {
    key: "bound_by_agreement",
    text: "I have read and agree to be bound by all terms of the Vehicle Rental Agreement for this rental, including the sections on Authorized Use, Insurance & Liability, Tolls & Citations, Fuel, Vehicle Return, Repossession, and GPS Tracking.",
  },
  {
    key: "personal_liability",
    text: "I accept personal liability for any traffic violations, tolls, citations, damage, or loss occurring while I am operating the vehicle, and I understand the primary renter remains jointly liable.",
  },
  {
    key: "violation_voids",
    text: "I understand that operating this vehicle in violation of the Rental Agreement voids all protections under it.",
  },
] as const;

export type AckKey = (typeof ACKNOWLEDGEMENTS)[number]["key"];

export interface AddendumInput {
  agreementNumber: string;
  agreementDate: string;
  vehicle: { label: string; vin: string; color: string };
  rentalPeriod: string;
  primaryRenter: string;
  driver: {
    fullName: string; dateOfBirth: string; phone: string; email: string; address: string;
    licenseNumber: string; licenseState: string; licenseExpiration: string;
  };
  acknowledgedAt: string;
  signatureBytes: Uint8Array;
  signatureIsPng: boolean;
  printedName: string;
  signedDate: string;
}

/** Branded "Additional Driver Addendum" PDF (pdf-lib, runs on the server). */
export async function buildAddendumPdf(input: AddendumInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(BRAND_RGB.green[0] / 255, BRAND_RGB.green[1] / 255, BRAND_RGB.green[2] / 255);
  const dark = rgb(BRAND_RGB.dark[0] / 255, BRAND_RGB.dark[1] / 255, BRAND_RGB.dark[2] / 255);
  const muted = rgb(0.43, 0.43, 0.43);
  const W = 612, H = 792, M = 50;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const logo = await doc.embedJpg(logoBytes());

  const header = () => {
    const lw = 120, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
    const tx = M + lw + 16;
    page.drawText(BRAND_COMPANY.legal, { x: tx, y: y - 14, size: 10, font: bold, color: dark });
    page.drawText(BRAND_COMPANY.address, { x: tx, y: y - 28, size: 9, font, color: muted });
    page.drawText(BRAND_COMPANY.contact, { x: tx, y: y - 41, size: 9, font, color: muted });
    y -= Math.max(lh, 48) + 10;
    page.drawRectangle({ x: M, y, width: W - 2 * M, height: 3, color: green });
    y -= 22;
  };
  const ensure = (need: number) => {
    if (y - need < M + 30) {
      page = doc.addPage([W, H]);
      y = H - M;
      header();
    }
  };
  const wrap = (text: string, size: number, f = font, width = W - 2 * M) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const para = (text: string, size = 10, f = font, indent = 0) => {
    for (const line of wrap(text, size, f, W - 2 * M - indent)) {
      ensure(size + 4);
      page.drawText(line, { x: M + indent, y, size, font: f, color: dark });
      y -= size + 4;
    }
  };
  const section = (title: string) => {
    ensure(30);
    y -= 6;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: green });
    page.drawText(title.toUpperCase(), { x: M + 6, y: y + 1, size: 10, font: bold, color: rgb(1, 1, 1) });
    y -= 24;
  };
  const field = (label: string, value: string) => {
    ensure(14);
    page.drawText(`${label}:`, { x: M, y, size: 9.5, font: bold, color: dark });
    page.drawText(value || "—", { x: M + 150, y, size: 9.5, font, color: dark });
    y -= 14;
  };

  header();
  page.drawText("ADDITIONAL DRIVER ADDENDUM", { x: M, y, size: 16, font: bold, color: dark });
  y -= 20;
  para(`This Addendum is made part of Vehicle Rental Agreement No. ${input.agreementNumber}${input.agreementDate ? ` dated ${input.agreementDate}` : ""}.`, 10);

  section("Original Agreement & Vehicle");
  field("Agreement number", input.agreementNumber);
  field("Agreement date", input.agreementDate);
  field("Primary renter", input.primaryRenter);
  field("Vehicle", input.vehicle.label);
  field("VIN", input.vehicle.vin);
  field("Color", input.vehicle.color);
  field("Rental period", input.rentalPeriod);

  section("Additional Driver");
  field("Full legal name", input.driver.fullName);
  field("Date of birth", input.driver.dateOfBirth);
  field("Phone", input.driver.phone);
  field("Email", input.driver.email);
  field("Address", input.driver.address);
  field("Driver license #", input.driver.licenseNumber);
  field("License state", input.driver.licenseState);
  field("License expiration", input.driver.licenseExpiration);

  section("Acknowledgements (each initialed electronically)");
  ACKNOWLEDGEMENTS.forEach((a, i) => {
    para(`[X] ${i + 1}. ${a.text}`, 9.5, font, 4);
    y -= 2;
  });
  para(`All acknowledgements confirmed electronically on ${new Date(input.acknowledgedAt).toUTCString()}.`, 8.5);

  section("Incorporation & Joint Liability");
  para(
    "This Addendum incorporates the original Vehicle Rental Agreement in full by reference. All terms, conditions, fees, and obligations of that Agreement apply to the Additional Driver as if the Additional Driver had signed it. The Primary Renter and the Additional Driver are jointly and severally liable for all obligations under the Agreement and this Addendum. The Additional Driver is not authorized to operate the vehicle until this Addendum is approved by Camauto Rentals.",
    10,
  );

  section("Signature");
  ensure(90);
  try {
    const sig = input.signatureIsPng ? await doc.embedPng(input.signatureBytes) : await doc.embedJpg(input.signatureBytes);
    const sw = 200, sh = Math.min(60, (sig.height / sig.width) * sw);
    page.drawImage(sig, { x: M, y: y - sh, width: sw, height: sh });
    y -= sh + 4;
  } catch {
    y -= 40;
  }
  page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 1, color: dark });
  y -= 12;
  page.drawText("Additional Driver Signature", { x: M, y, size: 8, font, color: muted });
  y -= 18;
  field("Printed name", input.printedName);
  field("Date", input.signedDate);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(BRAND_COMPANY.footer, { x: M, y: 24, size: 8, font, color: muted });
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8), y: 24, size: 8, font, color: muted });
  });
  return doc.save();
}
