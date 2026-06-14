import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { renderRentalAgreementPdf, type RentalAgreementPDFData } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";
import { getRequestHeader } from "@tanstack/react-start/server";

export type ViolationReadinessState = "ready" | "awaiting_signature" | "missing_info";

export interface ViolationReadiness {
  state: ViolationReadinessState;
  label: string;
  missingFields: string[];
  hasSignedAgreement: boolean;
  infoComplete: boolean;
  retroSentAt: string | null;
  retroSignedAt: string | null;
  overridden: boolean;
  overrideNote: string | null;
  phone: string | null;
  customerName: string | null;
}

const NJ_OVERRIDE_NOTE =
  "Customer unreachable - proceeding with available info per N.J.S.A. 39:4-138.1";

function appOrigin(): string {
  return (process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app").replace(/\/$/, "");
}

function makeToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  ).slice(0, 40);
}

function blank(v: unknown): boolean {
  const s = typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
  return s === "" || s === "—" || s === "-";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ResolvedTarget {
  driver: any | null;
  rental: any | null;
  vehicle: any | null;
  /** legacy_rentals row holding retro_sent_at / retro_signed_at state (shell or direct legacy) */
  shell: any | null;
  isLegacyDirect: boolean;
}

async function resolveTarget(admin: any, v: any): Promise<ResolvedTarget> {
  const [driverRes, rentalRes, vehicleRes] = await Promise.all([
    v.driver_id
      ? admin.from("drivers").select("*").eq("id", v.driver_id).maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? admin.from("rentals").select("*").eq("id", v.rental_id).maybeSingle()
      : Promise.resolve({ data: null }),
    v.vehicle_id && v.vehicle_id !== "UNKNOWN"
      ? admin.from("vehicles").select("*").eq("id", v.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let shell: any | null = null;
  let isLegacyDirect = false;
  const shellId = v.retro_legacy_rental_id || (!rentalRes.data ? v.legacy_rental_id : null);
  if (shellId) {
    const { data: lr } = await admin.from("legacy_rentals").select("*").eq("id", shellId).maybeSingle();
    shell = lr ?? null;
    isLegacyDirect = !v.retro_legacy_rental_id && Boolean(v.legacy_rental_id) && !rentalRes.data;
  }

  return {
    driver: driverRes.data ?? null,
    rental: rentalRes.data ?? null,
    vehicle: vehicleRes.data ?? null,
    shell,
    isLegacyDirect,
  };
}

function computeReadiness(v: any, t: ResolvedTarget): ViolationReadiness {
  const overridden = Boolean(v.mail_override_at);

  // Renter info completeness
  const missingFields: string[] = [];
  let fullName: unknown;
  let address: unknown;
  let license: unknown;
  let dob: unknown;
  let phone: string | null = null;
  let signed = false;

  if (t.rental || t.driver) {
    // Live rental/driver
    const d = t.driver ?? {};
    const r = t.rental ?? {};
    fullName = d.full_name;
    address =
      d.address ||
      [d.street_address, d.city, d.state, d.zip_code].filter(Boolean).join(", ");
    license = d.license_number;
    dob = d.date_of_birth;
    phone = (d.phone as string) ?? null;
    signed = Boolean(r.client_signed_at);
  } else if (t.shell) {
    // Legacy / shell record
    const lr = t.shell;
    fullName = lr.renter_name;
    address = lr.address;
    license = lr.dl_number;
    dob = lr.dob;
    phone = (lr.phone as string) ?? null;
    signed = Boolean(lr.retro_signed_at || lr.agreement_pdf_url);
  }
  if (phone == null && t.shell?.phone) phone = t.shell.phone as string;

  if (blank(fullName)) missingFields.push("Full name");
  if (blank(address)) missingFields.push("Address");
  if (blank(license)) missingFields.push("Driver's license #");
  if (blank(dob)) missingFields.push("Date of birth");
  const infoComplete = missingFields.length === 0;

  const retroSentAt = (t.shell?.retro_sent_at as string) ?? null;
  const retroSignedAt = (t.shell?.retro_signed_at as string) ?? null;
  if (retroSignedAt) signed = true;

  let state: ViolationReadinessState;
  let label: string;
  if (overridden) {
    state = "ready";
    label = "Override — proceeding without signature";
  } else if (signed && infoComplete) {
    state = "ready";
    label = "Ready to mail — signed + complete";
  } else if (retroSentAt && !retroSignedAt) {
    state = "awaiting_signature";
    label = "Awaiting agreement signature";
  } else {
    state = "missing_info";
    label = "Missing renter info — send retroactive link";
  }

  return {
    state,
    label,
    missingFields,
    hasSignedAgreement: signed,
    infoComplete,
    retroSentAt,
    retroSignedAt,
    overridden,
    overrideNote: (v.mail_override_note as string) ?? null,
    phone,
    customerName: (fullName as string) ?? null,
  };
}

/** Compute the mail-packet readiness + retro-agreement status for a violation. */
export const getViolationReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ violationId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }): Promise<ViolationReadiness> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v, error } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.violationId)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");
    const t = await resolveTarget(supabaseAdmin, v);
    return computeReadiness(v, t);
  });

