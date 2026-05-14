import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

function genToken() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
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
  const { data } = supabaseAdmin.storage.from("rental-signing").getPublicUrl(path);
  return data.publicUrl;
}

/** Ensure a rental has a sign_token; send SMS to renter with the signing link. */
export const sendSigningLink = createServerFn({ method: "POST" })
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
    const message = `Camauto Rentals: Please complete your reservation by signing your agreement and uploading your driver's license + a selfie here: ${link}`;
    await sendSms(driver.phone, message, driver.full_name ?? null);
    return { ok: true, link };
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
      .select("id, vehicle_id, driver_id, start_date, weekly_rate, rate, billing_period, deposit_paid, reservation_status, client_signature_url, license_image_url, selfie_image_url, client_signed_at")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rental) throw new Error("This signing link is invalid or expired");

    const [{ data: vehicle }, { data: driver }] = await Promise.all([
      supabaseAdmin.from("vehicles").select("year, make, model, plate").eq("id", rental.vehicle_id).single(),
      supabaseAdmin.from("drivers").select("full_name, email").eq("id", rental.driver_id).single(),
    ]);

    return {
      rentalId: rental.id,
      startDate: rental.start_date,
      billingPeriod: rental.billing_period ?? "weekly",
      rate: rental.rate ?? rental.weekly_rate,
      deposit: rental.deposit_paid,
      reservationStatus: rental.reservation_status,
      vehicle: vehicle ?? null,
      driverName: driver?.full_name ?? null,
      driverEmail: driver?.email ?? null,
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
      .select("id, driver_id, sign_token, payment_received, reservation_status")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (error || !rental) throw new Error("Invalid signing link");

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

    // Notify staff via SMS to driver too (acknowledgment)
    try {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("phone, full_name")
        .eq("id", rental.driver_id)
        .single();
      if (driver?.phone) {
        await sendSms(
          driver.phone,
          "Camauto Rentals: Thank you! Your signed agreement, license, and selfie have been received. We'll be in touch shortly.",
          driver.full_name ?? null,
        );
      }
    } catch (e) {
      console.error("ack sms failed", e);
    }

    return { ok: true };
  });