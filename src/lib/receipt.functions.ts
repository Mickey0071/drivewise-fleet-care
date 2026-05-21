import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderReceiptPdf, type ReceiptPDFData } from "@/components/pdf/ReceiptPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";
import { sendSms, sendEmail } from "@/lib/ghl.server";

/**
 * Generate a payment-receipt PDF for an active rental, upload to the
 * `rental-signing` bucket, and persist a signed URL on the rental row.
 *
 * Never throws — returns `{ url, generatedAt, error }`.
 */
export const generateReceiptPdf = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        rentalId: z.string().min(1).max(64),
        paymentAmountCents: z.number().int().nonnegative().optional(),
        paymentMethod: z.string().min(1).max(40).optional(),
        paymentReference: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ url: string | null; generatedAt: string | null; error?: string }> => {
    const rentalId = data.rentalId;
    try {
      const { data: rental, error: rErr } = await supabaseAdmin
        .from("rentals")
        .select(
          "id, vehicle_id, driver_id, start_date, end_date, weekly_rate, rate, rate_amount, billing_cadence, deposit_paid",
        )
        .eq("id", rentalId)
        .maybeSingle();
      if (rErr || !rental) {
        console.error(`[receipt-pdf] rental=${rentalId} FAILED: rental not found`, rErr);
        return { url: null, generatedAt: null, error: "rental not found" };
      }

      const [{ data: driver }, { data: vehicle }] = await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select("full_name, phone, email")
          .eq("id", rental.driver_id)
          .maybeSingle(),
        supabaseAdmin
          .from("vehicles")
          .select("year, make, model, plate, vin")
          .eq("id", rental.vehicle_id)
          .maybeSingle(),
      ]);

      if (!driver || !vehicle) {
        console.error(`[receipt-pdf] rental=${rentalId} FAILED: missing driver or vehicle`);
        return { url: null, generatedAt: null, error: "missing driver or vehicle" };
      }

      const paidAmount =
        data.paymentAmountCents != null
          ? data.paymentAmountCents / 100
          : Number(rental.rate_amount ?? rental.rate ?? rental.weekly_rate ?? 0);
      const totalCost = paidAmount; // first-period charge
      const balanceDue = Math.max(0, totalCost - paidAmount);

      const pdfData: ReceiptPDFData = {
        rental: {
          id: rental.id,
          startDate: rental.start_date,
          endDate: rental.end_date ?? null,
          billingCadence: rental.billing_cadence ?? null,
          rate: rental.rate != null ? Number(rental.rate) : null,
          weeklyRate: rental.weekly_rate != null ? Number(rental.weekly_rate) : null,
          rateAmount: rental.rate_amount != null ? Number(rental.rate_amount) : null,
        },
        driver: {
          fullName: driver.full_name ?? "",
          phone: driver.phone ?? "",
          email: driver.email ?? "",
        },
        vehicle: {
          year: vehicle.year ?? "",
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          plate: vehicle.plate ?? "",
          vin: vehicle.vin ?? "",
        },
        payment: {
          amount: paidAmount,
          method: data.paymentMethod ?? "Stripe",
          paidAt: new Date().toISOString(),
          reference: data.paymentReference ?? null,
          totalCost,
          balanceDue,
        },
        settings: DEFAULT_SETTINGS,
      };

      const pdfBuffer = renderReceiptPdf(pdfData);

      const timestamp = Date.now();
      const path = `${rentalId}/receipt-${timestamp}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("rental-signing")
        .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        console.error(`[receipt-pdf] rental=${rentalId} FAILED: upload`, upErr);
        return { url: null, generatedAt: null, error: `upload failed: ${upErr.message}` };
      }

      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("rental-signing")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) {
        console.error(`[receipt-pdf] rental=${rentalId} FAILED: sign url`, signErr);
        return { url: null, generatedAt: null, error: "sign url failed" };
      }

      const generatedAt = new Date().toISOString();
      const { error: persistErr } = await supabaseAdmin
        .from("rentals")
        .update({
          receipt_pdf_url: signed.signedUrl,
          receipt_pdf_generated_at: generatedAt,
        })
        .eq("id", rentalId);
      if (persistErr) {
        console.error(`[receipt-pdf] rental=${rentalId} FAILED: persist`, persistErr);
        return { url: signed.signedUrl, generatedAt, error: `persist failed: ${persistErr.message}` };
      }

      console.log(`[receipt-pdf] rental=${rentalId} generated ok`);
      return { url: signed.signedUrl, generatedAt };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[receipt-pdf] rental=${rentalId} FAILED:`, e);
      return { url: null, generatedAt: null, error: msg };
    }
  });

/**
 * Generate the receipt PDF and deliver it to the customer via SMS + Email.
 * Fire-and-forget — never throws.
 */
export const sendReceiptToCustomer = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        rentalId: z.string().min(1).max(64),
        paymentAmountCents: z.number().int().nonnegative().optional(),
        paymentMethod: z.string().min(1).max(40).optional(),
        paymentReference: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const errors: string[] = [];
    let smsSent = false;
    let emailSent = false;

    const pdfRes = await generateReceiptPdf({
      data: {
        rentalId: data.rentalId,
        paymentAmountCents: data.paymentAmountCents,
        paymentMethod: data.paymentMethod,
        paymentReference: data.paymentReference,
      },
    });
    if (!pdfRes?.url) {
      return {
        ok: false,
        pdfUrl: null,
        smsSent: false,
        emailSent: false,
        errors: [`PDF generation failed: ${pdfRes?.error ?? "unknown"}`],
      };
    }
    const pdfUrl = pdfRes.url;

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id")
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

    if (driver.phone) {
      try {
        await sendSms(
          driver.phone,
          `Camauto Rentals — your receipt is ready: ${pdfUrl}`,
          driver.full_name,
        );
        smsSent = true;
      } catch (e) {
        errors.push(`SMS failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      errors.push("no phone on file");
    }

    const validEmail =
      driver.email && driver.email.includes("@") && !driver.email.endsWith("@camauto.local");
    if (validEmail) {
      const subject = "Your Camauto Rentals Receipt";
      const html = `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
          <h2 style="margin: 0 0 12px;">Thanks for your payment!</h2>
          <p>Hi ${driver.full_name ?? "there"},</p>
          <p>Attached is your payment receipt for <strong>${vehLabel}</strong>
          (Reservation #${rental.id}).</p>
          <p style="margin: 24px 0;">
            <a href="${pdfUrl}"
               style="background:#2db84b;color:#fff;padding:10px 18px;border-radius:6px;
                      text-decoration:none;font-weight:600;">
              View / Download Receipt (PDF)
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
          attachments: [pdfUrl],
        });
        emailSent = true;
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      errors.push("no email on file");
    }

    return { ok: smsSent || emailSent, pdfUrl, smsSent, emailSent, errors };
  });