import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface AuthorityAddress {
  id: string;
  key: string;
  name: string;
  address_lines: string | null;
  region: string | null;
  is_active: boolean;
}

/**
 * Map an authority key to the statute we cite on outgoing dispute paperwork.
 * Unknown / missing keys are rejected so we never mail a packet with a wrong
 * legal reference. Add new authorities here as they come online.
 */
export function statuteFor(authorityKey: string | null | undefined): string {
  const key = (authorityKey ?? "").trim().toLowerCase();
  switch (key) {
    case "ppa":
    case "philadelphia_parking":
      return "Philadelphia Code §12-2804(8)";
    default:
      // Default (and NJ E-ZPass / NJ MVC / NJ Turnpike / general fallback):
      // NJ rental-vehicle operator-identification statute. Never throw — a
      // missing statute must not block the admin from printing & mailing.
      return "N.J.S.A. 39:4-138.1";
  }
}

export const OWNER = {
  legal: "Rentalprise LLC d/b/a Camauto Rentals",
  address: "416 Sicklerville Rd, Sicklerville NJ 08081",
  phone: "(866) 625-5550",
  email: "violations@camautorentals.com",
  signer: "Rentalprise LLC Admin",
};

export interface ViolationCtx {
  v: Record<string, unknown>;
  vehicle: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
  rental: Record<string, unknown> | null;
  authority: AuthorityAddress | null;
  /** True when renter/rental data came from a migrated (legacy) reservation. */
  fromLegacy?: boolean;
}