/**
 * Send the customer a retroactive-agreement signing link (existing
 * /sign-agreement-retro/[token] flow) via GHL SMS. For violations matched to a
 * live rental we create a legacy_rentals "shell" that points back at the live
 * rental/driver so signing fills them in. For legacy-matched violations we use
 * the legacy row directly.
 */
export const sendViolationRetroLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        phone: z.string().min(7).max(30),
        message: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/ghl.server");

    const { data: v, error } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.violationId)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");

    const t = await resolveTarget(supabaseAdmin, v);

    // Determine / create the legacy_rentals record that backs this retro link.
    let shellId: string | null =
      (v.retro_legacy_rental_id as string | null) ||
      (t.isLegacyDirect ? (v.legacy_rental_id as string | null) : null);

    if (!shellId) {
      // Build a shell seeded from the live rental / driver / vehicle.
      const d = t.driver ?? {};
      const r = t.rental ?? {};
      const ve = t.vehicle ?? {};
      const vehicleText = [ve.make, ve.model].filter(Boolean).join(" ") || (ve.make ?? null);
      const { data: shell, error: insErr } = await supabaseAdmin
        .from("legacy_rentals")
        .insert({
          renter_name: (d.full_name as string) ?? "Renter",
          vehicle: vehicleText,
          year: ve.year ? String(ve.year) : null,
          color: (ve.color as string) ?? null,
          plate: (ve.plate as string) ?? (v.license_plate as string) ?? null,
          start_datetime: r.start_date ?? null,
          end_datetime: r.end_date ?? null,
          phone: data.phone || (d.phone as string) || null,
          email: (d.email as string) ?? null,
          address: (d.address as string) ?? null,
          dl_number: d.license_number && d.license_number !== "—" ? d.license_number : null,
          dl_state: (d.dl_state as string) ?? null,
          dob: (d.date_of_birth as string) ?? null,
          status: "retro_shell",
          target_rental_id: (r.id as string) ?? null,
          target_driver_id: (d.id as string) ?? null,
        } as never)
        .select("id")
        .single();
      if (insErr || !shell) throw new Error(insErr?.message || "Could not create retro record");
      shellId = (shell as { id: string }).id;
      await supabaseAdmin
        .from("violations")
        .update({ retro_legacy_rental_id: shellId, updated_at: new Date().toISOString() } as never)
        .eq("id", v.id);
    }

    // Read renter name for the SMS + set/refresh the token on the shell.
    const { data: lr } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, start_datetime, retro_token")
      .eq("id", shellId)
      .maybeSingle();
    const token = (lr?.retro_token as string) || makeToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("legacy_rentals")
      .update({
        retro_token: token,
        retro_token_expires_at: expires,
        retro_sent_at: new Date().toISOString(),
        phone: data.phone,
      } as never)
      .eq("id", shellId);
    if (upErr) throw new Error(upErr.message);

    const link = `${appOrigin()}/sign-agreement-retro/${token}`;
    const name = (lr?.renter_name as string) || "there";
    const dateStr = lr?.start_datetime
      ? new Date(lr.start_datetime).toLocaleDateString("en-US")
      : "your rental";
    const sms =
      (data.message && data.message.trim()) ||
      `Hi ${name}, Camauto Rentals needs you to sign a rental agreement for your rental on ${dateStr}. This is required for compliance. Click to sign: ${link}`;
    await sendSms(data.phone, sms, name);

    return { ok: true as const, link };
  });

