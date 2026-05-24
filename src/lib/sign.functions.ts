import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";
import { extractNameFromIdImage, uploadPayerIdImage } from "@/lib/payer-id-ocr.server";
import { notifyRenter } from "@/lib/renter-notify.server";

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
      .select("full_name, phone, email")
      .eq("id", rental.driver_id)
      .single();
    if (!driver?.phone) throw new Error("Renter has no phone on file");

    const link = `${data.origin.replace(/\/$/, "")}/sign/${token}`;
    const message = `Camauto Rentals: Please complete your rental agreement online and upload your driver's license + selfie here: ${link}. You do not need to come in to sign.`;
    await notifyRenter({
      phone: driver.phone,
      email: driver.email ?? null,
      name: driver.full_name ?? null,
      sms: message,
      emailSubject: "Your Camauto Rental Agreement",
      emailHeading: "Sign Your Rental Agreement",
      emailIntro:
        "Please complete your rental agreement online and upload your driver's license + selfie. You do not need to come in to sign.",
      emailCta: { label: "Sign Agreement Now", url: link },
      emailFootnote: "After signing, we'll text you a secure payment link.",
    });
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
    let rental: any, error: any;
    try {
      const res = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, start_date, end_date, weekly_rate, rate, billing_period, deposit_paid, reservation_status, client_signature_url, license_image_url, selfie_image_url, client_signed_at, signed_at, signed_by, agreement_version")
      .eq("sign_token", data.token)
      .maybeSingle();
      rental = res.data;
      error = res.error;
    } catch (e) {
      console.error("[getRentalForSigning] rental query threw:", e);
      throw new Error("Lookup failed");
    }
    if (error) {
      console.error("[getRentalForSigning] rental query error:", error);
      throw new Error(error.message ?? "Lookup failed");
    }
    if (!rental) throw new Error("This signing link is invalid or expired");

    let vehicle: any = null, driver: any = null;
    try {
      const [vRes, dRes] = await Promise.all([
        supabaseAdmin.from("vehicles").select("year, make, model, plate, vin, color, mileage, fuel_level_pickup, ez_pass_tag").eq("id", rental.vehicle_id).maybeSingle(),
        supabaseAdmin.from("drivers").select("full_name, email, phone, license_number, license_expiry, date_of_birth, address").eq("id", rental.driver_id).maybeSingle(),
      ]);
      vehicle = vRes.data;
      driver = dRes.data;
    } catch (e) {
      console.error("[getRentalForSigning] vehicle/driver query threw:", e);
    }
    const payload = {
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
    // Force a plain, JSON-safe POJO to avoid Seroval serialization errors
    // (e.g. when Supabase returns objects with non-cloneable prototypes
    // or numeric strings that confuse the streaming serializer).
    return JSON.parse(JSON.stringify(payload)) as typeof payload;
  });

