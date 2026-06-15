import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";

const STAGES = ["uploaded", "matched", "disputed", "completed"] as const;
type Stage = (typeof STAGES)[number];

async function changedByName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name || data?.email || null;
}

async function logAudit(opts: {
  violationId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  userId: string | null;
}) {
  await supabaseAdmin.from("violation_status_history").insert({
    violation_id: opts.violationId,
    from_status: opts.fromStatus ?? null,
    to_status: opts.toStatus,
    reason: opts.reason ?? null,
    changed_by: opts.userId ?? null,
    changed_by_name: await changedByName(opts.userId),
  } as never);
}

/**
 * Link a violation to a rental (live or migrated/legacy). Resolves the driver
 * and vehicle from the chosen rental and records an internal audit entry.
 */
export const matchViolationToRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; rentalId: string }) => {
    if (!input.violationId) throw new Error("violationId required");
    if (!input.rentalId) throw new Error("rentalId required");
    return { violationId: input.violationId, rentalId: input.rentalId };
  })
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {
      is_orphan: false,
      updated_at: new Date().toISOString(),
    };
    let label = "";
    if (data.rentalId.startsWith("LEGACY:")) {
      const legacyId = data.rentalId.slice("LEGACY:".length);
      const { data: lr } = await supabaseAdmin
        .from("legacy_rentals")
        .select("id, renter_name, promoted_rental_id, promoted_driver_id")
        .eq("id", legacyId)
        .maybeSingle();
      patch.legacy_rental_id = legacyId;
      label = (lr as any)?.renter_name ?? "migrated reservation";
      if ((lr as any)?.promoted_driver_id) patch.driver_id = (lr as any).promoted_driver_id;
      if ((lr as any)?.promoted_rental_id) {
        patch.rental_id = (lr as any).promoted_rental_id;
        const { data: rr } = await supabaseAdmin
          .from("rentals")
          .select("vehicle_id")
          .eq("id", (lr as any).promoted_rental_id)
          .maybeSingle();
        if (rr?.vehicle_id) patch.vehicle_id = rr.vehicle_id;
      }
    } else {
      const { data: r } = await supabaseAdmin
        .from("rentals")
        .select("id, driver_id, vehicle_id")
        .eq("id", data.rentalId)
        .maybeSingle();
      if (!r) throw new Error("Rental not found");
      patch.rental_id = r.id;
      patch.driver_id = r.driver_id ?? null;
      if (r.vehicle_id) patch.vehicle_id = r.vehicle_id;
      let name: string | null = null;
      if (r.driver_id) {
        const { data: d } = await supabaseAdmin
          .from("drivers")
          .select("full_name")
          .eq("id", r.driver_id)
          .maybeSingle();
        name = d?.full_name ?? null;
      }
      label = name ?? r.id;
    }

    const { error } = await supabaseAdmin
      .from("violations")
      .update(patch as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);

    await logAudit({
      violationId: data.violationId,
      toStatus: "matched_to_rental",
      reason: `Matched to ${label} (${data.rentalId})`,
      userId: context.userId ?? null,
    });
    return { ok: true as const };
  });

/** Manually move a violation between dashboard tabs. */
export const setViolationStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; stage: Stage }) => {
    if (!input.violationId) throw new Error("violationId required");
    if (!STAGES.includes(input.stage)) throw new Error("Invalid stage");
    return { violationId: input.violationId, stage: input.stage };
  })
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("violations")
      .update({ workflow_stage: data.stage, updated_at: new Date().toISOString() } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);
    await logAudit({
      violationId: data.violationId,
      toStatus: `stage:${data.stage}`,
      reason: `Moved to ${data.stage}`,
      userId: context.userId ?? null,
    });
    return { ok: true as const };
  });

/** Flag a violation as an orphan dispute ("Plate Not Mine"). */
export const flagViolationOrphan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; flag?: boolean }) => {
    if (!input.violationId) throw new Error("violationId required");
    return { violationId: input.violationId, flag: input.flag !== false };
  })
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("violations")
      .update({ is_orphan: data.flag, updated_at: new Date().toISOString() } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);
    await logAudit({
      violationId: data.violationId,
      toStatus: data.flag ? "flagged_orphan" : "unflagged_orphan",
      reason: data.flag ? "Plate not mine — flagged as orphan dispute" : "Orphan flag removed",
      userId: context.userId ?? null,
    });
    return { ok: true as const };
  });