/**
 * Admin override for unreachable customers: allows the mail packet to proceed
 * without a signed retroactive agreement. Requires a note and is recorded in
 * the violation status-history audit trail.
 */
export const overrideViolationMailReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        note: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const note = (data.note && data.note.trim()) || NJ_OVERRIDE_NOTE;
    const now = new Date().toISOString();

    const { data: v } = await supabaseAdmin
      .from("violations")
      .select("status")
      .eq("id", data.violationId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("violations")
      .update({
        mail_override_at: now,
        mail_override_note: note,
        mail_override_by: context.userId,
        updated_at: now,
      } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);

    // Audit trail
    let changedByName: string | null = null;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    changedByName = (prof?.full_name as string) ?? null;

    await supabaseAdmin.from("violation_status_history").insert({
      violation_id: data.violationId,
      from_status: (v?.status as string) ?? null,
      to_status: "mail_override",
      reason: note,
      changed_by: context.userId,
      changed_by_name: changedByName,
    } as never);

    return { ok: true as const, note };
  });

/** Convert a base64 PNG data URL to JPEG bytes that jsPDF can embed in the Worker runtime. */
async function signatureToJpeg(dataUrl: string): Promise<Buffer | null> {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const ab = Buffer.from(base64, "base64");
    // @ts-expect-error — upng-js has no types
    const UPNG = (await import("upng-js")).default;
    const jpeg = (await import("jpeg-js")).default;
    const decoded = UPNG.decode(ab);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    const w = decoded.width;
    const h = decoded.height;
    const rgb = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = rgba[i * 4 + 3] / 255;
      rgb[i * 4] = Math.round(rgba[i * 4] * a + 255 * (1 - a));
      rgb[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + 255 * (1 - a));
      rgb[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + 255 * (1 - a));
      rgb[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ data: rgb, width: w, height: h }, 90);
    return Buffer.from(encoded.data);
  } catch (e) {
    console.warn("[violation-agreement] signature convert failed", e);
    return null;
  }
}

/** Read the violation date (YYYY-MM-DD) for client-side date prefill / validation. */
async function logViolationAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  violationId: string,
  fromStatus: string | null,
  toStatus: string,
  reason: string,
  changedBy: string,
) {
  let changedByName: string | null = null;
  const { data: prof } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", changedBy)
    .maybeSingle();
  changedByName = (prof?.full_name as string) ?? null;
  await admin.from("violation_status_history").insert({
    violation_id: violationId,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    changed_by: changedBy,
    changed_by_name: changedByName,
  } as never);
}

/**
 * Create Agreement flow (from the violation match dialog).
 *
 * Builds a standard customer-style rental agreement covering the supplied
 * dates, then either:
 *  - "link": seeds a legacy_rentals retro shell with the entered info + dates,
 *    sends the SMS sign link (existing /sign-agreement-retro flow), and marks
 *    the violation "Awaiting signature".
 *  - "admin": generates the signed agreement PDF immediately (same template,
 *    NO admin watermark / N.J.S.A. text — those belong only in the cover
 *    letter), fills the live driver/rental (or legacy shell) in place, and
 *    records who signed it in the INTERNAL audit trail only.
 *
 * Dates MUST cover the violation date. Renter address / license # / DOB are
 * required. The audit log is never written onto the PDF.
 */
