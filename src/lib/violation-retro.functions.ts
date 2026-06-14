import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
          renter_name: (d.full_name as string) ?? (v.driver_name as string) ?? "Renter",
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
