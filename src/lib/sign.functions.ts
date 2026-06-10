import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";
import { extractNameFromIdImage, extractAddressFromIdImage, extractLicenseFieldsFromImage, uploadPayerIdImage } from "@/lib/payer-id-ocr.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { sendEmail } from "@/lib/ghl.server";
import { sendPaymentLinkInternal } from "@/lib/payment-link.functions";

const MANAGEMENT_EMAIL = "info@camautorentals.com";

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
      .select("id, driver_id, vehicle_id, sign_token, payment_received, reservation_status, client_signature_url, rate, weekly_rate, billing_period")
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
      .update({ ...update, staff_review_status: "pending" })
      .eq("id", rental.id);
    if (upErr) throw new Error(`Failed to save: ${upErr.message}`);

    // Update driver's insurance/license on file
    {
      const driverUpdate: {
        insurance_on_file: boolean;
        address?: string;
        street_address?: string;
        city?: string;
        state?: string;
        zip_code?: string;
        license_number?: string;
        dl_state?: string;
        license_expiry?: string;
        date_of_birth?: string;
      } = { insurance_on_file: true };
      // Full OCR pass on the renter's license — backfill any blank
      // driver fields (license #, state, expiration, DOB, address) so
      // the generated agreement PDF is fully populated even if the
      // renter skipped (or failed) the in-page name verification step.
      try {
        const { data: existing } = await supabaseAdmin
          .from("drivers")
          .select("address, street_address, city, state, zip_code, license_number, dl_state, license_expiry, date_of_birth")
          .eq("id", rental.driver_id)
          .maybeSingle();
        const isBlank = (v: unknown) => !v || (typeof v === "string" && v.trim() === "");
        const hasAddr =
          !isBlank(existing?.address) ||
          !isBlank(existing?.street_address) ||
          !isBlank(existing?.city) ||
          !isBlank(existing?.state) ||
          !isBlank(existing?.zip_code);
        const hasLicenseFields =
          !isBlank(existing?.license_number) &&
          !isBlank((existing as any)?.dl_state) &&
          !isBlank(existing?.license_expiry) &&
          !isBlank((existing as any)?.date_of_birth);
        if (!hasAddr || !hasLicenseFields) {
          const fields = await extractLicenseFieldsFromImage(data.licenseDataUrl);
          if (fields) {
            console.log(
              `[sign] OCR license for ${rental.id}: dl=${fields.licenseNumber ?? "?"} state=${fields.dlState ?? "?"} exp=${fields.licenseExpiry ?? "?"} dob=${fields.dateOfBirth ?? "?"} addr=${fields.address?.formatted ?? "?"}`,
            );
            if (isBlank(existing?.license_number) && fields.licenseNumber) driverUpdate.license_number = fields.licenseNumber;
            if (isBlank((existing as any)?.dl_state) && fields.dlState) driverUpdate.dl_state = fields.dlState;
            if (isBlank(existing?.license_expiry) && fields.licenseExpiry) driverUpdate.license_expiry = fields.licenseExpiry;
            if (isBlank((existing as any)?.date_of_birth) && fields.dateOfBirth) driverUpdate.date_of_birth = fields.dateOfBirth;
            if (!hasAddr && fields.address) {
              if (fields.address.formatted) driverUpdate.address = fields.address.formatted;
              if (fields.address.streetAddress) driverUpdate.street_address = fields.address.streetAddress;
              if (fields.address.city) driverUpdate.city = fields.address.city;
              if (fields.address.state) driverUpdate.state = fields.address.state;
              if (fields.address.zipCode) driverUpdate.zip_code = fields.address.zipCode;
            }
          } else {
            console.warn(`[sign] OCR license: nothing readable for ${rental.id}`);
          }
        }
      } catch (e) {
        console.error(`[sign] OCR license failed for ${rental.id}:`, e);
      }
      await supabaseAdmin.from("drivers").update(driverUpdate).eq("id", rental.driver_id);
    }

    // After signing: AUTO-SEND the Stripe payment link to the renter
    // immediately (no staff approval step). The renter gets a text + email
    // with a secure single-use payment link the moment they finish
    // uploading their license and selfie.
    try {
      const [{ data: driver }, { data: vehicle }] = await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select("phone, full_name, email")
          .eq("id", rental.driver_id)
          .single(),
        supabaseAdmin
          .from("vehicles")
          .select("year, make, model")
          .eq("id", rental.vehicle_id ?? "")
          .maybeSingle(),
      ]);

      // First payment = the rental's weekly/period rate.
      const rate = Number(rental.rate ?? rental.weekly_rate ?? 0);
      const amountCents = Math.round(rate * 100);
      const vehicleInfo = vehicle
        ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
        : "";
      const period = rental.billing_period === "monthly" ? "monthly" : "weekly";
      const description = vehicleInfo
        ? `Camauto Rentals — ${period} rental (${vehicleInfo})`
        : `Camauto Rentals — ${period} rental`;

      if (driver?.phone && amountCents >= 50) {
        const origin = process.env.PUBLIC_APP_ORIGIN || "";
        try {
          const result = await sendPaymentLinkInternal({
            phone: driver.phone,
            name: driver.full_name ?? undefined,
            email: driver.email ?? null,
            amountCents,
            description: description.slice(0, 200),
            environment: "live",
            rentalId: rental.id,
            origin,
            sendSms: true,
            sendEmail: !!driver.email,
          });
          // Log + clear the review badge since the link auto-sent.
          await Promise.all([
            supabaseAdmin.from("payment_link_logs").insert({
              rental_id: rental.id,
              amount_cents: amountCents,
              reason: "Auto-sent after signing",
              channels: driver.email ? ["sms", "email"] : ["sms"],
              link_url: result.url,
              custom_message: null,
            }),
            supabaseAdmin
              .from("rentals")
              .update({ staff_review_status: "reviewed" })
              .eq("id", rental.id),
          ]);
          console.log(`[sign] auto-sent payment link for ${rental.id}: ${result.url}`);
        } catch (linkErr) {
          console.error(`[sign] auto payment link failed for ${rental.id}:`, linkErr);
          // Fall back to a reassuring message so the renter isn't left hanging.
          await notifyRenter({
            phone: driver.phone,
            email: driver.email ?? null,
            name: driver.full_name ?? null,
            sms: "Thank you for choosing Camauto. Your signed agreement and ID have been received. We'll text you your payment link shortly.",
            emailSubject: "Agreement Received — Camauto Rentals",
            emailHeading: "Thank You for Choosing Camauto",
            emailIntro:
              "Your signed agreement and ID have been received. We'll send you a secure payment link by text and email shortly.",
          });
        }
      } else if (driver?.phone) {
        // No rate on file — can't auto-create a link; reassure the renter.
        await notifyRenter({
          phone: driver.phone,
          email: driver.email ?? null,
          name: driver.full_name ?? null,
          sms: "Thank you for choosing Camauto. Your signed agreement and ID have been received. We'll text you your payment link shortly.",
          emailSubject: "Agreement Received — Camauto Rentals",
          emailHeading: "Thank You for Choosing Camauto",
          emailIntro:
            "Your signed agreement and ID have been received. We'll send you a secure payment link by text and email shortly.",
        });
      }
    } catch (e) {
      console.error("post-sign auto payment link failed", e);
    }

    // If signing flipped the reservation to ON RENT (payment already received),
    // send the renter a clean activation confirmation (no portal link yet).
    if (update.reservation_status === "active") {
      try {
        const [{ data: driver }, { data: vehicle }] = await Promise.all([
          supabaseAdmin
            .from("drivers")
            .select("phone, full_name, email")
            .eq("id", rental.driver_id)
            .single(),
          supabaseAdmin
            .from("vehicles")
            .select("year, make, model")
            .eq("id", rental.vehicle_id ?? "")
            .maybeSingle(),
        ]);
        if (driver?.phone) {
          const rentalLabel = `R-${rental.id.slice(-3).toUpperCase()}`;
          const vehicleInfo = vehicle
            ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
            : "";
          const vehicleLine = vehicleInfo ? ` Vehicle: ${vehicleInfo}.` : "";
          await notifyRenter({
            phone: driver.phone,
            email: driver.email ?? null,
            name: driver.full_name ?? null,
            sms: `Your rental ${rentalLabel} is active!${vehicleLine} Questions? 866-625-5550`,
            emailSubject: "Your Rental Is Active",
            emailHeading: "Your Rental Is Active!",
            emailIntro: `Your rental <strong>${rentalLabel}</strong> is now active.${vehicleLine ? ` Your vehicle is the ${vehicleInfo}.` : ""}`,
            emailFootnote: "Questions? Call us at 866-625-5550.",
          });
        }
      } catch (e) {
        console.error("[sign] activation notify failed", e);
      }
    }

    // CRITICAL: generate + persist the signed agreement PDF BEFORE returning
    // so `agreement_pdf_url` is reliably saved on the rental row. The Worker
    // can terminate background work, which previously lost the PDF on refresh.
    let agreementUrl: string | null = null;
    try {
      const res = await generateAgreementPdf({ data: { rentalId: rental.id } });
      agreementUrl = res.url ?? null;
      if (!agreementUrl) {
        console.warn(`[agreement-pdf] rental=${rental.id} generation returned no url: ${res.error ?? ""}`);
      } else {
        console.log(`[agreement-pdf] rental=${rental.id} generated ok, url=${agreementUrl}`);
      }
    } catch (e) {
      console.error(`[agreement-pdf] rental=${rental.id} FAILED:`, e);
    }

    // SMS/email notification of the signed PDF is non-critical — keep it
    // best-effort so a notify failure never loses the PDF URL.
    if (agreementUrl) {
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
            sms: `Camauto Rentals: Your signed rental agreement is ready: ${agreementUrl}`,
            emailSubject: "Your Signed Rental Agreement",
            emailHeading: "Your Signed Agreement is Ready",
            emailIntro:
              "Your fully-signed rental agreement is attached and available at the link below for your records.",
            emailCta: { label: "View / Download Agreement (PDF)", url: agreementUrl },
            emailAttachments: [agreementUrl],
          });
        }
      } catch (e) {
        console.error(`[agreement-pdf-sms] rental=${rental.id} FAILED:`, e);
      }
    }

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
      .select("full_name, first_name, last_name, license_number, license_expiry, dl_state, date_of_birth, address, street_address, city, state, zip_code")
      .eq("id", rental.driver_id)
      .single();
    const expected = (driver?.full_name
      || [driver?.first_name, driver?.last_name].filter(Boolean).join(" ")
      || "").trim();
    // Single OCR pass — pulls name, DL#, state, expiration, DOB, address.
    const fields = await extractLicenseFieldsFromImage(data.licenseDataUrl);
    const extracted = fields?.fullName ?? null;
    if (!extracted) {
      return { match: false, extractedName: null as string | null, expectedName: expected, reason: "unreadable" as const };
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((t) => t.length > 1);
    const e = new Set(norm(extracted));
    const x = norm(expected);
    const match =
      x.length === 0
        ? true
        : e.has(x[0]) && e.has(x[x.length - 1]);
    const reason = (x.length === 0
      ? "no_baseline"
      : match
        ? "ok"
        : "mismatch") as "ok" | "mismatch" | "no_baseline";

    // On match: backfill ANY blank driver fields from OCR so the on-screen
    // rental agreement (and the generated PDF) populate immediately. We
    // never overwrite values the renter or staff already provided.
    const extractedDriver = {
      fullName: extracted,
      licenseNumber: fields?.licenseNumber ?? null,
      dlState: fields?.dlState ?? null,
      licenseExpiry: fields?.licenseExpiry ?? null,
      dateOfBirth: fields?.dateOfBirth ?? null,
      address: fields?.address?.formatted ?? null,
      streetAddress: fields?.address?.streetAddress ?? null,
      city: fields?.address?.city ?? null,
      state: fields?.address?.state ?? null,
      zipCode: fields?.address?.zipCode ?? null,
    };

    if (match && fields) {
      const upd: Record<string, string> = {};
      const isBlank = (v: unknown) => !v || (typeof v === "string" && v.trim() === "");
      if (isBlank(driver?.license_number) && fields.licenseNumber) upd.license_number = fields.licenseNumber;
      if (isBlank((driver as any)?.dl_state) && fields.dlState) upd.dl_state = fields.dlState;
      if (isBlank(driver?.license_expiry) && fields.licenseExpiry) upd.license_expiry = fields.licenseExpiry;
      if (isBlank((driver as any)?.date_of_birth) && fields.dateOfBirth) upd.date_of_birth = fields.dateOfBirth;
      if (fields.address) {
        if (isBlank((driver as any)?.address) && fields.address.formatted) upd.address = fields.address.formatted;
        if (isBlank((driver as any)?.street_address) && fields.address.streetAddress) upd.street_address = fields.address.streetAddress;
        if (isBlank((driver as any)?.city) && fields.address.city) upd.city = fields.address.city;
        if (isBlank((driver as any)?.state) && fields.address.state) upd.state = fields.address.state;
        if (isBlank((driver as any)?.zip_code) && fields.address.zipCode) upd.zip_code = fields.address.zipCode;
      }
      if (Object.keys(upd).length > 0) {
        const { error: dErr } = await supabaseAdmin
          .from("drivers")
          .update(upd as any)
          .eq("id", rental.driver_id);
        if (dErr) console.error(`[verifyLicense] driver backfill failed:`, dErr);
        else console.log(`[verifyLicense] backfilled driver ${rental.driver_id}:`, Object.keys(upd).join(","));
      }
    }

    return { match, extractedName: extracted, expectedName: expected, reason, extracted: extractedDriver };
  });
