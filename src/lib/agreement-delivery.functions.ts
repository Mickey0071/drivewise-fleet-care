import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms, sendEmail } from "@/lib/ghl.server";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";

/**
 * Generate the rental agreement PDF (pre-filled, unsigned is fine) and
 * deliver it to the renter via SMS + Email. Fire-and-forget from the UI
 * after a reservation is created.
 *
 * Returns `{ ok, pdfUrl, smsSent, emailSent, errors }` — never throws.
 */
export const sendAgreementToCustomer = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        rentalId: z.string().min(1).max(64),
        origin: z.string().url().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const errors: string[] = [];
    let pdfUrl: string | null = null;
    let smsSent = false;
    let emailSent = false;

    // 1) Generate (or regenerate) the PDF
    const pdfRes = await generateAgreementPdf({ data: { rentalId: data.rentalId } });
    if (!pdfRes?.url) {
      return {
        ok: false,
        pdfUrl: null,
        smsSent: false,
        emailSent: false,
        errors: [`PDF generation failed: ${pdfRes?.error ?? "unknown"}`],
      };
    }
    pdfUrl = pdfRes.url;

    // 2) Load rental + driver + vehicle for messaging context
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, sign_token, start_date")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) {
      return { ok: false, pdfUrl, smsSent, emailSent, errors: ["rental not found"] };
    }
    const [{ data: driver }, { data: vehicle }] = await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select("full_name, phone, email")
        .eq("id", rental.driver_id)
        .maybeSingle(),
      supabaseAdmin
        .from("vehicles")
        .select("year, make, model")
        .eq("id", rental.vehicle_id)
        .maybeSingle(),
    ]);

    if (!driver) {
      return { ok: false, pdfUrl, smsSent, emailSent, errors: ["driver not found"] };
    }

    const vehLabel = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "your vehicle";
    const signLink =
      data.origin && rental.sign_token ? `${data.origin}/sign/${rental.sign_token}` : null;

    // 3) SMS — link to the PDF (and sign link if available)
    if (driver.phone) {
      // Single link — the sign page shows the agreement, collects ID +
      // selfie, and captures the signature in one flow.
      const smsBody = signLink
        ? [
            `Camauto Rentals — complete your reservation for ${vehLabel}.`,
            `Review & sign here: ${signLink}`,
          ].join("\n")
        : [
            `Camauto Rentals — your Rental Agreement for ${vehLabel} is ready.`,
            `View / download: ${pdfUrl}`,
          ].join("\n");
      try {
        await sendSms(driver.phone, smsBody, driver.full_name);
        smsSent = true;
      } catch (e) {
        errors.push(`SMS failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      errors.push("no phone on file");
    }

    // 4) Email — attach PDF link
    const validEmail =
      driver.email && driver.email.includes("@") && !driver.email.endsWith("@camauto.local");
    if (validEmail) {
      const subject = "Your Camauto Rentals Vehicle Rental Agreement";
      const primaryUrl = signLink ?? pdfUrl;
      const primaryLabel = signLink ? "Review & Sign Agreement" : "View / Download Agreement (PDF)";
      const html = `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
          <h2 style="margin: 0 0 12px;">Complete your reservation</h2>
          <p>Hi ${driver.full_name ?? "there"},</p>
          <p>Your Vehicle Rental Agreement for <strong>${vehLabel}</strong> is ready.
          Tap the button below to review the agreement, upload your driver's license
          and selfie, and sign — all in one place.</p>
          <p style="margin: 24px 0;">
            <a href="${primaryUrl}"
               style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;
                      text-decoration:none;font-weight:600;">
              ${primaryLabel}
            </a>
          </p>
          <p style="color:#666;font-size:12px;margin-top:32px;">
            Camauto Rentals — Reservation #${rental.id}
          </p>
        </div>
      `;
      try {
        await sendEmail(driver.email!, subject, html, {
          name: driver.full_name,
          phone: driver.phone,
          attachments: signLink ? [] : [pdfUrl],
        });
        emailSent = true;
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      errors.push("no email on file");
    }

    return {
      ok: smsSent || emailSent,
      pdfUrl,
      smsSent,
      emailSent,
      errors,
    };
  });