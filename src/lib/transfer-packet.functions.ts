import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PacketSettings {
  signerName: string;
  signerTitle: string;
  signerCompany: string;
  signatureUrl: string | null;
  defaultAuthority: string;
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
      .select("signer_name, signer_title, signer_company, signature_url, default_authority")
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

    const { error } = await context.supabase
      .from("packet_settings")
      .update(patch as never)
      .eq("id", "default");
    if (error) throw new Error(error.message);

    // Return the freshly saved row
    const { data: row } = await context.supabase
      .from("packet_settings")
      .select("signer_name, signer_title, signer_company, signature_url, default_authority")
      .eq("id", "default")
      .maybeSingle();
    return {
      signerName: (row?.signer_name as string) ?? data.signerName,
      signerTitle: (row?.signer_title as string) ?? data.signerTitle,
      signerCompany: (row?.signer_company as string) ?? data.signerCompany,
      signatureUrl: (row?.signature_url as string) ?? null,
      defaultAuthority: (row?.default_authority as string) ?? data.defaultAuthority,
    };
  });

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

  // Violation Number (large, top)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(176, 0, 32);
  doc.text(`Violation #: ${ctx.violation.referenceNumber}`, left, y);
  y += 26;

  gap(4);
  line("VIOLATION", { bold: true, size: 11 });
  field("Toll Authority", ctx.violation.authorityName);
  field("Date", fmtDate(ctx.violation.dateIssued));
  field("Time", ctx.violation.timeIssued || "—");
  gap();

  line("VEHICLE", { bold: true, size: 11 });
  field("Year / Make / Model", [ctx.vehicle.year, ctx.vehicle.make, ctx.vehicle.model].filter(Boolean).join(" ") || "—");
  field("Plate", ctx.vehicle.plate || "—");
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
  const attestation =
    `I, ${ctx.settings.signerName}, ${ctx.settings.signerTitle} of ${ctx.settings.signerCompany}, ` +
    `hereby attest that the above-referenced vehicle was under an active rental agreement with the individual named above ` +
    `on the date of the violation. Pursuant to the attached rental agreement, responsibility for this violation is hereby ` +
    `transferred to the renter identified above.`;
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

async function loadCtx(violationId: string): Promise<
  | { ok: true; ctx: CoverCtx; agreementUrl: string }
  | { ok: false; errorCode: NonNullable<TransferPacketResult["errorCode"]>; error: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settingsRes = await supabaseAdmin
    .from("packet_settings")
    .select("signer_name, signer_title, signer_company, signature_url, default_authority")
    .eq("id", "default")
    .maybeSingle();
  const s = settingsRes.data ?? ({} as Record<string, unknown>);
  const settings: PacketSettings = {
    signerName: (s.signer_name as string) ?? "Michael Campbell",
    signerTitle: (s.signer_title as string) ?? "Authorized Representative",
    signerCompany: (s.signer_company as string) ?? "Camauto Rentals / Rentalprise LLC",
    signatureUrl: (s.signature_url as string) ?? null,
    defaultAuthority: (s.default_authority as string) ?? "NJ E-ZPass",
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
          .select("id, start_date, end_date, agreement_pdf_url")
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

  if (!agreementUrl) {
    return { ok: false, errorCode: "no_agreement", error: "No rental agreement on file for this violation" };
  }
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
  const renterName =
    (driver?.full_name as string) ||
    `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() ||
    (legacy?.renter_name as string) ||
    "";
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
      authorityName: (v.authority_key as string | null) === "nj_ezpass"
        ? "NJ E-ZPass"
        : settings.defaultAuthority,
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

  return { ok: true, ctx, agreementUrl };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

async function mergeCoverWithAgreement(
  coverPdf: Uint8Array,
  agreementUrl: string,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();

  // Cover first
  const coverDoc = await PDFDocument.load(coverPdf);
  const coverPages = await out.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const p of coverPages) out.addPage(p);

  // Then the signed agreement
  const res = await fetch(agreementUrl);
  if (!res.ok) throw new Error(`Could not fetch rental agreement (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const agreement = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const agreementPages = await out.copyPages(agreement, agreement.getPageIndices());
  for (const p of agreementPages) out.addPage(p);

  return await out.save();
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

async function generateOne(violationId: string): Promise<TransferPacketResult> {
  const loaded = await loadCtx(violationId);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, errorCode: loaded.errorCode };
  }
  try {
    const cover = await buildCoverPdf(loaded.ctx);
    const merged = await mergeCoverWithAgreement(cover, loaded.agreementUrl);

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
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<TransferPacketResult> => {
    return generateOne(data.violationId);
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
    z.object({ violationIds: z.array(z.string().min(1).max(64)).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }): Promise<BatchSummary> => {
    const results: BatchSummary["results"] = [];
    let succeeded = 0;
    let failed = 0;
    for (const id of data.violationIds) {
      const r = await generateOne(id);
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