export const createViolationAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date required"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date required"),
        fullName: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(7).max(30),
        email: z.string().trim().max(120).optional().default(""),
        address: z.string().trim().min(3, "Address is required").max(300),
        licenseNumber: z.string().trim().min(2, "License # is required").max(40),
        dlState: z.string().trim().max(4).optional().default(""),
        dateOfBirth: z.string().trim().min(4, "Date of birth is required").max(20),
        signingMethod: z.enum(["link", "admin"]),
        signatureDataUrl: z.string().optional().default(""),
        customMessage: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: v, error } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.violationId)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");

    const violationDate = String((v as { date_issued?: string }).date_issued || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(violationDate)) {
      throw new Error("This violation has no valid date to validate against");
    }
    // Date coverage validation (server-side gate).
    if (data.startDate > violationDate) {
      throw new Error(`Rental start date must be on or before the violation date (${violationDate})`);
    }
    if (data.endDate < violationDate) {
      throw new Error(`Rental end date must be on or after the violation date (${violationDate})`);
    }
    if (data.endDate < data.startDate) {
      throw new Error("Rental end date cannot be before the start date");
    }

    const t = await resolveTarget(supabaseAdmin, v);
    const nowIso = new Date().toISOString();

    // ---- Ensure a legacy_rentals shell exists, seeded with entered info + dates ----
    let shellId: string | null =
      (v.retro_legacy_rental_id as string | null) ||
      (t.isLegacyDirect ? (v.legacy_rental_id as string | null) : null);

    const ve = t.vehicle ?? {};
    const d = t.driver ?? {};
    const r = t.rental ?? {};
    const vehicleText = [ve.make, ve.model].filter(Boolean).join(" ") || (ve.make ?? null);
    const plate = (ve.plate as string) ?? (v.license_plate as string) ?? null;

    const shellPatch = {
      renter_name: data.fullName,
      vehicle: vehicleText,
      year: ve.year ? String(ve.year) : null,
      color: (ve.color as string) ?? null,
      plate,
      start_datetime: data.startDate,
      end_datetime: data.endDate,
      phone: data.phone,
      email: data.email || (d.email as string) || null,
      address: data.address,
      dl_number: data.licenseNumber,
      dl_state: data.dlState || (d.dl_state as string) || null,
      dob: data.dateOfBirth,
    };

    if (!shellId) {
      const { data: shell, error: insErr } = await supabaseAdmin
        .from("legacy_rentals")
        .insert({
          ...shellPatch,
          status: "retro_shell",
          target_rental_id: (r.id as string) ?? null,
          target_driver_id: (d.id as string) ?? null,
        } as never)
        .select("id")
        .single();
      if (insErr || !shell) throw new Error(insErr?.message || "Could not create agreement record");
      shellId = (shell as { id: string }).id;
      await supabaseAdmin
        .from("violations")
        .update({ retro_legacy_rental_id: shellId, updated_at: nowIso } as never)
        .eq("id", v.id);
    } else {
      await supabaseAdmin.from("legacy_rentals").update(shellPatch as never).eq("id", shellId);
    }

    await logViolationAudit(
      supabaseAdmin,
      v.id,
      (v as { status?: string }).status ?? null,
      "agreement_created",
      `Agreement created by admin covering ${data.startDate} → ${data.endDate}`,
      context.userId,
    );

    // ================= LINK METHOD =================
    if (data.signingMethod === "link") {
      const { sendSms } = await import("@/lib/ghl.server");
      const { data: lr } = await supabaseAdmin
        .from("legacy_rentals")
        .select("id, renter_name, start_datetime, retro_token")
        .eq("id", shellId)
        .maybeSingle();
      const token = (lr?.retro_token as string) || makeToken();
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const { error: upErr } = await supabaseAdmin
        .from("legacy_rentals")
        .update({
          retro_token: token,
          retro_token_expires_at: expires,
          retro_sent_at: nowIso,
          phone: data.phone,
        } as never)
        .eq("id", shellId);
      if (upErr) throw new Error(upErr.message);

      const link = `${appOrigin()}/sign-agreement-retro/${token}`;
      const name = (lr?.renter_name as string) || data.fullName || "there";
      const dateStr = new Date(data.startDate).toLocaleDateString("en-US");
      const sms =
        (data.customMessage && data.customMessage.trim()) ||
        `Hi ${name}, Camauto Rentals needs you to sign a rental agreement for your rental on ${dateStr}. This is required for compliance. Click to sign: ${link}`;
      await sendSms(data.phone, sms, name);

      await logViolationAudit(
        supabaseAdmin,
        v.id,
        "agreement_created",
        "sign_link_sent",
        `Sign link sent to customer at ${data.phone}`,
        context.userId,
      );

      return { ok: true as const, method: "link" as const, link };
    }

    // ================= ADMIN SIGN METHOD =================
    const sigJpeg = data.signatureDataUrl ? await signatureToJpeg(data.signatureDataUrl) : null;

    // Upload signature image (if drawn)
    let signatureUrl: string | null = null;
    if (sigJpeg) {
      const sPath = `retro/${shellId}/signature-${Date.now()}.jpg`;
      const { error: sErr } = await supabaseAdmin.storage
        .from("legacy-agreements")
        .upload(sPath, sigJpeg, { contentType: "image/jpeg", upsert: true });
      if (!sErr) {
        const { data: signed } = await supabaseAdmin.storage
          .from("legacy-agreements")
          .createSignedUrl(sPath, 60 * 60 * 24 * 365 * 5);
        signatureUrl = signed?.signedUrl ?? null;
      }
    }

    // Build a STANDARD customer-style agreement PDF (no admin markings).
    const [makeGuess, ...modelGuess] = String(vehicleText || "").split(/\s+/);
    const pdfData: RentalAgreementPDFData = {
      rental: {
        id: String(v.id),
        startDate: data.startDate,
        endDate: data.endDate,
        billingCadence: null,
        billingPeriod: null,
        rateAmount: null,
        rate: 0,
        weeklyRate: 0,
        depositPaid: 0,
        signedBy: data.fullName,
        signedAt: nowIso,
        clientSignedAt: nowIso,
        agreementVersion: DEFAULT_SETTINGS.agreementVersion,
      },
      driver: {
        fullName: data.fullName,
        firstName: null,
        lastName: null,
        middleInitial: null,
        dateOfBirth: data.dateOfBirth || null,
        licenseNumber: data.licenseNumber || "",
        licenseExpiry: null,
        dlState: data.dlState || (d.dl_state as string) || null,
        phone: data.phone || "",
        email: data.email || (d.email as string) || "",
        streetAddress: null,
        aptUnit: null,
        city: null,
        state: null,
        zipCode: null,
        address: data.address || null,
        altContactName: null,
        altContactPhone: null,
      },
      vehicle: {
        year: ve.year ? String(ve.year) : "",
        make: (ve.make as string) || makeGuess || "",
        model: (ve.model as string) || modelGuess.join(" "),
        color: (ve.color as string) ?? null,
        plate: plate || "",
        vin: (ve.vin as string) || "",
        mileage: 0,
        fuelLevelPickup: null,
        ezPassTag: null,
      },
      extensions: [],
      settings: DEFAULT_SETTINGS,
      signaturePng: sigJpeg,
    };
    const bytes = await renderRentalAgreementPdf(pdfData);
    const pdfPath = `retro/${shellId}/agreement-${Date.now()}.pdf`;
    const { error: pErr } = await supabaseAdmin.storage
      .from("legacy-agreements")
      .upload(pdfPath, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (pErr) throw new Error(pErr.message);
    const { data: signedPdf } = await supabaseAdmin.storage
      .from("legacy-agreements")
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 365 * 5);
    const agreementUrl = signedPdf?.signedUrl ?? null;

    const ip =
      getRequestHeader("cf-connecting-ip") ||
      (getRequestHeader("x-forwarded-for") || "").split(",")[0].trim() ||
      null;

    // Persist signed state on the shell.
    await supabaseAdmin
      .from("legacy_rentals")
      .update({
        retro_signed_at: nowIso,
        retro_signed_ip: ip,
        retro_signature_url: signatureUrl,
        agreement_pdf_url: agreementUrl,
        retro_token: null,
        retro_token_expires_at: null,
      } as never)
      .eq("id", shellId);

    // Fill the live driver/rental in place when this targets live records.
    if (t.driver?.id) {
      const driverPatch: Record<string, unknown> = {
        full_name: data.fullName,
        address: data.address,
        license_number: data.licenseNumber,
        date_of_birth: data.dateOfBirth,
        phone: data.phone,
      };
      if (data.dlState) driverPatch.dl_state = data.dlState;
      if (data.email) driverPatch.email = data.email;
      await supabaseAdmin.from("drivers").update(driverPatch as never).eq("id", t.driver.id);
    }
    if (t.rental?.id) {
      await supabaseAdmin
        .from("rentals")
        .update({
          agreement_pdf_url: agreementUrl,
          agreement_pdf_generated_at: nowIso,
          client_signed_at: nowIso,
          signed_by: data.fullName || null,
        } as never)
        .eq("id", t.rental.id);
    }

    // INTERNAL audit only — records who signed on the customer's behalf.
    // This never appears on the rental agreement PDF.
    await logViolationAudit(
      supabaseAdmin,
      v.id,
      "agreement_created",
      "admin_signed",
      sigJpeg
        ? "Admin captured customer's signature in person"
        : `Admin signed on behalf with customer's typed name (${data.fullName})`,
      context.userId,
    );

    return { ok: true as const, method: "admin" as const, agreementUrl };
  });
