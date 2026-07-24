import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { statuteFor } from "@/lib/liability-transfer.server";
import { renderRentalAgreementPdf, type RentalAgreementPDFData } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PacketSettings {
  signerName: string;
  signerTitle: string;
  signerCompany: string;
  signatureUrl: string | null;
  defaultAuthority: string;
  defaultPacketLayout: string[];
}

export interface TransferPacketResult {
  ok: boolean;
  filename?: string;
  base64?: string;
  packetUrl?: string | null;
  error?: string;
  errorCode?:
    | "no_rental"
    | "no_agreement"
    | "no_dates"
    | "date_outside_rental"
    | "missing_address"
    | "missing_signature"
    | "missing_authority"
    | "unknown";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getPacketSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PacketSettings> => {
    const { data, error } = await context.supabase
      .from("packet_settings")
      .select("signer_name, signer_title, signer_company, signature_url, default_authority, default_packet_layout")
      .eq("id", "default")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data ?? ({} as Record<string, unknown>);
    return {
      signerName: (row.signer_name as string) ?? "Michael Campbell",
      signerTitle: (row.signer_title as string) ?? "Authorized Representative",
      signerCompany: (row.signer_company as string) ?? "Camauto Rentals / Rentalprise LLC",
      signatureUrl: (row.signature_url as string) ?? null,
      defaultAuthority: (row.default_authority as string) ?? "NJ E-ZPass",
      defaultPacketLayout: normalizeLayout(row.default_packet_layout),
    };
  });

