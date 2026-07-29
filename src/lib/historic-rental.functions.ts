import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { toE164 } from "@/lib/phone";

/** Random compact suffix used inside new rental / driver / payment IDs. */
function shortId(len = 10): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  ).slice(0, len).toUpperCase();
}

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid file upload");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  let ext = "bin";
  if (contentType.includes("pdf")) ext = "pdf";
  else if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
  else if (contentType.includes("webp")) ext = "webp";
  if (buffer.byteLength > 15 * 1024 * 1024) throw new Error("File exceeds 15MB");
  return { buffer, contentType, ext };
}

const Input = z.object({
  // Customer
  fullName: z.string().trim().min(2, "Full name required").max(120),
  phone: z.string().trim().min(7, "Phone required").max(30),
  email: z.string().trim().max(200).optional().default(""),
  address: z.string().trim().min(3, "Address required").max(300),
  licenseNumber: z.string().trim().min(2, "License # required").max(60),
  dlState: z.string().trim().max(4).optional().default(""),
  dateOfBirth: z.string().trim().max(20).optional().default(""),
  // Vehicle
  vehicleId: z.string().trim().max(64).optional().default(""),
  plateOverride: z.string().trim().max(40).optional().default(""),
  // Rental
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date required"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date required"),
  rateType: z.enum(["daily", "weekly"]),
  rateAmount: z.number().nonnegative().default(0),
  totalAmount: z.number().nonnegative().default(0),
  // Payment
  amountPaid: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["cash", "card", "check", "other"]).default("cash"),
  paymentNotes: z.string().trim().max(500).optional().default(""),
  // Uploads (data URLs)
  licenseImageDataUrl: z.string().optional().default(""),
  agreementFileDataUrl: z.string().optional().default(""),
  noAgreementAvailable: z.boolean().optional().default(false),
  // Other
  notes: z.string().trim().max(1000).optional().default(""),
  violationId: z.string().trim().max(64).optional().default(""),
});

export type CreateHistoricRentalInput = z.infer<typeof Input>;

export interface CreateHistoricRentalResult {
  rentalId: string;
  driverId: string;
  linkedViolationId: string | null;
}

/**
 * Manual entry for a past ("historic") rental — Fleet Finesse era, cash
 * deals, informal rentals. Produces a real `rentals` row tagged
 * `source='historic_entry'` so it is searchable, links to violations, and
 * shows up in vehicle history alongside live/legacy rentals.
 */
