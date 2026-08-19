import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inline edit of the rental period behind a violation. Writes to the live
 * rental when the violation is matched to one, otherwise to the legacy /
 * retro shell. Agreement PDFs and dispute packets are rebuilt from these
 * dates, so fixing them here fixes the packet.
 */
export const updateRentalPeriodForViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; startDate: string; endDate: string }) => {
    if (!input?.violationId) throw new Error("violationId required");
    const startDate = (input.startDate || "").slice(0, 10);
    const endDate = (input.endDate || "").slice(0, 10);
    if (!DATE_RE.test(startDate)) throw new Error("Start date required (YYYY-MM-DD)");
    if (!DATE_RE.test(endDate)) throw new Error("End date required (YYYY-MM-DD)");
    if (endDate < startDate) throw new Error("End date cannot be before the start date");
    return { violationId: input.violationId, startDate, endDate };
  })
  .handler(async ({ data }) => {
    const { data: v, error } = await (supabaseAdmin as any)
      .from("violations")
      .select("id, rental_id, legacy_rental_id, retro_legacy_rental_id, date_issued")
      .eq("id", data.violationId)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");

    const violationDate = String(v.date_issued || "").slice(0, 10);
    if (DATE_RE.test(violationDate)) {
      if (data.startDate > violationDate || data.endDate < violationDate) {
        throw new Error(`Rental period must cover the violation date (${violationDate})`);
      }
    }

    let updated = false;
    if (v.rental_id) {
      const { error: rErr } = await (supabaseAdmin as any)
        .from("rentals")
        .update({
          start_date: data.startDate,
          end_date: data.endDate,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", v.rental_id);
      if (rErr) throw new Error(rErr.message);
      updated = true;
    }
    const legacyId = v.retro_legacy_rental_id || v.legacy_rental_id;
    if (legacyId) {
      const { error: lErr } = await (supabaseAdmin as any)
        .from("legacy_rentals")
        .update({
          start_datetime: `${data.startDate}T00:00:00Z`,
          end_datetime: `${data.endDate}T23:59:59Z`,
        } as never)
        .eq("id", legacyId);
      if (lErr) throw new Error(lErr.message);
      updated = true;
    }
    if (!updated) throw new Error("This violation is not matched to a rental yet");

    // Verify: read the dates back from the row that owns them.
    let savedStart: string | null = null;
    let savedEnd: string | null = null;
    if (v.rental_id) {
      const { data: check } = await (supabaseAdmin as any)
        .from("rentals")
        .select("start_date, end_date")
        .eq("id", v.rental_id)
        .maybeSingle();
      savedStart = check?.start_date ? String(check.start_date).slice(0, 10) : null;
      savedEnd = check?.end_date ? String(check.end_date).slice(0, 10) : null;
    } else if (legacyId) {
      const { data: check } = await (supabaseAdmin as any)
        .from("legacy_rentals")
        .select("start_datetime, end_datetime")
        .eq("id", legacyId)
        .maybeSingle();
      savedStart = check?.start_datetime ? String(check.start_datetime).slice(0, 10) : null;
      savedEnd = check?.end_datetime ? String(check.end_datetime).slice(0, 10) : null;
    }
    if (savedStart !== data.startDate || savedEnd !== data.endDate) {
      throw new Error("Could not save dates — the database did not confirm the update");
    }
    return { ok: true as const, startDate: savedStart, endDate: savedEnd };
  });

/**
 * Upload a scanned/signed agreement for the rental behind a violation. Stores
 * the file and points the rental (or legacy shell) at it so the dispute packet
 * picks it up as the signed agreement.
 */
export const uploadSignedAgreementForViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; dataUrl: string }) => {
    if (!input?.violationId) throw new Error("violationId required");
    if (!input?.dataUrl || !/^data:[^;]+;base64,/.test(input.dataUrl)) {
      throw new Error("A PDF or image file is required");
    }
    return { violationId: input.violationId, dataUrl: input.dataUrl };
  })
  .handler(async ({ data }) => {
    const { data: v, error } = await (supabaseAdmin as any)
      .from("violations")
      .select("id, rental_id, legacy_rental_id, retro_legacy_rental_id")
      .eq("id", data.violationId)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");
    const legacyId = v.retro_legacy_rental_id || v.legacy_rental_id;
    if (!v.rental_id && !legacyId) {
      throw new Error("This violation is not matched to a rental yet");
    }

    const m = /^data:([^;]+);base64,(.+)$/.exec(data.dataUrl);
    if (!m) throw new Error("Invalid file");
    const contentType = m[1];
    const buffer = Buffer.from(m[2], "base64");
    const ext = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("png")
        ? "png"
        : "jpg";
    const path = `signed-agreements/${data.violationId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await supabaseAdmin.storage
      .from("violation-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    const url = signed?.signedUrl;
    if (!url) throw new Error("Could not create document URL");

    const nowIso = new Date().toISOString();
    if (v.rental_id) {
      const { error: rErr } = await (supabaseAdmin as any)
        .from("rentals")
        .update({
          agreement_pdf_url: url,
          client_signed_at: nowIso,
          updated_at: nowIso,
        } as never)
        .eq("id", v.rental_id);
      if (rErr) throw new Error(rErr.message);
    }
    if (legacyId) {
      const { error: lErr } = await (supabaseAdmin as any)
        .from("legacy_rentals")
        .update({ agreement_pdf_url: url, retro_signed_at: nowIso } as never)
        .eq("id", legacyId);
      if (lErr) throw new Error(lErr.message);
    }
    return { ok: true as const, url };
  });

/**
 * Bulk-fill renter info across several selected violations at once. Writes to
 * each violation's driver record (permanent, so every other violation for the
 * same renter picks it up) and to legacy shells where applicable.
 */
export const bulkUpdateRenterInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    violationIds: string[];
    address?: string | null;
    licenseNumber?: string | null;
    dlState?: string | null;
    phone?: string | null;
  }) => {
    const ids = Array.from(new Set((input?.violationIds ?? []).filter(Boolean))).slice(0, 200);
    if (ids.length === 0) throw new Error("Select at least one violation");
    const clean = (s: string | null | undefined) =>
      s == null ? undefined : String(s).trim().slice(0, 400) || undefined;
    const patch = {
      address: clean(input.address),
      licenseNumber: clean(input.licenseNumber),
      dlState: clean(input.dlState)?.toUpperCase(),
      phone: clean(input.phone),
    };
    if (!patch.address && !patch.licenseNumber && !patch.dlState && !patch.phone) {
      throw new Error("Enter at least one value to apply");
    }
    return { violationIds: ids, ...patch };
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("violations")
      .select("id, driver_id, legacy_rental_id, retro_legacy_rental_id")
      .in("id", data.violationIds);
    if (error) throw new Error(error.message);

    const driverIds = new Set<string>();
    const legacyIds = new Set<string>();
    for (const r of rows ?? []) {
      if (r.driver_id) driverIds.add(r.driver_id as string);
      const l = r.retro_legacy_rental_id || r.legacy_rental_id;
      if (l) legacyIds.add(l as string);
    }

    const nowIso = new Date().toISOString();
    if (driverIds.size) {
      const patch: Record<string, unknown> = { updated_at: nowIso };
      if (data.address) {
        patch.address = data.address;
        patch.street_address = data.address;
      }
      if (data.licenseNumber) patch.license_number = data.licenseNumber;
      if (data.dlState) patch.dl_state = data.dlState;
      if (data.phone) patch.phone = data.phone;
      const { error: dErr } = await (supabaseAdmin as any)
        .from("drivers")
        .update(patch as never)
        .in("id", Array.from(driverIds));
      if (dErr) throw new Error(dErr.message);
    }
    if (legacyIds.size) {
      const patch: Record<string, unknown> = {};
      if (data.address) patch.address = data.address;
      if (data.licenseNumber) patch.dl_number = data.licenseNumber;
      if (data.dlState) patch.dl_state = data.dlState;
      if (data.phone) patch.phone = data.phone;
      if (Object.keys(patch).length) {
        const { error: lErr } = await (supabaseAdmin as any)
          .from("legacy_rentals")
          .update(patch as never)
          .in("id", Array.from(legacyIds));
        if (lErr) throw new Error(lErr.message);
      }
    }
    return {
      ok: true as const,
      violations: data.violationIds.length,
      drivers: driverIds.size,
      legacy: legacyIds.size,
    };
  });
