import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";

function genToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
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

async function uploadDataUrl(rentalId: string, kind: string, dataUrl: string) {
  const { buffer, contentType, ext } = dataUrlToBuffer(dataUrl);
  const path = `${rentalId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("rental-signing")
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  // Bucket is private — mint a long-lived signed URL (10 years).
  const { data, error: signErr } = await supabaseAdmin.storage
    .from("rental-signing")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !data?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message ?? "unknown"}`);
  return data.signedUrl;
}

/** Ensure a rental has a sign_token; send SMS to renter with the signing link. */
export const sendSigningLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rentalId: string; origin: string }) => {
    if (!input.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, sign_token")
      .eq("id", data.rentalId)
      .single();
    if (error || !rental) throw new Error("Reservation not found");

    let token = rental.sign_token as string | null;
    if (!token) {
      token = genToken();
      const { error: upErr } = await supabaseAdmin
        .from("rentals")
        .update({ sign_token: token })
        .eq("id", rental.id);
      if (upErr) throw new Error(`Could not save token: ${upErr.message}`);
    }

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, phone")
      .eq("id", rental.driver_id)
      .single();
    if (!driver?.phone) throw new Error("Renter has no phone on file");

    const link = `${data.origin.replace(/\/$/, "")}/sign/${token}`;
    const message = `Camauto Rentals: Please complete your rental agreement online and upload your driver's license + selfie here: ${link}. You do not need to come in to sign.`;
    await sendSms(driver.phone, message, driver.full_name ?? null);
    return { ok: true, link };
  });

/** Ensure a rental has a sign_token and return the link + renter contact info.
 *  Used by the "Email" option so the staff can send from their own mail client. */
export const getSigningLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rentalId: string; origin: string }) => {
    if (!input.rentalId || typeof input.rentalId !== "string") throw new Error("rentalId required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, sign_token")
      .eq("id", data.rentalId)
      .single();
    if (error || !rental) throw new Error("Reservation not found");

    let token = rental.sign_token as string | null;
    if (!token) {
      token = genToken();
      const { error: upErr } = await supabaseAdmin
        .from("rentals")
        .update({ sign_token: token })
        .eq("id", rental.id);
      if (upErr) throw new Error(`Could not save token: ${upErr.message}`);
    }

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, email, phone")
      .eq("id", rental.driver_id)
      .single();

    const link = `${data.origin.replace(/\/$/, "")}/sign/${token}`;
    return {
      link,
      driverName: driver?.full_name ?? null,
      driverEmail: driver?.email ?? null,
      driverPhone: driver?.phone ?? null,
    };
  });

/** Public: load reservation details for the signing page (token-gated). */
export const getRentalForSigning = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    if (!input.token || typeof input.token !== "string" || input.token.length < 8)
      throw new Error("Invalid token");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, start_date, end_date, weekly_rate, rate, billing_period, deposit_paid, reservation_status, client_signature_url, license_image_url, selfie_image_url, client_signed_at, signed_at, signed_by, agreement_version")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rental) throw new Error("This signing link is invalid or expired");

    const [{ data: vehicle }, { data: driver }] = await Promise.all([
      supabaseAdmin.from("vehicles").select("year, make, model, plate, vin, color, mileage, fuel_level_pickup, ez_pass_tag").eq("id", rental.vehicle_id).maybeSingle(),
      supabaseAdmin.from("drivers").select("full_name, email, phone, license_number, license_expiry, date_of_birth, address").eq("id", rental.driver_id).maybeSingle(),
    ]);

    return {
      rentalId: rental.id,
      startDate: rental.start_date,
      endDate: rental.end_date ?? null,
      billingPeriod: rental.billing_period ?? "weekly",
      rate: rental.rate ?? rental.weekly_rate,
      deposit: rental.deposit_paid,
      depositPaid: Number(rental.deposit_paid ?? 0),
      reservationStatus: rental.reservation_status,
      vehicle: vehicle
        ? {
            year: vehicle.year ?? "",
            make: vehicle.make ?? "",
            model: vehicle.model ?? "",
            plate: vehicle.plate ?? "",
            vin: vehicle.vin ?? "",
            color: vehicle.color ?? "",
            mileage: Number(vehicle.mileage ?? 0),
            fuelLevelPickup: vehicle.fuel_level_pickup ?? null,
            ezPassTag: vehicle.ez_pass_tag ?? null,
          }
        : null,
      driverName: driver?.full_name ?? null,
      driverEmail: driver?.email ?? null,
      driverPhone: driver?.phone ?? null,
      licenseNumber: driver?.license_number ?? "",
      licenseExpiry: driver?.license_expiry ?? "",
      dateOfBirth: driver?.date_of_birth ?? null,
      address: driver?.address ?? "",
      signedAt: rental.signed_at ?? null,
      signedBy: rental.signed_by ?? null,
      agreementVersion: rental.agreement_version ?? null,
      alreadySigned: !!rental.client_signature_url,
      licenseUploaded: !!rental.license_image_url,
      selfieUploaded: !!rental.selfie_image_url,
    };
  });