export const createHistoricRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CreateHistoricRentalResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.endDate < data.startDate) throw new Error("End date is before the start date");
    if (!data.vehicleId && !data.plateOverride) throw new Error("Select a vehicle or enter a plate");

    // ---- 1. Driver dedupe (name + phone digits) ---------------------------
    const nameNorm = data.fullName.trim().toLowerCase();
    const phoneE164 = toE164(data.phone);
    const phoneDigits = digits(data.phone);

    let driverId: string | null = null;
    {
      const { data: matches } = await supabaseAdmin
        .from("drivers")
        .select("id, full_name, phone, email")
        .ilike("full_name", nameNorm)
        .limit(20);
      const hit = (matches ?? []).find((d) => digits(d.phone) === phoneDigits);
      if (hit) driverId = hit.id as string;
    }

    const nowIso = new Date().toISOString();
    if (!driverId) {
      driverId = `DR-${shortId(10)}`;
      const { error: insErr } = await supabaseAdmin.from("drivers").insert({
        id: driverId,
        full_name: data.fullName,
        email: data.email || `${digits(phoneE164) || shortId(6)}@historic.camauto.local`,
        phone: phoneE164 || data.phone,
        license_number: data.licenseNumber,
        license_expiry: "1970-01-01",
        dl_state: data.dlState || null,
        date_of_birth: data.dateOfBirth || null,
        address: data.address,
        import_source: "historic_entry",
        status: "active",
      } as never);
      if (insErr) throw new Error(`Driver create failed: ${insErr.message}`);
    } else {
      // Fill in any missing pieces on the existing driver without wiping data.
      const patch: Record<string, unknown> = {};
      if (data.address) patch.address = data.address;
      if (data.licenseNumber) patch.license_number = data.licenseNumber;
      if (data.dlState) patch.dl_state = data.dlState;
      if (data.dateOfBirth) patch.date_of_birth = data.dateOfBirth;
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("drivers").update(patch as never).eq("id", driverId);
      }
    }

    // ---- 2. License upload -----------------------------------------------
    if (data.licenseImageDataUrl) {
      try {
        const { buffer, contentType, ext } = dataUrlToBuffer(data.licenseImageDataUrl);
        const path = `${driverId}/license-${Date.now()}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("driver-licenses")
          .upload(path, buffer, { contentType, upsert: true });
        if (!upErr) {
          const { data: signed } = await supabaseAdmin.storage
            .from("driver-licenses")
            .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
          if (signed?.signedUrl) {
            await supabaseAdmin
              .from("drivers")
              .update({ license_image_url: signed.signedUrl } as never)
              .eq("id", driverId);
          }
        }
      } catch (e) {
        console.warn("[historic-rental] license upload failed", e);
      }
    }

    // ---- 3. Vehicle resolution -------------------------------------------
    let vehicleId = data.vehicleId;
    if (!vehicleId && data.plateOverride) {
      // Try to resolve plate against fleet; if not present, still record on the
      // rental via a synthetic vehicle placeholder so history queries work.
      const plateNorm = data.plateOverride.replace(/\s+/g, "").toUpperCase();
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("id, plate")
        .ilike("plate", plateNorm)
        .limit(1)
        .maybeSingle();
      if (v?.id) vehicleId = v.id as string;
    }
    if (!vehicleId) throw new Error("This plate isn't in the fleet — pick a vehicle instead");

    // ---- 4. Rental insert -------------------------------------------------
    const rentalId = `HR-${shortId(10)}`;
    const rateNum = Number.isFinite(data.rateAmount) ? data.rateAmount : 0;
    const totalNum = Number.isFinite(data.totalAmount) ? data.totalAmount : 0;
    const paidNum = Number.isFinite(data.amountPaid) ? data.amountPaid : 0;
    const paymentStatus =
      totalNum <= 0 ? "paid" : paidNum >= totalNum ? "paid" : paidNum > 0 ? "partial" : "unpaid";

    const notesCombined = [
      "Historic entry (manually recorded past rental)",
      data.paymentMethod ? `Payment method: ${data.paymentMethod}` : null,
      data.paymentNotes ? `Payment notes: ${data.paymentNotes}` : null,
      data.notes ? `Notes: ${data.notes}` : null,
      data.noAgreementAvailable ? "No paper agreement available for this period." : null,
    ]
      .filter(Boolean)
      .join("\n");

    const rentalRow: Record<string, unknown> = {
      id: rentalId,
      driver_id: driverId,
      vehicle_id: vehicleId,
      start_date: data.startDate,
      end_date: data.endDate,
      billing_period: data.rateType === "weekly" ? "weekly" : "daily",
      billing_cadence: data.rateType === "weekly" ? "weekly" : "daily",
      rate: data.rateType === "daily" ? rateNum : 0,
      weekly_rate: data.rateType === "weekly" ? rateNum : 0,
      rate_amount: rateNum,
      deposit_paid: 0,
      payment_received: paidNum > 0,
      payment_status: paymentStatus,
      reservation_status: "returned",
      returned_at: `${data.endDate}T00:00:00Z`,
      activated_at: `${data.startDate}T00:00:00Z`,
      notes: notesCombined,
      source: "historic_entry",
      import_source: "historic_entry",
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { error: rErr } = await supabaseAdmin.from("rentals").insert(rentalRow as never);
    if (rErr) throw new Error(`Rental create failed: ${rErr.message}`);

    // ---- 5. Agreement upload (optional) ----------------------------------
    if (data.agreementFileDataUrl && !data.noAgreementAvailable) {
      try {
        const { buffer, contentType, ext } = dataUrlToBuffer(data.agreementFileDataUrl);
        const path = `historic/${rentalId}/agreement-${Date.now()}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("legacy-agreements")
          .upload(path, buffer, { contentType, upsert: true });
        if (!upErr) {
          const { data: signed } = await supabaseAdmin.storage
            .from("legacy-agreements")
            .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
          if (signed?.signedUrl) {
            await supabaseAdmin
              .from("rentals")
              .update({
                agreement_pdf_url: signed.signedUrl,
                agreement_pdf_generated_at: nowIso,
                client_signed_at: `${data.startDate}T00:00:00Z`,
                signed_by: data.fullName,
                signed_at: `${data.startDate}T00:00:00Z`,
              } as never)
              .eq("id", rentalId);
          }
        }
      } catch (e) {
        console.warn("[historic-rental] agreement upload failed", e);
      }
    }

    // ---- 6. Payment row (so financials pick it up) -----------------------
    if (paidNum > 0) {
      const payId = `PY-${shortId(10)}`;
      const { error: pErr } = await supabaseAdmin.from("payments").insert({
        id: payId,
        rental_id: rentalId,
        driver_id: driverId,
        amount: paidNum,
        due_date: data.startDate,
        paid_date: data.startDate,
        status: "paid",
        kind: "rental",
        method: data.paymentMethod,
        note:
          [data.paymentNotes, "Historic entry"].filter(Boolean).join(" — ") || "Historic entry",
      } as never);
      if (pErr) console.warn("[historic-rental] payment insert failed", pErr.message);
    }

    // ---- 7. Optional violation auto-link ---------------------------------
    let linkedViolationId: string | null = null;
    if (data.violationId) {
      const { error: vErr } = await supabaseAdmin
        .from("violations")
        .update({
          rental_id: rentalId,
          driver_id: driverId,
          updated_at: nowIso,
        } as never)
        .eq("id", data.violationId);
      if (!vErr) {
        linkedViolationId = data.violationId;
        // Best-effort audit entry (schema mirrors existing history rows).
        try {
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("full_name")
            .eq("id", context.userId)
            .maybeSingle();
          await supabaseAdmin.from("violation_status_history").insert({
            violation_id: data.violationId,
            from_status: null,
            to_status: "matched",
            reason: `Linked to historic rental ${rentalId} for ${data.fullName}`,
            changed_by: context.userId,
            changed_by_name: (prof?.full_name as string) ?? null,
          } as never);
        } catch {
          /* audit best-effort */
        }
      } else {
        console.warn("[historic-rental] violation link failed", vErr.message);
      }
    }

    return { rentalId, driverId, linkedViolationId };
  });