export const savePacketSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        signerName: z.string().min(1).max(200),
        signerTitle: z.string().min(1).max(200),
        signerCompany: z.string().min(1).max(200),
        defaultAuthority: z.string().min(1).max(120),
        // Optional new signature payload (data URL "data:image/png;base64,...")
        signatureDataUrl: z.string().max(4_000_000).nullable().optional(),
        // If true, clears the stored signature.
        clearSignature: z.boolean().optional(),
        defaultPacketLayout: z.array(z.string().min(1).max(40)).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PacketSettings> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let signatureUrl: string | null | undefined = undefined;

    if (data.clearSignature) {
      signatureUrl = null;
    } else if (data.signatureDataUrl) {
      const match = data.signatureDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!match) throw new Error("Invalid signature image — must be a PNG or JPG data URL");
      const contentType = match[1].toLowerCase();
      const b64 = match[2];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = contentType.includes("png") ? "png" : "jpg";
      const path = `packet-signature/${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("violation-photos")
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await supabaseAdmin.storage
        .from("violation-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      signatureUrl = signed?.signedUrl ?? null;
    }

    const patch: Record<string, unknown> = {
      signer_name: data.signerName,
      signer_title: data.signerTitle,
      signer_company: data.signerCompany,
      default_authority: data.defaultAuthority,
    };
    if (signatureUrl !== undefined) patch.signature_url = signatureUrl;
    if (data.defaultPacketLayout) patch.default_packet_layout = normalizeLayout(data.defaultPacketLayout);

    const { error } = await context.supabase
      .from("packet_settings")
      .update(patch as never)
      .eq("id", "default");
    if (error) throw new Error(error.message);

    // Return the freshly saved row
    const { data: row } = await context.supabase
      .from("packet_settings")
      .select("signer_name, signer_title, signer_company, signature_url, default_authority, default_packet_layout")
      .eq("id", "default")
      .maybeSingle();
    return {
      signerName: (row?.signer_name as string) ?? data.signerName,
      signerTitle: (row?.signer_title as string) ?? data.signerTitle,
      signerCompany: (row?.signer_company as string) ?? data.signerCompany,
      signatureUrl: (row?.signature_url as string) ?? null,
      defaultAuthority: (row?.default_authority as string) ?? data.defaultAuthority,
      defaultPacketLayout: normalizeLayout(row?.default_packet_layout),
    };
  });

// ---------------------------------------------------------------------------
// Packet document kinds
// ---------------------------------------------------------------------------

export const PACKET_DOC_KINDS = [
  "cover",
  "agreement",
  "license",
  "selfie",
  "signature",
  "receipt",
  "violation_photo",
] as const;
export type PacketDocKind = (typeof PACKET_DOC_KINDS)[number];

const DOC_LABELS: Record<PacketDocKind, string> = {
  cover: "Transfer Cover Page",
  agreement: "Signed Rental Agreement",
  license: "Driver License",
  selfie: "Renter Selfie",
  signature: "Renter Signature",
  receipt: "Rental Receipt",
  violation_photo: "Violation Photo",
};

function normalizeLayout(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of arr) {
    const k = String(v);
    if ((PACKET_DOC_KINDS as readonly string[]).includes(k) && !out.includes(k)) out.push(k);
  }
  if (out.length === 0) return ["cover", "agreement"];
  return out;
}

// ---------------------------------------------------------------------------
// Date validation
// ---------------------------------------------------------------------------

function parseDateTime(dateIso: string | null, timeStr: string | null): Date | null {
  if (!dateIso) return null;
  const datePart = dateIso.length >= 10 ? dateIso.slice(0, 10) : dateIso;
  let time = "12:00";
  if (timeStr) {
    const m = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const mm = m[2];
      const ampm = m[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      time = `${String(h).padStart(2, "0")}:${mm}`;
    }
  }
  const d = new Date(`${datePart}T${time}:00`);
  return isNaN(d.getTime()) ? null : d;
}

function parseRentalBound(value: string | null, kind: "start" | "end"): Date | null {
  if (!value) return null;
  const s = String(value);
  // Full timestamp
  if (s.length > 10) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Date-only -> treat start as 00:00:00, end as 23:59:59 (inclusive whole day)
  const suffix = kind === "start" ? "T00:00:00" : "T23:59:59";
  const d = new Date(`${s}${suffix}`);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Cover page + merge
// ---------------------------------------------------------------------------

interface CoverCtx {
  violation: {
    id: string;
    referenceNumber: string;
    authorityName: string;
    authorityKey: string | null;
    dateIssued: string | null;
    timeIssued: string | null;
  };
  vehicle: {
    year: string;
    make: string;
    model: string;
    plate: string;
    state: string;
  };
  renter: {
    name: string;
    address: string;
    licenseNumber: string;
    licenseState: string;
    phone: string;
  };
  rental: {
    startDate: string | null;
    endDate: string | null;
  };
  settings: PacketSettings;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const s = String(iso);
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function authorityDisplayName(key: string | null, fallback: string): string {
  switch ((key ?? "").toLowerCase()) {
    case "nj_ezpass": return "NJ E-ZPass";
    case "ny_ezpass": return "NY E-ZPass";
    case "nj_turnpike": return "NJ Turnpike";
    case "pa_turnpike": return "PA Turnpike";
    case "ppa":
    case "philadelphia_parking":
      return "Philadelphia Parking Authority";
    case "nj_mvc": return "NJ Motor Vehicle Commission";
    default: return fallback;
  }
}

async function buildCoverPdf(ctx: CoverCtx): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 54;
  const right = pageW - 54;
  let y = 56;

  const ensure = (space: number) => {
    if (y + space > pageH - 60) {
      doc.addPage();
      y = 56;
    }
  };
  const line = (text: string, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) => {
    ensure(16);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    doc.setTextColor(...(opts?.color ?? [20, 20, 20]));
    const wrapped = doc.splitTextToSize(text, right - left);
    doc.text(wrapped, left, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  };
  const gap = (h = 10) => {
    y += h;
  };
  const field = (label: string, value: string) => {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(value || "—", right - left - 160);
    doc.text(wrapped, left + 160, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 60);
  doc.text("TRANSFER OF RESPONSIBILITY — TOLL VIOLATION", left, y);
  y += 26;
  doc.setDrawColor(16, 122, 60);
  doc.setLineWidth(1.5);
  doc.line(left, y, right, y);
  y += 18;

  // Violation Number — extra large with yellow highlight
  {
    const label = "VIOLATION #";
    const value = ctx.violation.referenceNumber || "—";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(70, 70, 70);
    doc.text(label, left, y);
    y += 6;
    const boxH = 44;
    const boxY = y;
    // Yellow highlight background
    doc.setFillColor(255, 235, 59);
    doc.rect(left, boxY, right - left, boxH, "F");
    doc.setDrawColor(200, 160, 0);
    doc.setLineWidth(1);
    doc.rect(left, boxY, right - left, boxH, "S");
    // Big black violation number centered vertically in the box
    doc.setFont("helvetica", "bold");
    doc.setFontSize(32);
    doc.setTextColor(0, 0, 0);
    doc.text(value, left + 12, boxY + boxH - 12);
    y = boxY + boxH + 16;
  }

  // Issuing Authority — printed near the top so the mailroom sees it before
  // any other detail. Required for the statute branching on the attestation.
  {
    ensure(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(70, 70, 70);
    doc.text("ISSUING AUTHORITY", left, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(20, 20, 20);
    doc.text(ctx.violation.authorityName, left, y);
    y += 14;
  }

  gap(4);
  line("VIOLATION", { bold: true, size: 11 });
  field("Issuing Authority", ctx.violation.authorityName);
  field("Violation #", ctx.violation.referenceNumber || "—");
  field("Date", fmtDate(ctx.violation.dateIssued));
  field("Time", ctx.violation.timeIssued || "—");
  gap();

  line("VEHICLE", { bold: true, size: 11 });
  field("Year / Make / Model", [ctx.vehicle.year, ctx.vehicle.make, ctx.vehicle.model].filter(Boolean).join(" ") || "—");
  // Plate — highlighted yellow so it's unmistakable on the cover.
  {
    ensure(22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    doc.text("Plate", left, y);
    const val = ctx.vehicle.plate || "—";
    const boxX = left + 156;
    const boxY = y - 12;
    const boxW = 180;
    const boxH = 20;
    doc.setFillColor(255, 235, 59);
    doc.rect(boxX, boxY, boxW, boxH, "F");
    doc.setDrawColor(200, 160, 0);
    doc.setLineWidth(0.75);
    doc.rect(boxX, boxY, boxW, boxH, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(val, boxX + 8, y + 2);
    y += 22;
  }
  field("State", ctx.vehicle.state || "—");
  gap();

  line("RENTER", { bold: true, size: 11 });
  field("Full Legal Name", ctx.renter.name || "—");
  field("Address", ctx.renter.address || "—");
  field(
    "Driver's License",
    ctx.renter.licenseNumber
      ? `${ctx.renter.licenseNumber}${ctx.renter.licenseState ? ` (${ctx.renter.licenseState})` : ""}`
      : "—",
  );
  field("Phone", ctx.renter.phone || "—");
  gap();

  line("RENTAL PERIOD", { bold: true, size: 11 });
  field(
    "Period",
    `${fmtDate(ctx.rental.startDate)} — ${ctx.rental.endDate ? fmtDate(ctx.rental.endDate) : "ongoing"}`,
  );
  gap(14);

  // Attestation
  line("ATTESTATION", { bold: true, size: 11 });
  gap(2);
  // Statute is chosen by authority — throws if unknown so we never mail a
  // packet citing the wrong body of law.
  const statute = statuteFor(ctx.violation.authorityKey);
  const attestation =
    `I, ${ctx.settings.signerName}, ${ctx.settings.signerTitle} of ${ctx.settings.signerCompany}, ` +
    `hereby attest that the above-referenced vehicle was under an active rental agreement with the individual named above ` +
    `on the date of the violation. Pursuant to ${statute} and the attached rental agreement, responsibility for this ` +
    `violation is hereby transferred to the renter identified above.`;
  line(attestation);
  gap(24);

  // Signature block
  ensure(120);
  const sigTop = y;
  const sigLineY = sigTop + 60;
  // Signature image if available
  if (ctx.settings.signatureUrl) {
    try {
      const res = await fetch(ctx.settings.signatureUrl);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        // jsPDF addImage accepts a base64-ish binary string
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const b64 = btoa(bin);
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        const fmt = ct.includes("jpeg") || ct.includes("jpg") ? "JPEG" : "PNG";
        doc.addImage(`data:${ct || "image/png"};base64,${b64}`, fmt, left, sigTop, 180, 54);
      }
    } catch { /* ignore — fall through to plain line */ }
  }
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.line(left, sigLineY, left + 260, sigLineY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Signature", left, sigLineY + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(ctx.settings.signerName, left, sigLineY + 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);
  doc.text(`${ctx.settings.signerTitle}, ${ctx.settings.signerCompany}`, left, sigLineY + 46);
  doc.text(`Date of Generation: ${fmtDate(new Date().toISOString())}`, left, sigLineY + 62);

  return new Uint8Array(doc.output("arraybuffer"));
}

// ---------------------------------------------------------------------------
// Loader + validator
// ---------------------------------------------------------------------------

async function loadCtx(
  violationId: string,
  opts?: { renterAddressOverride?: string | null; allowUnsigned?: boolean },
): Promise<
  | {
      ok: true;
      ctx: CoverCtx;
      agreementUrl: string | null;
      docUrls: Partial<Record<PacketDocKind, string>>;
      defaultLayout: string[];
      agreementSigned: boolean;
      renterName: string;
    }
  | { ok: false; errorCode: NonNullable<TransferPacketResult["errorCode"]>; error: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settingsRes = await supabaseAdmin
    .from("packet_settings")
    .select("signer_name, signer_title, signer_company, signature_url, default_authority, default_packet_layout")
    .eq("id", "default")
    .maybeSingle();
  const s = settingsRes.data ?? ({} as Record<string, unknown>);
  const settings: PacketSettings = {
    signerName: (s.signer_name as string) ?? "Michael Campbell",
    signerTitle: (s.signer_title as string) ?? "Authorized Representative",
    signerCompany: (s.signer_company as string) ?? "Camauto Rentals / Rentalprise LLC",
    signatureUrl: (s.signature_url as string) ?? null,
    defaultAuthority: (s.default_authority as string) ?? "NJ E-ZPass",
    defaultPacketLayout: normalizeLayout((s as Record<string, unknown>).default_packet_layout),
  };

  const { data: v, error: vErr } = await supabaseAdmin
    .from("violations")
    .select("*")
    .eq("id", violationId)
    .maybeSingle();
  if (vErr || !v) return { ok: false, errorCode: "unknown", error: "Violation not found" };

  if (!v.rental_id && !v.legacy_rental_id) {
    return { ok: false, errorCode: "no_rental", error: "Violation is not matched to a rental" };
  }

  // Block generation up-front when authority is missing / unrecognized so we
  // never mail a packet citing the wrong body of law. statuteFor throws on
  // anything we don't have a mapping for.
  try {
    statuteFor((v.authority_key as string | null) ?? null);
  } catch (e) {
    return {
      ok: false,
      errorCode: "missing_authority",
      error:
        e instanceof Error
          ? e.message
          : "Authority is not set on this violation — pick the toll/parking authority before generating.",
    };
  }

  // If admin provided an address override, persist before loading — so the
  // saved value shows up on this packet AND every future one.
  if (opts?.renterAddressOverride && opts.renterAddressOverride.trim().length > 0) {
    const addr = opts.renterAddressOverride.trim();
    if (v.driver_id) {
      await supabaseAdmin.from("drivers").update({ address: addr } as never).eq("id", v.driver_id);
    } else if (v.legacy_rental_id) {
      await supabaseAdmin
        .from("legacy_rentals")
        .update({ address: addr } as never)
        .eq("id", v.legacy_rental_id);
    }
  }

  const [vehicleRes, driverRes, rentalRes, legacyRentalRes] = await Promise.all([
    v.vehicle_id && v.vehicle_id !== "UNKNOWN"
      ? supabaseAdmin
          .from("vehicles")
          .select("id, plate, plate_state, make, model, year")
          .eq("id", v.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.driver_id
      ? supabaseAdmin
          .from("drivers")
          .select(
            "id, full_name, first_name, last_name, phone, license_number, dl_state, address, street_address, city, state, zip_code",
          )
          .eq("id", v.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? supabaseAdmin
          .from("rentals")
          .select(
            "id, start_date, end_date, agreement_pdf_url, license_image_url, selfie_image_url, client_signature_url, client_signed_at, signed_at, receipt_pdf_url",
          )
          .eq("id", v.rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.legacy_rental_id
      ? supabaseAdmin
          .from("legacy_rentals")
          .select(
            "id, renter_name, address, dl_number, dl_state, phone, plate, vehicle, year, color, start_datetime, end_datetime, agreement_pdf_url",
          )
          .eq("id", v.legacy_rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const vehicle = vehicleRes.data as Record<string, unknown> | null;
  const driver = driverRes.data as Record<string, unknown> | null;
  const rental = rentalRes.data as Record<string, unknown> | null;
  const legacy = legacyRentalRes.data as Record<string, unknown> | null;

  const rentalStart =
    (rental?.start_date as string | null) ?? (legacy?.start_datetime as string | null) ?? null;
  const rentalEnd =
    (rental?.end_date as string | null) ?? (legacy?.end_datetime as string | null) ?? null;
  const agreementUrl =
    (rental?.agreement_pdf_url as string | null) ?? (legacy?.agreement_pdf_url as string | null) ?? null;

  if (!rentalStart || !rentalEnd) {
    return { ok: false, errorCode: "no_dates", error: "Rental period is incomplete — cannot validate date" };
  }

  const violationAt = parseDateTime(
    (v.date_issued as string | null) ?? null,
    (v.violation_time as string | null) ?? null,
  );
  const startAt = parseRentalBound(rentalStart, "start");
  const endAt = parseRentalBound(rentalEnd, "end");

  if (!violationAt || !startAt || !endAt) {
    return { ok: false, errorCode: "no_dates", error: "Could not parse violation or rental dates" };
  }
  if (violationAt < startAt || violationAt > endAt) {
    return {
      ok: false,
      errorCode: "date_outside_rental",
      error: "Violation date outside rental period — check match before generating.",
    };
  }

  const renterAddress =
    (driver?.address as string) ||
    [driver?.street_address, driver?.city, driver?.state, driver?.zip_code].filter(Boolean).join(", ") ||
    (legacy?.address as string) ||
    "";
  if (!renterAddress || renterAddress.trim().length === 0) {
    return {
      ok: false,
      errorCode: "missing_address",
      error: "Renter address is missing on the rental agreement — enter it to continue.",
    };
  }
  const renterName =
    (driver?.full_name as string) ||
    `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() ||
    (legacy?.renter_name as string) ||
    "";

  // Signature: live rental is signed when signed_at OR client_signed_at OR
  // client_signature_url is set. Legacy rentals with an agreement_pdf_url are
  // treated as signed (the PDF itself is the signed artifact).
  const agreementSigned = rental
    ? !!(
        (rental.signed_at as string | null) ||
        (rental.client_signed_at as string | null) ||
        (rental.client_signature_url as string | null)
      )
    : !!(legacy?.agreement_pdf_url as string | null);
  if (!agreementSigned && !opts?.allowUnsigned) {
    return {
      ok: false,
      errorCode: "missing_signature",
      error:
        "Rental agreement has no renter signature on file — send a retroactive signing link or acknowledge to override.",
    };
  }

  const renterLicense =
    (driver?.license_number as string) || (legacy?.dl_number as string) || "";
  const renterLicenseState =
    (driver?.dl_state as string) || (legacy?.dl_state as string) || "";
  const renterPhone = (driver?.phone as string) || (legacy?.phone as string) || "";

  const ctx: CoverCtx = {
    violation: {
      id: v.id,
      referenceNumber:
        ((v.reference_number as string | null) ?? "").trim() || String(v.id).toUpperCase(),
      authorityName: authorityDisplayName(
        (v.authority_key as string | null) ?? null,
        settings.defaultAuthority,
      ),
      authorityKey: (v.authority_key as string | null) ?? null,
      dateIssued: (v.date_issued as string | null) ?? null,
      timeIssued: (v.violation_time as string | null) ?? null,
    },
    vehicle: {
      year: String(vehicle?.year ?? legacy?.year ?? ""),
      make: String(vehicle?.make ?? legacy?.vehicle ?? ""),
      model: String(vehicle?.model ?? ""),
      plate: String(v.license_plate ?? vehicle?.plate ?? legacy?.plate ?? ""),
      state: String(vehicle?.plate_state ?? ""),
    },
    renter: {
      name: renterName,
      address: renterAddress,
      licenseNumber: renterLicense,
      licenseState: renterLicenseState,
      phone: renterPhone,
    },
    rental: {
      startDate: rentalStart,
      endDate: rentalEnd,
    },
    settings,
  };

  const docUrls: Partial<Record<PacketDocKind, string>> = {};
  if (agreementUrl) docUrls.agreement = agreementUrl;
  if (rental?.license_image_url) docUrls.license = String(rental.license_image_url);
  if (rental?.selfie_image_url) docUrls.selfie = String(rental.selfie_image_url);
  if (rental?.client_signature_url) docUrls.signature = String(rental.client_signature_url);
  if (rental?.receipt_pdf_url) docUrls.receipt = String(rental.receipt_pdf_url);
  if (v.photo_url) docUrls.violation_photo = String(v.photo_url);

  return {
    ok: true,
    ctx,
    agreementUrl,
    docUrls,
    defaultLayout: settings.defaultPacketLayout,
    agreementSigned,
    renterName,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  return { bytes, contentType };
}

function isPdfBytes(bytes: Uint8Array, contentType: string): boolean {
  if (contentType.includes("pdf")) return true;
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isPngBytes(bytes: Uint8Array, contentType: string): boolean {
  if (contentType.includes("png")) return true;
  return (
    bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

/**
 * Draw a semi-transparent yellow highlight over every occurrence of `plate`
 * (case-insensitive, whitespace-agnostic) across all pages of `bytes`.
 * Uses pdfjs-dist to locate text-item positions and pdf-lib to overlay
 * rectangles. Returns the original bytes if anything goes wrong so we never
 * break packet generation over a highlight failure.
 */
async function highlightPlateOnPdf(bytes: Uint8Array, plate: string): Promise<Uint8Array> {
  const target = plate.replace(/\s+/g, "").toUpperCase();
  if (target.length < 3) return bytes;
  try {
    // Legacy build works outside the browser (no worker required).
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = "";
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
      disableWorker: true,
    });
    const src = await loadingTask.promise;
    const { PDFDocument, rgb } = await import("pdf-lib");
    const out = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = out.getPages();
    const pageCount = Math.min(src.numPages, pages.length);
    for (let i = 0; i < pageCount; i++) {
      const page = await src.getPage(i + 1);
      const content = await page.getTextContent();
      const outPage = pages[i];
      for (const item of content.items as Array<any>) {
        const s = String(item.str ?? "").replace(/\s+/g, "").toUpperCase();
        if (!s || !s.includes(target)) continue;
        const t = item.transform as number[];
        const x = t[4];
        const y = t[5];
        const w = Number(item.width) || target.length * 6;
        const h = Number(item.height) || Math.abs(t[3]) || 10;
        outPage.drawRectangle({
          x: x - 1,
          y: y - 1,
          width: w + 2,
          height: h + 2,
          color: rgb(1, 0.92, 0.23),
          opacity: 0.45,
        });
      }
    }
    return await out.save();
  } catch {
    return bytes;
  }
}

async function mergeDocuments(
  parts: Array<{ kind: PacketDocKind; bytes?: Uint8Array; url?: string }>,
  opts?: { highlightPlate?: string | null },
): Promise<{ merged: Uint8Array; used: PacketDocKind[]; missing: PacketDocKind[] }> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  const used: PacketDocKind[] = [];
  const missing: PacketDocKind[] = [];

  for (const part of parts) {
    try {
      let bytes: Uint8Array | null = null;
      let contentType = "";
      if (part.bytes) {
        bytes = part.bytes;
        contentType = "application/pdf";
      } else if (part.url) {
        const fetched = await fetchBytes(part.url);
        bytes = fetched.bytes;
        contentType = fetched.contentType;
      }
      if (!bytes) {
        missing.push(part.kind);
        continue;
      }
      if (isPdfBytes(bytes, contentType)) {
        const pdfBytes: Uint8Array =
          part.kind === "agreement" && opts?.highlightPlate
            ? await highlightPlateOnPdf(bytes, opts.highlightPlate)
            : bytes;
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await out.copyPages(doc, doc.getPageIndices());
        for (const p of pages) out.addPage(p);
      } else {
        // Embed image on a letter-size page.
        const img = isPngBytes(bytes, contentType)
          ? await out.embedPng(bytes)
          : await out.embedJpg(bytes);
        const page = out.addPage([612, 792]);
        const margin = 36;
        const maxW = 612 - margin * 2;
        const maxH = 792 - margin * 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: (612 - w) / 2,
          y: (792 - h) / 2,
          width: w,
          height: h,
        });
      }
      used.push(part.kind);
    } catch {
      missing.push(part.kind);
    }
  }

  const merged = await out.save();
  return { merged, used, missing };
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function safeName(s: string | null | undefined): string {
  return (s ?? "").replace(/[^a-z0-9]+/gi, "").toUpperCase() || "NA";
}

