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

      // ---- Compute itemized totals from actual rental duration + extensions ----
      const [{ data: extensions }, { data: charges }] = await Promise.all([
        supabaseAdmin
          .from("rental_extensions")
          .select("periods, period_label, previous_end_date, new_end_date, additional_amount, extended_at")
          .eq("rental_id", rentalId)
          .order("extended_at", { ascending: true }),
        supabaseAdmin
          .from("rental_charges")
          .select("amount, status")
          .eq("rental_id", rentalId),
      ]);

      const rate = Number(rental.rate_amount ?? rental.rate ?? rental.weekly_rate ?? 0);
      const cadence = (rental.billing_cadence || "weekly").toLowerCase();
      const periodDays = cadence === "daily" ? 1 : cadence === "monthly" ? 30 : 7;
      const periodWord = cadence === "daily" ? "day" : cadence === "monthly" ? "month" : "week";

      // Original period = start_date → (first extension's previous_end_date OR rental.end_date)
      const startMs = new Date(`${rental.start_date}T00:00:00`).getTime();
      const firstExt = (extensions ?? [])[0];
      const originalEndStr =
        firstExt?.previous_end_date ?? rental.end_date ?? rental.start_date;
      const originalEndMs = new Date(`${originalEndStr}T00:00:00`).getTime();
      const originalPeriods = Math.max(
        1,
        Math.round((originalEndMs - startMs) / (periodDays * 86400000)),
      );
      const originalAmount = originalPeriods * rate;

      const lineItems: { label: string; amount: number }[] = [
        {
          label: `Original rental — ${originalPeriods} ${periodWord}${originalPeriods === 1 ? "" : "s"} × ${fmtMoney(rate)}`,
          amount: originalAmount,
        },
      ];

      let extensionsTotal = 0;
      (extensions ?? []).forEach((ext, i) => {
        const amt = Number(ext.additional_amount ?? 0);
        extensionsTotal += amt;
        const p = ext.periods ?? 1;
        const label = ext.period_label || periodWord;
        lineItems.push({
          label: `Extension ${i + 1} — ${p} ${label}${p === 1 ? "" : "s"}`,
          amount: amt,
        });
      });

      const computedTotal = originalAmount + extensionsTotal;
      const chargesSum = (charges ?? [])
        .filter((c) => ["succeeded", "recorded", "paid"].includes((c.status || "").toLowerCase()))
        .reduce((s, c) => s + Number(c.amount ?? 0), 0);

      const totalCost = computedTotal > 0 ? computedTotal : chargesSum;
      const paidAmount =
        data.paymentAmountCents != null
          ? data.paymentAmountCents / 100
          : chargesSum > 0
            ? chargesSum
            : totalCost;
      const balanceDue = Math.max(0, totalCost - paidAmount);

      const endStr = rental.end_date ?? rental.start_date;
      const totalPeriods =
        originalPeriods + (extensions ?? []).reduce((s, e) => s + (e.periods ?? 0), 0);
      const durationLabel = `${totalPeriods} ${periodWord}${totalPeriods === 1 ? "" : "s"} (${rental.start_date} → ${endStr})`;

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
        lineItems,
        durationLabel,
        settings: DEFAULT_SETTINGS,
      };

      const pdfBuffer = await renderReceiptPdf(pdfData);

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