/**
 * Resolve a downloadable signed-rental-agreement PDF URL for a violation.
 * Order of resolution:
 *  1. Live rental's `agreement_pdf_url` (generate on the fly if the rental is
 *     signed but has no PDF yet).
 *  2. Legacy / retro shell's `agreement_pdf_url`.
 * Returns `{ url, exists }`. `exists` is false when there is no agreement at
 * all — the UI should then open the Create Agreement form.
 */
export const getViolationAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string }) => {
    if (!input.violationId) throw new Error("violationId required");
    return { violationId: input.violationId };
  })
  .handler(async ({ data }): Promise<{ url: string | null; exists: boolean }> => {
    const { data: v } = await supabaseAdmin
      .from("violations")
      .select("id, rental_id, legacy_rental_id, retro_legacy_rental_id")
      .eq("id", data.violationId)
      .maybeSingle();
    if (!v) throw new Error("Violation not found");

    // 1) Live rental
    if (v.rental_id) {
      const { data: r } = await supabaseAdmin
        .from("rentals")
        .select("id, agreement_pdf_url, client_signed_at")
        .eq("id", v.rental_id)
        .maybeSingle();
      if (r?.agreement_pdf_url) return { url: r.agreement_pdf_url, exists: true };
      // Signed but no PDF yet → generate it now.
      if (r?.client_signed_at) {
        const res = await generateAgreementPdf({ data: { rentalId: r.id } });
        if (res.url) return { url: res.url, exists: true };
      }
    }

    // 2) Legacy / retro shell
    const legacyId = (v as any).retro_legacy_rental_id || v.legacy_rental_id;
    if (legacyId) {
      const { data: lr } = await supabaseAdmin
        .from("legacy_rentals")
        .select("agreement_pdf_url, retro_signed_at")
        .eq("id", legacyId)
        .maybeSingle();
      if (lr?.agreement_pdf_url) return { url: lr.agreement_pdf_url, exists: true };
    }

    return { url: null, exists: false };
  });

/** Record how a matched violation was disputed and move it to the Disputed tab. */
export const recordViolationDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; method: "online" | "walk_in" | "mail" }) => {
    if (!input.violationId) throw new Error("violationId required");
    if (!["online", "walk_in", "mail"].includes(input.method)) throw new Error("Invalid method");
    return { violationId: input.violationId, method: input.method };
  })
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("violations")
      .update({
        dispute_method: data.method,
        disputed_at: now,
        workflow_stage: "disputed",
        updated_at: now,
      } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);
    await logAudit({
      violationId: data.violationId,
      toStatus: `disputed:${data.method}`,
      reason: `Dispute submitted via ${data.method.replace("_", "-")}`,
      userId: context.userId ?? null,
    });
    return { ok: true as const };
  });

/**
 * Attach (or replace) the original violation document (PDF or image) for an
 * existing violation. Accepts a data URL, stores it in the `violation-photos`
 * bucket, saves a long-lived signed URL onto `violations.photo_url`, and
 * returns the URL so the UI can open it immediately.
 */
export const attachViolationDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { violationId: string; dataUrl: string }) => {
    if (!input.violationId) throw new Error("violationId required");
    if (!input.dataUrl || !/^data:[^;]+;base64,/.test(input.dataUrl)) {
      throw new Error("A PDF or image file is required");
    }
    return { violationId: input.violationId, dataUrl: input.dataUrl };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data.dataUrl);
    if (!m) throw new Error("Invalid file");
    const contentType = m[1];
    const buffer = Buffer.from(m[2], "base64");
    const ext = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("png")
        ? "png"
        : "jpg";
    const path = `originals/${data.violationId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await supabaseAdmin.storage
      .from("violation-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    const url = signed?.signedUrl;
    if (!url) throw new Error("Could not create document URL");

    const { error } = await supabaseAdmin
      .from("violations")
      .update({ photo_url: url, updated_at: new Date().toISOString() } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);

    await logAudit({
      violationId: data.violationId,
      toStatus: "original_document_attached",
      reason: "Original violation document attached",
      userId: context.userId ?? null,
    });
    return { url };
  });