async function generateOne(
  violationId: string,
  documents?: string[] | null,
  overrides?: { renterAddressOverride?: string | null; allowUnsigned?: boolean },
): Promise<TransferPacketResult> {
  const loaded = await loadCtx(violationId, overrides);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, errorCode: loaded.errorCode };
  }
  try {
    const layout = normalizeLayout(
      documents && documents.length > 0 ? documents : loaded.defaultLayout,
    );
    const parts: Array<{ kind: PacketDocKind; bytes?: Uint8Array; url?: string }> = [];
    for (const kindStr of layout) {
      const kind = kindStr as PacketDocKind;
      if (kind === "cover") {
        parts.push({ kind, bytes: await buildCoverPdf(loaded.ctx) });
      } else {
        const url = loaded.docUrls[kind];
        if (url) parts.push({ kind, url });
        // silently skip missing docs
      }
    }
    if (parts.length === 0) {
      return { ok: false, errorCode: "unknown", error: "No documents selected for packet" };
    }
    const { merged } = await mergeDocuments(parts, {
      highlightPlate: loaded.ctx.vehicle.plate || null,
    });

    const plate = safeName(loaded.ctx.vehicle.plate);
    const ref = safeName(loaded.ctx.violation.referenceNumber);
    const dateStr = (loaded.ctx.violation.dateIssued || "").slice(0, 10).replace(/-/g, "");
    const filename = `TRANSFER_PACKET_${ref}_${plate}${dateStr ? `_${dateStr}` : ""}.pdf`;

    // Persist to storage so the row shows a stable download link.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `transfer-packet/${violationId}/${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .upload(path, merged, { contentType: "application/pdf", upsert: true });
    let packetUrl: string | null = null;
    if (!upErr) {
      const { data: signed } = await supabaseAdmin.storage
        .from("violation-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      packetUrl = signed?.signedUrl ?? null;
      await supabaseAdmin
        .from("violations")
        .update({
          transfer_packet_url: packetUrl,
          transfer_packet_generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", violationId);
    }

    return { ok: true, filename, base64: toBase64(merged), packetUrl };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to build packet",
      errorCode: "unknown",
    };
  }
}

// ---------------------------------------------------------------------------
// Public server functions
// ---------------------------------------------------------------------------

export const generateTransferPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        documents: z.array(z.string().min(1).max(40)).max(20).optional(),
        renterAddressOverride: z.string().max(500).optional(),
        allowUnsigned: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<TransferPacketResult> => {
    return generateOne(data.violationId, data.documents ?? null, {
      renterAddressOverride: data.renterAddressOverride ?? null,
      allowUnsigned: data.allowUnsigned ?? false,
    });
  });

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    violationId: string;
    ok: boolean;
    error?: string;
    errorCode?: TransferPacketResult["errorCode"];
    packetUrl?: string | null;
  }>;
}