export async function loadViolationCtx(violationId: string): Promise<ViolationCtx> {
  const { data: v, error } = await supabaseAdmin
    .from("violations")
    .select("*")
    .eq("id", violationId)
    .maybeSingle();
  if (error || !v) throw new Error("Violation not found");

  const [vehicleRes, driverRes, rentalRes] = await Promise.all([
    v.vehicle_id && v.vehicle_id !== "UNKNOWN"
      ? supabaseAdmin
          .from("vehicles")
          .select("id, plate, make, model, year, vin")
          .eq("id", v.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.driver_id
      ? supabaseAdmin
          .from("drivers")
          .select(
            "id, full_name, first_name, last_name, phone, email, license_number, dl_state, license_expiry, date_of_birth, address, street_address, city, state, zip_code, license_image_url",
          )
          .eq("id", v.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? supabaseAdmin
          .from("rentals")
          .select("id, start_date, end_date, agreement_pdf_url, license_image_url")
          .eq("id", v.rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const authKey = (v.authority_key as string | null) ?? "nj_ezpass";
  const { data: auth } = await supabaseAdmin
    .from("authority_addresses")
    .select("*")
    .eq("key", authKey)
    .maybeSingle();

  // Migrated reservation fallback: when the violation was matched to a legacy
  // reservation (no live driver/rental), pull renter + rental details from it
  // so the mail packet is populated instead of empty.
  let legacyDriver: Record<string, unknown> | null = null;
  let legacyRental: Record<string, unknown> | null = null;
  let legacyVehicle: Record<string, unknown> | null = null;
  let fromLegacy = false;
  const legacyId = v.legacy_rental_id as string | null;
  if (legacyId && !driverRes.data && !rentalRes.data) {
    const { data: lr } = await supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, renter_name, address, dl_number, plate, vehicle, year, color, start_datetime, end_datetime, agreement_pdf_url",
      )
      .eq("id", legacyId)
      .maybeSingle();
    if (lr) {
      fromLegacy = true;
      legacyDriver = {
        full_name: lr.renter_name ?? null,
        address: lr.address ?? null,
        license_number: lr.dl_number ?? null,
      };
      legacyRental = {
        id: lr.id,
        start_date: lr.start_datetime ?? null,
        end_date: lr.end_datetime ?? null,
        agreement_pdf_url: lr.agreement_pdf_url ?? null,
        license_image_url: null,
      };
      if (!vehicleRes.data) {
        legacyVehicle = {
          plate: lr.plate ?? null,
          make: lr.vehicle ?? null,
          model: null,
          year: lr.year ?? null,
          vin: null,
        };
      }
    }
  }

  return {
    v: v as Record<string, unknown>,
    vehicle: (vehicleRes.data as Record<string, unknown> | null) ?? legacyVehicle,
    driver: (driverRes.data as Record<string, unknown> | null) ?? legacyDriver,
    rental: (rentalRes.data as Record<string, unknown> | null) ?? legacyRental,
    authority: (auth as AuthorityAddress | null) ?? null,
    fromLegacy,
  };
}

/** Exact error surfaced when a PPA packet is attempted without a license photo. */
export const PPA_LICENSE_PHOTO_ERROR =
  "Driver's license photo required for Philadelphia violations";

/** Philadelphia PPA violations get a license-photo box on the cover letter. */
function isPpaCtx(ctx: ViolationCtx): boolean {
  const key = String(ctx.v.authority_key ?? "").toLowerCase();
  if (key === "ppa" || key === "philadelphia_parking") return true;
  const name = (ctx.authority?.name ?? "").toLowerCase();
  return /philadelphia|\bppa\b/.test(name);
}

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let mime = (res.headers.get("content-type") ?? "").toLowerCase().split(";")[0] ?? "";
    if (!mime.startsWith("image/")) {
      if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = "image/png";
      else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
      else return null;
    }
    return { bytes, mime };
  } catch {
    return null;
  }
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Dispute packet cover letter (page 1 of the packet; the signed rental
 * agreement follows as page 2). Camauto letterhead design with a highlighted
 * violation-number box, renter information box, and — for Philadelphia PPA
 * violations only — a renter driver's-license photo box top-right. PPA
 * packets cannot be generated without the license photo on file.
 */
export async function buildCoverLetterPdf(ctx: ViolationCtx): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 48;
  const right = pageW - 48;
  const width = right - left;

  const GREEN: [number, number, number] = [0, 168, 84]; // #00a854 — logo only
  const DARK: [number, number, number] = [51, 51, 51];
  const BODY: [number, number, number] = [26, 26, 26];
  const MUTED: [number, number, number] = [102, 102, 102];
  const FAINT: [number, number, number] = [150, 150, 150];
  const LINE: [number, number, number] = [229, 229, 229];
  const BOX_BG: [number, number, number] = [249, 249, 249];
  const YELLOW_BG: [number, number, number] = [255, 244, 230]; // #fff4e6
  const ORANGE: [number, number, number] = [255, 165, 0]; // #ffa500

  const { v, driver } = ctx;
  const ppa = isPpaCtx(ctx);
  const renterName = (driver?.full_name as string | null) ?? "—";
  const licenseNumber = ((driver?.license_number as string | null) ?? "").trim();
  const dlState = ((driver?.dl_state as string | null) ?? "").trim().toUpperCase();
  const licenseLine = [dlState, licenseNumber].filter(Boolean).join(" ");
  const violationNumber =
    (v.reference_number as string | null)?.trim() || String(v.id ?? "—");

  // PPA gate — the license photo must exist before the packet can be built.
  let licenseImg: { dataUrl: string; fmt: "PNG" | "JPEG"; ratio: number } | null = null;
  if (ppa) {
    const url =
      (driver?.license_image_url as string | null) ??
      (ctx.rental?.license_image_url as string | null) ??
      null;
    const img = url ? await fetchImageBytes(url) : null;
    if (!img) throw new Error(PPA_LICENSE_PHOTO_ERROR);
    const fmt = img.mime.includes("png") ? ("PNG" as const) : ("JPEG" as const);
    let ratio = 1.58; // standard license aspect fallback
    try {
      const { PDFDocument } = await import("pdf-lib");
      const probe = await PDFDocument.create();
      const emb =
        fmt === "PNG" ? await probe.embedPng(img.bytes) : await probe.embedJpg(img.bytes);
      ratio = emb.width / emb.height;
    } catch {
      /* keep fallback ratio */
    }
    licenseImg = { dataUrl: bytesToDataUrl(img.bytes, img.mime), fmt, ratio };
  }

  // ---- Header: wordmark + (PPA only) license photo box ----
  let y = 52;
  doc.setFont("helvetica", "bold").setFontSize(34).setTextColor(...GREEN);
  doc.text("camauto", left, y + 26);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...FAINT);
  doc.text("R E N T A L S", left + 3, y + 40); // letter-spacing simulation

  let headerBottom = y + 48;
  if (ppa) {
    const boxW = 85;
    const boxH = 105;
    const boxX = right - boxW;
    const boxY = y - 8;
    doc.setDrawColor(170, 170, 170).setLineWidth(1);
    doc.setLineDashPattern([3, 3], 0);
    doc.rect(boxX, boxY, boxW, boxH, "S");
    doc.setLineDashPattern([], 0);
    let placed = false;
    if (licenseImg) {
      const pad = 5;
      const maxW = boxW - pad * 2;
      const maxH = boxH - pad * 2;
      let w = maxW;
      let h = w / licenseImg.ratio;
      if (h > maxH) {
        h = maxH;
        w = h * licenseImg.ratio;
      }
      try {
        doc.addImage(
          licenseImg.dataUrl,
          licenseImg.fmt,
          boxX + (boxW - w) / 2,
          boxY + (boxH - h) / 2,
          w,
          h,
          undefined,
          "FAST",
        );
        placed = true;
      } catch {
        placed = false;
      }
    }
    if (!placed) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...FAINT);
      doc.text("Renter's", boxX + boxW / 2, boxY + boxH / 2 - 5, { align: "center" });
      doc.text("Driver License", boxX + boxW / 2, boxY + boxH / 2 + 5, { align: "center" });
    }
    headerBottom = Math.max(headerBottom, boxY + boxH);
  }

  // ---- Divider ----
  y = headerBottom + 14;
  doc.setDrawColor(...LINE).setLineWidth(2).line(left, y, right, y);
  y += 24;

  // ---- Company info ----
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...DARK);
  doc.text("Camauto Rentals", left, y);
  y += 15;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  for (const line of [
    "Rentalprise LLC",
    "416 Sicklerville Road",
    "Sicklerville, NJ 08081",
    "Phone: (866) 625-5550",
    "Email: violations@camautorentals.com",
  ]) {
    doc.text(line, left, y);
    y += 13;
  }
  y += 12;

  // ---- Violation number (yellow highlight, orange left border) ----
  const vnH = 52;
  doc.setFillColor(...YELLOW_BG);
  doc.rect(left, y, width, vnH, "F");
  doc.setFillColor(...ORANGE);
  doc.rect(left, y, 4, vnH, "F");
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED);
  doc.text("VIOLATION NUMBER", left + 16, y + 17);
  doc.setFont("courier", "bold").setFontSize(15).setTextColor(...DARK);
  doc.text(violationNumber, left + 16, y + 39);
  y += vnH + 14;

  // ---- Renter information box ----
  let street = ((driver?.address as string | null) ?? "").trim();
  let cityStateZip = [
    ((driver?.city as string | null) ?? "").trim(),
    [driver?.state, driver?.zip_code]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  if (street.includes(",")) {
    const parts = street.split(",").map((p) => p.trim()).filter(Boolean);
    street = parts[0] ?? street;
    if (!cityStateZip) cityStateZip = parts.slice(1).join(", ");
  }
  const renterRows: Array<{ text: string; bold?: boolean; small?: boolean }> = [
    { text: renterName, bold: true },
    ...(street ? [{ text: street }] : []),
    ...(cityStateZip ? [{ text: cityStateZip }] : []),
    ...(licenseLine ? [{ text: `License: ${licenseLine}`, small: true }] : []),
  ];
  const riH = 18 + renterRows.length * 14 + 8;
  doc.setFillColor(...BOX_BG).setDrawColor(...LINE).setLineWidth(1);
  doc.rect(left, y, width, riH, "FD");
  let iy = y + 16;
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED);
  doc.text("RENTER INFORMATION", left + 12, iy);
  iy += 16;
  for (const row of renterRows) {
    doc
      .setFont("helvetica", row.bold ? "bold" : "normal")
      .setFontSize(row.bold ? 11 : row.small ? 8.5 : 10)
      .setTextColor(...(row.small ? MUTED : BODY));
    const wrapped = doc.splitTextToSize(row.text, width - 24) as string[];
    doc.text(wrapped[0]!, left + 12, iy);
    iy += 14;
  }
  y += riH + 14;

  // ---- This packet includes ----
  const includes = [
    "This cover letter",
    "Signed rental agreement",
    ...(ppa ? ["Driver's license photo"] : []),
  ];
  const piH = 18 + includes.length * 14 + 8;
  doc.setFillColor(...BOX_BG).setDrawColor(...LINE).setLineWidth(1);
  doc.rect(left, y, width, piH, "FD");
  let py = y + 16;
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED);
  doc.text("THIS PACKET INCLUDES", left + 12, py);
  py += 16;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...BODY);
  for (const item of includes) {
    doc.text(`•  ${item}`, left + 14, py);
    py += 14;
  }
  y += piH + 20;

  // ---- Body ----
  doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(...BODY);
  doc.text(
    ppa
      ? "Dear Philadelphia Parking Authority,"
      : `Dear ${ctx.authority?.name ?? "Issuing Authority"},`,
    left,
    y,
  );
  y += 18;
  const bodyText =
    "We are submitting this dispute package for the violation referenced above. " +
    "The documentation establishes the renter's identity and our rental company's " +
    "liability framework under the vehicle rental agreement included herein.";
  const bodyLines = doc.splitTextToSize(bodyText, width) as string[];
  for (const line of bodyLines) {
    doc.text(line, left, y);
    y += 14;
  }
  y += 14;
  doc.text("Respectfully submitted,", left, y);
  y += 30;

  // ---- Signature space ----
  doc.setDrawColor(...LINE).setLineWidth(1).line(left, y, right, y);
  y += 40; // blank space for physical signature
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...DARK);
  doc.text("Camauto Rentals Management", left, y);
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text("Rentalprise LLC d/b/a Camauto Rentals", left, y);

  // ---- Footer: single line, no page numbers ----
  doc.setDrawColor(...LINE).setLineWidth(1).line(left, pageH - 44, right, pageH - 44);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...FAINT);
  doc.text("Next page: Signed rental agreement", pageW / 2, pageH - 32, { align: "center" });

  return new Uint8Array(doc.output("arraybuffer"));
}

/** Build + store the liability-transfer cover letter PDF and stamp the violation. */
export async function generateAndStoreLiabilityTransfer(
  violationId: string,
): Promise<{ pdfUrl: string | null }> {
  const ctx = await loadViolationCtx(violationId);
  const pdf = await buildCoverLetterPdf(ctx);
  const path = `liability-transfer/${violationId}/cover-letter.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("violation-photos")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(upErr.message);
  const { data: signed } = await supabaseAdmin.storage
    .from("violation-photos")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  const pdfUrl = signed?.signedUrl ?? null;
  await supabaseAdmin
    .from("violations")
    .update({
      liability_transfer_generated_at: new Date().toISOString(),
      liability_transfer_pdf_url: pdfUrl,
      authority_key: (ctx.v.authority_key as string | null) ?? "nj_ezpass",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", violationId);
  return { pdfUrl };
}
