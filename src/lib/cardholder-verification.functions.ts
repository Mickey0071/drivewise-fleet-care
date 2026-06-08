import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient } from "@/lib/stripe.server";

const ADMIN_ALERT_PHONE = "267-221-3977";

const RELATIONSHIPS = ["Parent", "Spouse", "Friend", "Employer", "Self", "Other"] as const;

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Only admins can manage cardholder verifications");
}

function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : "bin";
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB");
  return { buffer, contentType, ext };
}

async function uploadCardholderLicense(rentalId: string, dataUrl: string): Promise<string> {
  const { buffer, contentType, ext } = dataUrlToBuffer(dataUrl);
  const path = `${rentalId}/cardholder-license-${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("rental-signing")
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data, error: signErr } = await supabaseAdmin.storage
    .from("rental-signing")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !data?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message ?? "unknown"}`);
  return data.signedUrl;
}

async function renterNameFor(rental: any): Promise<string> {
  if (rental?.driver_id) {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("full_name, first_name, last_name")
      .eq("id", rental.driver_id)
      .maybeSingle();
    return (
      (drv?.full_name as string) ||
      [drv?.first_name, drv?.last_name].filter(Boolean).join(" ") ||
      ""
    );
  }
  return "";
}

/**
 * Public: tells the post-payment return page whether the cardholder needs to
 * complete verification because the card name did not match the renter.
 */
export const getCardholderVerificationState = createServerFn({ method: "GET" })
  .inputValidator((input: { rentalId: string }) => {
    if (!input?.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    return { rentalId: input.rentalId.slice(0, 64) };
  })
  .handler(async ({ data }) => {
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select(
        "id, driver_id, cardholder_name, name_mismatch_flag, verification_status, cardholder_verified_at",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) return { needed: false, cardholderName: "", renterName: "", status: null };
    const renterName = await renterNameFor(rental);
    const status = (rental.verification_status as string | null) ?? null;
    const needed =
      rental.name_mismatch_flag === true &&
      (status === "pending" || status === null);
    return {
      needed,
      cardholderName: (rental.cardholder_name as string) || "",
      renterName,
      status,
    };
  });

/**
 * Public: the cardholder submits their verification (info + license image).
 * Payment is never affected by this; it only records verification data.
 */
export const submitCardholderVerification = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      rentalId: string;
      phone: string;
      relationship: string;
      licenseDataUrl: string;
      ackCardholder: boolean;
      ackAuthorize: boolean;
      ackSaved: boolean;
    }) =>
      z
        .object({
          rentalId: z.string().min(1).max(64),
          phone: z.string().trim().min(7).max(32),
          relationship: z.enum(RELATIONSHIPS),
          licenseDataUrl: z.string().startsWith("data:image/"),
          ackCardholder: z.literal(true),
          ackAuthorize: z.literal(true),
          ackSaved: z.literal(true),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, cardholder_name, name_mismatch_flag")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");

    const licenseUrl = await uploadCardholderLicense(data.rentalId, data.licenseDataUrl);
    await supabaseAdmin
      .from("rentals")
      .update({
        cardholder_phone: data.phone,
        cardholder_relationship: data.relationship,
        cardholder_license_url: licenseUrl,
        cardholder_verified_at: new Date().toISOString(),
        verification_status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.rentalId);

    const renterName = await renterNameFor(rental);
    const msg =
      `PAYMENT NAME MISMATCH\n\n` +
      `Renter: ${renterName || "—"}\n` +
      `Cardholder: ${(rental.cardholder_name as string) || "—"}\n` +
      `Rental: ${data.rentalId}\n` +
      `Verification: submitted\n\n` +
      `Payment processed. Review fraud risk.`;
    try {
      await sendSms(ADMIN_ALERT_PHONE, msg, "Admin");
    } catch (e) {
      console.error("[cardholder-verify] admin SMS failed", e);
    }
    return { ok: true };
  });

/**
 * Public: the cardholder declined / skipped verification. Payment is still
 * kept; the admin gets a stronger HIGH RISK alert.
 */
export const refuseCardholderVerification = createServerFn({ method: "POST" })
  .inputValidator((input: { rentalId: string }) => {
    if (!input?.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    return { rentalId: input.rentalId.slice(0, 64) };
  })
  .handler(async ({ data }) => {
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, cardholder_name, name_mismatch_flag, verification_status")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) return { ok: false };
    if (rental.verification_status === "submitted" || rental.verification_status === "verified") {
      return { ok: true };
    }
    await supabaseAdmin
      .from("rentals")
      .update({ verification_status: "refused", updated_at: new Date().toISOString() })
      .eq("id", data.rentalId);

    const renterName = await renterNameFor(rental);
    const msg =
      `🚨 HIGH RISK: Cardholder refused verification\n\n` +
      `Renter: ${renterName || "—"}\n` +
      `Cardholder: ${(rental.cardholder_name as string) || "—"}\n` +
      `Rental: ${data.rentalId}\n` +
      `Verification: refused\n\n` +
      `Payment processed. Review fraud risk.`;
    try {
      await sendSms(ADMIN_ALERT_PHONE, msg, "Admin");
    } catch (e) {
      console.error("[cardholder-verify] admin refuse SMS failed", e);
    }
    return { ok: true };
  });