export const batchGenerateTransferPackets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationIds: z.array(z.string().min(1).max(64)).min(1).max(200),
        documents: z.array(z.string().min(1).max(40)).max(20).optional(),
        allowUnsigned: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<BatchSummary> => {
    const results: BatchSummary["results"] = [];
    let succeeded = 0;
    let failed = 0;
    for (const id of data.violationIds) {
      const r = await generateOne(id, data.documents ?? null, {
        allowUnsigned: data.allowUnsigned ?? false,
      });
      if (r.ok) {
        succeeded++;
        results.push({ violationId: id, ok: true, packetUrl: r.packetUrl ?? null });
      } else {
        failed++;
        results.push({ violationId: id, ok: false, error: r.error, errorCode: r.errorCode });
      }
    }
    return { total: data.violationIds.length, succeeded, failed, results };
  });

// ---------------------------------------------------------------------------
// Packet Builder helpers
// ---------------------------------------------------------------------------

export interface AvailableDoc {
  kind: PacketDocKind;
  label: string;
  available: boolean;
  url: string | null;
}

export interface PacketBuilderData {
  violationId: string;
  referenceNumber: string;
  defaultLayout: string[];
  available: AvailableDoc[];
  validation:
    | { ok: true }
    | { ok: false; errorCode: NonNullable<TransferPacketResult["errorCode"]>; error: string };
}