/** Public: submit the renter's signed package (signature + license + selfie). */
export const submitSigningPackage = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    signatureDataUrl: string;
    licenseDataUrl: string;
    selfieDataUrl: string;
    signedBy: string;
    thirdPartyPayer?: boolean;
    payerIdDataUrl?: string;
    payerPhone?: string;
  }) => {
    if (!input.token || input.token.length < 8) throw new Error("Invalid token");
    if (!input.signatureDataUrl?.startsWith("data:image/")) throw new Error("Signature required");
    if (!input.licenseDataUrl?.startsWith("data:image/")) throw new Error("License photo required");
    if (!input.selfieDataUrl?.startsWith("data:image/")) throw new Error("Selfie required");
    if (!input.signedBy || input.signedBy.length > 200) throw new Error("Name required");
    if (input.thirdPartyPayer) {
      if (!input.payerIdDataUrl?.startsWith("data:image/")) throw new Error("Payer's ID photo required");
      if (input.payerPhone && input.payerPhone.length > 30) throw new Error("Invalid payer phone");
    }
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

    // Third-party payer: upload the payer's ID and OCR the name so the
    // webhook can compare it to the Stripe cardholder_name later.
    let payerIdUrl: string | null = null;
    let payerName: string | null = null;
    if (data.thirdPartyPayer && data.payerIdDataUrl) {
      try {
        payerIdUrl = await uploadPayerIdImage(rental.id, data.payerIdDataUrl);
        payerName = await extractNameFromIdImage(data.payerIdDataUrl);
        console.log(`[sign] third-party payer for ${rental.id}: name="${payerName ?? "?"}"`);
      } catch (e) {
        console.error(`[sign] payer ID handling failed for ${rental.id}:`, e);
        throw new Error("Could not process payer's ID — please retry");
      }
      if (!payerName) throw new Error("Could not read the name on the payer's ID — please retake the photo");
    }

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
      activated_at?: string;
      third_party_payer?: boolean;
      payer_id_image_url?: string | null;
      payer_name_extracted?: string | null;
      payer_phone?: string | null;
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
    if (data.thirdPartyPayer) {
      update.third_party_payer = true;
      update.payer_id_image_url = payerIdUrl;
      update.payer_name_extracted = payerName;
      update.payer_phone = data.payerPhone?.trim() || null;
    } else {
      update.third_party_payer = false;
    }
    if (rental.reservation_status === "pending" && rental.payment_received) {
      update.reservation_status = "active";
      update.activated_at = nowIso;
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

    // After signing: thank the renter and let them know staff will review
    // the submitted agreement + ID before sending a payment link manually.
    try {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("phone, full_name, email")
        .eq("id", rental.driver_id)
        .single();
      if (driver?.phone) {
        await notifyRenter({
          phone: driver.phone,
          email: driver.email ?? null,
          name: driver.full_name ?? null,
          sms: "Thank you for choosing Camauto. Your signed agreement and ID have been received and are under review by our team. We'll text you a payment link once your reservation is approved.",
          emailSubject: "Agreement Received — Camauto Rentals",
          emailHeading: "Thank You for Choosing Camauto",
          emailIntro:
            "Your signed agreement and ID have been received and are now under review by our team. Once approved, we'll send you a payment link by text and email so you can complete your reservation.",
        });
      }
      // Alert management to review the submission and manually issue the
      // payment link from the Reservations admin screen.
      await notifyManagementForReview(rental.id, driver?.full_name ?? null);
    } catch (e) {
      console.error("post-sign notify failed", e);
    }

    // Fire-and-forget: generate the signed agreement PDF and text it to the
    // renter. Worker may terminate background work — acceptable for v1.
    void generateAgreementPdf({ data: { rentalId: rental.id } })
      .then(async (res) => {
        if (!res.url) {
          console.warn(`[agreement-pdf] rental=${rental.id} generation returned no url`);
          return;
        }
        console.log(`[agreement-pdf] rental=${rental.id} generated ok, url=${res.url}`);
        try {
          const { data: driver } = await supabaseAdmin
            .from("drivers")
            .select("phone, full_name, first_name, last_name, email")
            .eq("id", rental.driver_id)
            .single();
          if (driver?.phone) {
            const name = driver.full_name
              ?? [driver.first_name, driver.last_name].filter(Boolean).join(" ")
              ?? null;
            await notifyRenter({
              phone: driver.phone,
              email: driver.email ?? null,
              name,
              sms: `Camauto Rentals: Your signed rental agreement is ready: ${res.url}`,
              emailSubject: "Your Signed Rental Agreement",
              emailHeading: "Your Signed Agreement is Ready",
              emailIntro:
                "Your fully-signed rental agreement is attached and available at the link below for your records.",
              emailCta: { label: "View / Download Agreement (PDF)", url: res.url },
              emailAttachments: [res.url],
            });
          }
        } catch (e) {
          console.error(`[agreement-pdf-sms] rental=${rental.id} FAILED:`, e);
        }
      })
      .catch((e) => console.error(`[agreement-pdf] rental=${rental.id} FAILED:`, e));

    return { ok: true };
  });
/** Public: OCR the uploaded renter's license and check it matches the
 *  driver name we have on file. Returns { match, extractedName }. */
export const verifyLicenseName = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; licenseDataUrl: string }) => {
    if (!input.token || input.token.length < 8) throw new Error("Invalid token");
    if (!input.licenseDataUrl?.startsWith("data:image/")) throw new Error("License image required");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("driver_id")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (!rental) throw new Error("Invalid signing link");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, first_name, last_name")
      .eq("id", rental.driver_id)
      .single();
    const expected = (driver?.full_name
      || [driver?.first_name, driver?.last_name].filter(Boolean).join(" ")
      || "").trim();
    const extracted = await extractNameFromIdImage(data.licenseDataUrl);
    if (!extracted) {
      return { match: false, extractedName: null as string | null, expectedName: expected, reason: "unreadable" as const };
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((t) => t.length > 1);
    const e = new Set(norm(extracted));
    const x = norm(expected);
    if (x.length === 0) return { match: true, extractedName: extracted, expectedName: expected, reason: "no_baseline" as const };
    // Require first + last token to be present in extracted name.
    const first = x[0];
    const last = x[x.length - 1];
    const match = e.has(first) && e.has(last);
    return { match, extractedName: extracted, expectedName: expected, reason: match ? ("ok" as const) : ("mismatch" as const) };
  });
