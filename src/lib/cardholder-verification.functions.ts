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

/** Admin: list all rentals flagged with a card name mismatch. */
export const listCardholderReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: rentals } = await supabaseAdmin
      .from("rentals")
      .select(
        "id, driver_id, cardholder_name, cardholder_phone, cardholder_relationship, cardholder_license_url, cardholder_verified_at, verification_status, name_match_score, final_charge_amount, weekly_rate, rate, updated_at",
      )
      .eq("name_mismatch_flag", true)
      .order("updated_at", { ascending: false })
      .limit(200);
    const driverIds = Array.from(
      new Set((rentals ?? []).map((r: any) => r.driver_id).filter(Boolean)),
    );
    let driverMap: Record<string, string> = {};
    if (driverIds.length) {
      const { data: drivers } = await supabaseAdmin
        .from("drivers")
        .select("id, full_name")
        .in("id", driverIds);
      driverMap = Object.fromEntries((drivers ?? []).map((d: any) => [d.id, d.full_name]));
    }
    const items = (rentals ?? []).map((r: any) => ({
      id: r.id,
      renter_name: driverMap[r.driver_id] ?? r.driver_id ?? "—",
      cardholder_name: r.cardholder_name ?? "—",
      cardholder_phone: r.cardholder_phone ?? null,
      cardholder_relationship: r.cardholder_relationship ?? null,
      cardholder_license_url: r.cardholder_license_url ?? null,
      cardholder_verified_at: r.cardholder_verified_at ?? null,
      verification_status: (r.verification_status as string) ?? "pending",
      score: r.name_match_score ?? 0,
      amount:
        Number(r.final_charge_amount) || Number(r.weekly_rate) || Number(r.rate) || 0,
      updated_at: r.updated_at,
    }));
    return { items };
  });

/** Admin: mark a flagged rental as reviewed (verified) or refund it. */
export const resolveCardholderReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; action: "reviewed" | "refund" }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    if (d?.action !== "reviewed" && d?.action !== "refund") throw new Error("Invalid action");
    return { rentalId: d.rentalId.slice(0, 64), action: d.action };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, stripe_customer_id, final_charge_amount, weekly_rate, rate")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");

    if (data.action === "reviewed") {
      await supabaseAdmin
        .from("rentals")
        .update({ verification_status: "verified", updated_at: new Date().toISOString() })
        .eq("id", data.rentalId);
      return { ok: true, status: "verified" as const };
    }

    // Manual refund.
    if (!rental.stripe_customer_id) throw new Error("No card on file — cannot refund.");
    const amount =
      Number(rental.final_charge_amount) || Number(rental.weekly_rate) || Number(rental.rate) || 0;
    if (amount <= 0) throw new Error("Could not determine refund amount.");
    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);
    const amountCents = Math.round(amount * 100);
    const list = await stripe.paymentIntents.list({
      customer: rental.stripe_customer_id,
      limit: 25,
    });
    const candidate = list.data.find((pi) => {
      if (pi.status !== "succeeded") return false;
      const refundable = (pi.amount_received ?? pi.amount) - ((pi as any).amount_refunded ?? 0);
      return refundable >= amountCents;
    });
    if (!candidate) throw new Error("No matching succeeded payment found to refund in Stripe.");
    await stripe.refunds.create({ payment_intent: candidate.id, amount: amountCents });
    await supabaseAdmin
      .from("rentals")
      .update({ verification_status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", data.rentalId);
    return { ok: true, status: "refunded" as const };
  });