export const getPacketBuilderData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<PacketBuilderData> => {
    const loaded = await loadCtx(data.violationId);
    if (!loaded.ok) {
      // Still return default layout so the UI can render, but signal the error.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const settingsRes = await supabaseAdmin
        .from("packet_settings")
        .select("default_packet_layout")
        .eq("id", "default")
        .maybeSingle();
      return {
        violationId: data.violationId,
        referenceNumber: data.violationId,
        defaultLayout: normalizeLayout(settingsRes.data?.default_packet_layout),
        available: PACKET_DOC_KINDS.map((k) => ({
          kind: k,
          label: DOC_LABELS[k],
          available: k === "cover",
          url: null,
        })),
        validation: { ok: false, errorCode: loaded.errorCode, error: loaded.error },
      };
    }
    const available: AvailableDoc[] = PACKET_DOC_KINDS.map((k) => {
      if (k === "cover") {
        return { kind: k, label: DOC_LABELS[k], available: true, url: null };
      }
      const url = loaded.docUrls[k] ?? null;
      return { kind: k, label: DOC_LABELS[k], available: !!url, url };
    });
    return {
      violationId: data.violationId,
      referenceNumber: loaded.ctx.violation.referenceNumber,
      defaultLayout: loaded.defaultLayout,
      available,
      validation: { ok: true },
    };
  });