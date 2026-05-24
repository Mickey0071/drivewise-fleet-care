import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";

/**
 * Marks a signed rental agreement as needing resubmission by the renter.
 * Clears the signature + ID + selfie so the renter must re-do the signing
 * flow using their existing sign_token. Sends an SMS + email explaining why.
 */
export const requestAgreementResubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rentalId: string; reason: string }) => {
    if (!input.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    if (!input.reason || typeof input.reason !== "string") throw new Error("reason required");
    if (input.reason.length > 500) throw new Error("reason too long (max 500 chars)");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, sign_token")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error("Rental not found");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, phone, email")
      .eq("id", rental.driver_id)
      .maybeSingle();

    // Clear signing artifacts so the renter must redo identity + signature.
    await supabaseAdmin
      .from("rentals")
      .update({
        staff_review_status: "resubmit_requested",
        client_signature_url: null,
        client_signed_at: null,
        signature_data_url: null,
        license_image_url: null,
        selfie_image_url: null,
      })
      .eq("id", data.rentalId);

    const origin = process.env.PUBLIC_APP_ORIGIN || "";
    const link = rental.sign_token && origin ? `${origin}/sign/${rental.sign_token}` : null;

    if (driver?.phone) {
      const sms = `Camauto Rentals: We need you to redo your rental agreement. Reason: ${data.reason}${link ? ` — ${link}` : ""}`;
      await notifyRenter({
        phone: driver.phone,
        email: driver.email ?? null,
        name: driver.full_name ?? null,
        sms,
        emailSubject: "Please Resubmit Your Rental Agreement — Camauto Rentals",
        emailHeading: "Action Required: Resubmit Your Agreement",
        emailIntro:
          `Our team reviewed your submission and we need a few things corrected before we can proceed.<br/><br/><strong>Reason:</strong> ${data.reason}`,
        ...(link
          ? { emailCta: { label: "Open Signing Page", url: link } }
          : {}),
        emailFootnote: "Reply to this email or text us if you have any questions.",
      });
    }

    return { ok: true };
  });

/**
 * Flags a signed rental agreement for manual owner review. Keeps signature
 * + identity artifacts intact, but moves it out of the auto-popup queue.
 */
export const holdAgreementForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rentalId: string; note?: string }) => {
    if (!input.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    if (input.note && input.note.length > 500) throw new Error("note too long (max 500 chars)");
    return input;
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("rentals")
      .update({ staff_review_status: "hold" })
      .eq("id", data.rentalId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });