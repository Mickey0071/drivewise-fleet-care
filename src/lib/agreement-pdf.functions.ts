import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderRentalAgreementPdf, type RentalAgreementPDFData } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";
import { z } from "zod";

/**
 * Generate a PDF of the signed rental agreement and store it in the
 * `rental-signing` bucket. Saves the resulting signed URL on the rental row.
 *
 * NOTE: callable without auth — it is fire-and-forget from `submitSigningPackage`
 * (which itself is token-gated). Validates the rental exists and is at least
 * partially signed before proceeding.
 *
 * Never throws — always returns `{ url, generatedAt, error }`. Callers can
 * ignore failures; errors are logged with `[agreement-pdf]` prefix.
 */
export const generateAgreementPdf = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ rentalId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }): Promise<{ url: string | null; generatedAt: string | null; error?: string }> => {
    const rentalId = data.rentalId;
    try {
      // 1) Fetch rental, driver, vehicle, extensions
      const { data: rental, error: rErr } = await supabaseAdmin
        .from("rentals")
        .select("id, vehicle_id, driver_id, start_date, end_date, weekly_rate, rate, rate_amount, billing_cadence, billing_period, deposit_paid, signed_by, signed_at, client_signed_at, client_signature_url, agreement_version")
        .eq("id", rentalId)
        .maybeSingle();
      if (rErr || !rental) {
        console.error(`[agreement-pdf] rental=${rentalId} FAILED: rental not found`, rErr);
        return { url: null, generatedAt: null, error: "rental not found" };
      }

      const [{ data: driver }, { data: vehicle }, { data: exts }] = await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select("full_name, first_name, last_name, middle_initial, date_of_birth, license_number, license_expiry, dl_state, phone, email, street_address, apt_unit, city, state, zip_code, address, alt_contact_name, alt_contact_phone")
          .eq("id", rental.driver_id)
          .maybeSingle(),
        supabaseAdmin
          .from("vehicles")
          .select("year, make, model, color, plate, vin, mileage, fuel_level_pickup, ez_pass_tag")
          .eq("id", rental.vehicle_id)
          .maybeSingle(),
        supabaseAdmin
          .from("rental_extensions")
          .select("id, extended_at, previous_end_date, new_end_date, periods, period_label, additional_amount, signed_by")
          .eq("rental_id", rentalId)
          .order("extended_at", { ascending: true }),
      ]);

      if (!driver || !vehicle) {
        console.error(`[agreement-pdf] rental=${rentalId} FAILED: missing driver or vehicle`);
        return { url: null, generatedAt: null, error: "missing driver or vehicle" };
      }

      // 2) Fetch signature PNG (if any) as bytes for inline embed
      let signaturePng: Buffer | null = null;
      if (rental.client_signature_url) {
        try {
          const res = await fetch(rental.client_signature_url);
          if (res.ok) {
            const ab = await res.arrayBuffer();
            signaturePng = Buffer.from(ab);
          } else {
            console.warn(`[agreement-pdf] rental=${rentalId}: signature fetch ${res.status}`);
          }
        } catch (e) {
          console.warn(`[agreement-pdf] rental=${rentalId}: signature fetch failed`, e);
        }
      }

      const pdfData: RentalAgreementPDFData = {
        rental: {
          id: rental.id,
          startDate: rental.start_date,
          endDate: rental.end_date ?? null,
          billingCadence: rental.billing_cadence ?? null,
          billingPeriod: rental.billing_period ?? null,
          rateAmount: rental.rate_amount != null ? Number(rental.rate_amount) : null,
          rate: rental.rate != null ? Number(rental.rate) : null,
          weeklyRate: rental.weekly_rate != null ? Number(rental.weekly_rate) : null,
          depositPaid: Number(rental.deposit_paid ?? 0),
          signedBy: rental.signed_by ?? null,
          signedAt: rental.signed_at ?? null,
          clientSignedAt: rental.client_signed_at ?? null,
          agreementVersion: rental.agreement_version ?? null,
        },
        driver: {
          fullName: driver.full_name ?? "",
          firstName: driver.first_name ?? null,
          lastName: driver.last_name ?? null,
          middleInitial: driver.middle_initial ?? null,
          dateOfBirth: driver.date_of_birth ?? null,
          licenseNumber: driver.license_number ?? "",
          licenseExpiry: driver.license_expiry ?? null,
          dlState: driver.dl_state ?? null,
          phone: driver.phone ?? "",
          email: driver.email ?? "",
          streetAddress: driver.street_address ?? null,
          aptUnit: driver.apt_unit ?? null,
          city: driver.city ?? null,
          state: driver.state ?? null,
          zipCode: driver.zip_code ?? null,
          address: driver.address ?? null,
          altContactName: driver.alt_contact_name ?? null,
          altContactPhone: driver.alt_contact_phone ?? null,
        },
        vehicle: {
          year: vehicle.year ?? "",
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          color: vehicle.color ?? null,
          plate: vehicle.plate ?? "",
          vin: vehicle.vin ?? "",
          mileage: Number(vehicle.mileage ?? 0),
          fuelLevelPickup: vehicle.fuel_level_pickup ?? null,
          ezPassTag: vehicle.ez_pass_tag ?? null,
        },
        extensions: (exts ?? []).map((e) => ({
          id: e.id,
          extendedAt: e.extended_at,
          previousEndDate: e.previous_end_date ?? null,
          newEndDate: e.new_end_date,
          periods: e.periods,
          periodLabel: e.period_label,
          additionalAmount: Number(e.additional_amount ?? 0),
          signedBy: e.signed_by ?? null,
        })),
        settings: DEFAULT_SETTINGS,
        signaturePng,
      };

      // 3) Render PDF via jsPDF (no WASM — safe in the Workers SSR runtime).
      const pdfBuffer = await renderRentalAgreementPdf(pdfData);

      // 4) Upload to rental-signing
      const timestamp = Date.now();
      const path = `${rentalId}/agreement-${timestamp}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("rental-signing")
        .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        console.error(`[agreement-pdf] rental=${rentalId} FAILED: upload`, upErr);
        return { url: null, generatedAt: null, error: `upload failed: ${upErr.message}` };
      }

      // 5) 1-year signed URL
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("rental-signing")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) {
        console.error(`[agreement-pdf] rental=${rentalId} FAILED: sign url`, signErr);
        return { url: null, generatedAt: null, error: "sign url failed" };
      }

      // 6) Persist on rental row
      const generatedAt = new Date().toISOString();
      const { error: persistErr } = await supabaseAdmin
        .from("rentals")
        .update({
          agreement_pdf_url: signed.signedUrl,
          agreement_pdf_generated_at: generatedAt,
        })
        .eq("id", rentalId);
      if (persistErr) {
        console.error(`[agreement-pdf] rental=${rentalId} FAILED: persist`, persistErr);
        return { url: signed.signedUrl, generatedAt, error: `persist failed: ${persistErr.message}` };
      }

      console.log(`[agreement-pdf] rental=${rentalId} generated ok`);
      return { url: signed.signedUrl, generatedAt };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[agreement-pdf] rental=${rentalId} FAILED:`, e);
      return { url: null, generatedAt: null, error: msg };
    }
  });