/** Public: submit the renter's signed package (signature + license + selfie). */
export const submitSigningPackage = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    signatureDataUrl: string;
    licenseDataUrl: string;
    selfieDataUrl: string;
    signedBy: string;
  }) => {
    if (!input.token || input.token.length < 8) throw new Error("Invalid token");
    if (!input.signatureDataUrl?.startsWith("data:image/")) throw new Error("Signature required");
    if (!input.licenseDataUrl?.startsWith("data:image/")) throw new Error("License photo required");
    if (!input.selfieDataUrl?.startsWith("data:image/")) throw new Error("Selfie required");
    if (!input.signedBy || input.signedBy.length > 200) throw new Error("Name required");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, sign_token, payment_received, reservation_status, client_signature_url")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (error || !rental) throw new Error("Invalid signing link");

    // Idempotency: if this rental was already signed, don't re-upload or re-text.
    if (rental.client_signature_url) {
      return { ok: true, alreadySigned: true };
    }

    const [signatureUrl, licenseUrl, selfieUrl] = await Promise.all([
      uploadDataUrl(rental.id, "signature", data.signatureDataUrl),
      uploadDataUrl(rental.id, "license", data.licenseDataUrl),
      uploadDataUrl(rental.id, "selfie", data.selfieDataUrl),
    ]);

    const nowIso = new Date().toISOString();
    const update: {
      client_signature_url: string;
      license_image_url: string;
      selfie_image_url: string;
      client_signed_at: string;
      signature_data_url: string;
      signed_at: string;
      signed_by: string;
      agreement_version: string;
      reservation_status?: string;
    } = {
      client_signature_url: signatureUrl,
      license_image_url: licenseUrl,
      selfie_image_url: selfieUrl,
      client_signed_at: nowIso,
      signature_data_url: signatureUrl,
      signed_at: nowIso,
      signed_by: data.signedBy,
      agreement_version: "v1.0",
    };
    if (rental.reservation_status === "pending" && rental.payment_received) {
      update.reservation_status = "active";
    }

    const { error: upErr } = await supabaseAdmin
      .from("rentals")
      .update(update)
      .eq("id", rental.id);
    if (upErr) throw new Error(`Failed to save: ${upErr.message}`);

    // Update driver's insurance/license on file
    await supabaseAdmin
      .from("drivers")
      .update({ insurance_on_file: true })
      .eq("id", rental.driver_id);

    // After signing: if not yet paid, text the renter a Stripe payment link
    // so the reservation can flip to "on rent" once payment lands.
    try {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("phone, full_name")
        .eq("id", rental.driver_id)
        .single();

      if (rental.payment_received) {
        if (driver?.phone) {
          await sendSms(
            driver.phone,
            "Camauto Rentals: Thank you! Your signed agreement and ID have been received — your reservation is confirmed.",
            driver.full_name ?? null,
          );
        }
      } else {
        // Pull rate to charge first period
        const { data: full } = await supabaseAdmin
          .from("rentals")
          .select("rate, weekly_rate, billing_period")
          .eq("id", rental.id)
          .single();
        const amount = Number(full?.rate ?? full?.weekly_rate ?? 0);
        const period = (full?.billing_period as string) ?? "weekly";
        const periodLabel = period === "daily" ? "day" : period === "monthly" ? "month" : "week";
        const amountCents = Math.round(amount * 100);

        if (driver?.phone && amountCents >= 50) {
          const env: StripeEnv = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
          const stripe = createStripeClient(env);
          const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
          let origin = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
          if (originHeader) {
            try { origin = new URL(originHeader).origin; } catch { /* keep fallback */ }
          }
          origin = origin.replace(/\/$/, "");
          const metadata = { kind: "rental_first_payment", rental_id: rental.id };
          const product = await stripe.products.create({
            name: `Rental ${rental.id} — first ${periodLabel}`,
            metadata: { rental_id: rental.id },
          });
          const price = await stripe.prices.create({
            product: product.id,
            currency: "usd",
            unit_amount: amountCents,
          });
          const link = await stripe.paymentLinks.create({
            line_items: [{ price: price.id, quantity: 1 }],
            metadata,
            payment_intent_data: { metadata },
            after_completion: {
              type: "redirect" as const,
              redirect: {
                url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}&rental_id=${encodeURIComponent(rental.id)}`,
              },
            },
            restrictions: { completed_sessions: { limit: 1 } },
          });
          if (link.url) {
            const amt = `$${(amountCents / 100).toFixed(2)}`;
            await sendSms(
              driver.phone,
              `Camauto Rentals: Thanks for signing! Final step — please pay ${amt} for your first ${periodLabel} to release the vehicle: ${link.url}`,
              driver.full_name ?? null,
            );
          }
        } else if (driver?.phone) {
          await sendSms(
            driver.phone,
            "Camauto Rentals: Thanks for signing! We'll be in touch with payment instructions shortly.",
            driver.full_name ?? null,
          );
        }
      }
    } catch (e) {
      console.error("post-sign notify failed", e);
    }

    return { ok: true };
  });