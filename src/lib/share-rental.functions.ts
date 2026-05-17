import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";

function checkoutOrigin(): string {
  const origin = getRequestHeader("origin") || getRequestHeader("referer");
  if (origin) {
    try { return new URL(origin).origin; } catch { /* ignore */ }
  }
  return "https://drivewise-fleet-care.lovable.app";
}

async function createRentalCheckoutUrl(opts: {
  rentalId: string;
  amountCents: number;
  description: string;
  customerEmail?: string;
}): Promise<string | null> {
  try {
    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);
    const origin = checkoutOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: opts.description },
          unit_amount: Math.max(50, Math.round(opts.amountCents)),
        },
        quantity: 1,
      }],
      success_url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/rent/paid?canceled=1`,
      ...(opts.customerEmail ? { customer_email: opts.customerEmail } : {}),
      metadata: { kind: "rental_first_payment", rental_id: opts.rentalId },
    });
    return session.url ?? null;
  } catch (e) {
    console.error("createRentalCheckoutUrl failed", e);
    return null;
  }
}

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
  const { data } = supabaseAdmin.storage.from("rental-signing").getPublicUrl(path);
  return data.publicUrl;
}

async function nextId(table: "rentals" | "drivers", prefix: "R" | "D", floor: number) {
  const { data } = await supabaseAdmin.from(table).select("id");
  const n = (data ?? []).reduce((m: number, row: { id: string }) => {
    const k = parseInt(String(row.id).replace(/\D/g, "")) || 0;
    return Math.max(m, k);
  }, floor);
  return `${prefix}-${n + 1}`;
}

/** Create a public share link for an available vehicle. */
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    vehicleId: string;
    startDate: string;
    billingPeriod: "daily" | "weekly" | "monthly";
    rate: number;
  }) => {
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.startDate) throw new Error("startDate required");
    if (!["daily", "weekly", "monthly"].includes(input.billingPeriod)) throw new Error("invalid billingPeriod");
    if (typeof input.rate !== "number" || input.rate < 0) throw new Error("rate required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: vehicle, error: vErr } = await supabaseAdmin
      .from("vehicles")
      .select("id, status, daily_rate, weekly_rate")
      .eq("id", data.vehicleId)
      .single();
    if (vErr || !vehicle) throw new Error("Vehicle not found");
    if (vehicle.status !== "available") throw new Error("Vehicle is not available");

    const token = genToken();
    const { error } = await supabaseAdmin.from("rental_share_links").insert({
      token,
      vehicle_id: data.vehicleId,
      start_date: data.startDate,
      billing_period: data.billingPeriod,
      rate: data.rate,
      weekly_rate: vehicle.weekly_rate ?? 0,
      daily_rate: vehicle.daily_rate ?? 0,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

/** Send a share link to a phone number via SMS. */
export const sendShareLinkSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; url: string; phone: string; name?: string }) => {
    if (!input.token || input.token.length < 8) throw new Error("invalid token");
    if (!input.url || !/^https?:\/\//.test(input.url)) throw new Error("invalid url");
    if (!input.phone || input.phone.length < 7) throw new Error("phone required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const normalized = normalizePhone(data.phone);
    if (!normalized) {
      await logSmsAttempt({
        token: data.token,
        phone: data.phone,
        recipientName: data.name,
        status: "failed",
        errorMessage: "Invalid phone number format",
        attemptedBy: context.userId,
      });
      throw new Error("Enter a valid phone number (e.g. +1 555 555 5555)");
    }
    const message = `Camauto Rentals: You're invited to rent a vehicle. Complete your application (license + selfie + signature) here: ${data.url}`;
    try {
      await sendSms(normalized, message, data.name ?? null);
      await logSmsAttempt({
        token: data.token,
        phone: normalized,
        recipientName: data.name,
        status: "sent",
        attemptedBy: context.userId,
      });
    } catch (e) {
      console.error("sendShareLinkSms failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      await logSmsAttempt({
        token: data.token,
        phone: normalized,
        recipientName: data.name,
        status: "failed",
        errorMessage: msg,
        attemptedBy: context.userId,
      });
      // Re-throw a friendly message; keep raw detail in server logs above
      if (/GHL/.test(msg) && /4\d\d/.test(msg)) {
        throw new Error("Could not send SMS — check the phone number and try again.");
      }
      throw new Error("Could not send SMS — please try again in a moment.");
    }
    return { ok: true, phone: normalized };
  });

async function logSmsAttempt(entry: {
  token: string;
  phone: string;
  recipientName?: string;
  status: "sent" | "failed";
  errorMessage?: string;
  attemptedBy?: string;
}) {
  try {
    // Look up vehicle id for context (best-effort)
    let vehicleId: string | null = null;
    const { data: link } = await supabaseAdmin
      .from("rental_share_links")
      .select("vehicle_id")
      .eq("token", entry.token)
      .maybeSingle();
    if (link?.vehicle_id) vehicleId = link.vehicle_id;

    await supabaseAdmin.from("share_link_sms_log").insert({
      token: entry.token,
      vehicle_id: vehicleId,
      phone: entry.phone,
      recipient_name: entry.recipientName ?? null,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
      attempted_by: entry.attemptedBy ?? null,
    });
  } catch (e) {
    console.error("logSmsAttempt failed (non-fatal)", e);
  }
}

/** Admin: read share link SMS attempt log. */
export const getShareLinkSmsLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) throw new Error("Admins only");
    const { data, error } = await supabaseAdmin
      .from("share_link_sms_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      token: r.token as string,
      vehicleId: r.vehicle_id as string | null,
      phone: r.phone as string,
      recipientName: r.recipient_name as string | null,
      status: r.status as "sent" | "failed",
      errorMessage: r.error_message as string | null,
      attemptedBy: r.attempted_by as string | null,
      createdAt: r.created_at as string,
    }));
  });

/** Normalize a US-friendly phone number to E.164. Returns null if invalid. */
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Public: load share link details for the customer-facing rental page. */
export const getShareLinkPublic = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    if (!input.token || input.token.length < 8) throw new Error("invalid token");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin.rpc("get_share_link_public", { _token: data.token });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("This rental link is invalid or expired");
    if (row.consumed) throw new Error("This rental link has already been used");
    return {
      token: row.token as string,
      vehicleId: row.vehicle_id as string,
      startDate: row.start_date as string,
      billingPeriod: row.billing_period as string,
      rate: Number(row.rate),
      weeklyRate: Number(row.weekly_rate),
      dailyRate: Number(row.daily_rate),
      vehicle: {
        make: row.vehicle_make as string | null,
        model: row.vehicle_model as string | null,
        year: row.vehicle_year as number | null,
        imageUrl: row.vehicle_image_url as string | null,
      },
    };
  });

/** Public: customer submits the rental application — creates driver + rental, marks vehicle rented. */
export const submitShareApplication = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    fullName: string;
    phone: string;
    email: string;
    licenseNumber: string;
    licenseExpiry: string;
    rideshare: "Uber" | "Lyft" | "Both";
    dateOfBirth?: string;
    address?: string;
    licenseDataUrl: string;
    selfieDataUrl: string;
    signatureDataUrl: string;
  }) => {
    const reqStr = (s: unknown, label: string, max = 200) => {
      if (typeof s !== "string" || !s.trim() || s.length > max) throw new Error(`${label} required`);
    };
    if (!input.token || input.token.length < 8) throw new Error("invalid token");
    reqStr(input.fullName, "Full name");
    reqStr(input.phone, "Phone");
    reqStr(input.email, "Email");
    reqStr(input.licenseNumber, "License number", 60);
    reqStr(input.licenseExpiry, "License expiry", 20);
    if (!["Uber", "Lyft", "Both"].includes(input.rideshare)) throw new Error("Invalid rideshare");
    if (input.dateOfBirth && input.dateOfBirth.length > 20) throw new Error("Invalid DOB");
    if (input.address && input.address.length > 300) throw new Error("Address too long");
    if (!input.licenseDataUrl?.startsWith("data:image/")) throw new Error("License photo required");
    if (!input.selfieDataUrl?.startsWith("data:image/")) throw new Error("Selfie required");
    if (!input.signatureDataUrl?.startsWith("data:image/")) throw new Error("Signature required");
    return input;
  })
  .handler(async ({ data }) => {
    // Reload + validate share link
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("rental_share_links")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (linkErr || !link) throw new Error("Invalid or expired link");
    if (link.consumed_rental_id) throw new Error("This link has already been used");
    if (new Date(link.expires_at).getTime() < Date.now()) throw new Error("This link has expired");

    const { data: vehicle, error: vErr } = await supabaseAdmin
      .from("vehicles")
      .select("id, status")
      .eq("id", link.vehicle_id)
      .single();
    if (vErr || !vehicle) throw new Error("Vehicle not found");
    if (vehicle.status !== "available") throw new Error("This vehicle is no longer available");

    // Create driver
    const driverId = await nextId("drivers", "D", 100);
    const { error: dErr } = await supabaseAdmin.from("drivers").insert({
      id: driverId,
      full_name: data.fullName.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      license_number: data.licenseNumber.trim(),
      license_expiry: data.licenseExpiry,
      insurance_on_file: true,
      rideshare: data.rideshare,
      status: "active",
      date_added: new Date().toISOString().slice(0, 10),
      date_of_birth: data.dateOfBirth || null,
      address: data.address?.trim() || null,
    });
    if (dErr) throw new Error(`Could not create renter: ${dErr.message}`);

    // Create rental
    const rentalId = await nextId("rentals", "R", 500);
    const [signatureUrl, licenseUrl, selfieUrl] = await Promise.all([
      uploadDataUrl(rentalId, "signature", data.signatureDataUrl),
      uploadDataUrl(rentalId, "license", data.licenseDataUrl),
      uploadDataUrl(rentalId, "selfie", data.selfieDataUrl),
    ]);

    const nowIso = new Date().toISOString();
    const { error: rErr } = await supabaseAdmin.from("rentals").insert({
      id: rentalId,
      vehicle_id: link.vehicle_id,
      driver_id: driverId,
      start_date: link.start_date,
      weekly_rate: link.weekly_rate,
      deposit_paid: 0,
      payment_status: "current",
      billing_period: link.billing_period,
      rate: link.rate,
      reservation_status: "pending",
      payment_received: false,
      pending_created_at: nowIso,
      signature_data_url: signatureUrl,
      signed_at: nowIso,
      signed_by: data.fullName.trim(),
      agreement_version: "v1.0",
      client_signature_url: signatureUrl,
      client_signed_at: nowIso,
      license_image_url: licenseUrl,
      selfie_image_url: selfieUrl,
    });
    if (rErr) throw new Error(`Could not create rental: ${rErr.message}`);

    // Mark vehicle rented
    await supabaseAdmin.from("vehicles").update({ status: "rented" }).eq("id", link.vehicle_id);

    // Mark link consumed
    await supabaseAdmin
      .from("rental_share_links")
      .update({ consumed_rental_id: rentalId, consumed_at: nowIso })
      .eq("token", data.token);

    // Acknowledgment SMS
    try {
      await sendSms(
        data.phone.trim(),
        "Camauto Rentals: Thanks! Your application has been received. We'll be in touch shortly to confirm pickup.",
        data.fullName.trim(),
      );
    } catch (e) {
      console.error("ack sms failed", e);
    }

    // Notify admin who created the link
    try {
      if (link.created_by) {
        const { data: adminProfile } = await supabaseAdmin
          .from("profiles")
          .select("phone, full_name")
          .eq("id", link.created_by)
          .maybeSingle();
        if (adminProfile?.phone) {
          await sendSms(
            adminProfile.phone,
            `Camauto Rentals: New rental application received from ${data.fullName.trim()} (${data.phone.trim()}) for vehicle ${link.vehicle_id}. Rental ${rentalId}.`,
            adminProfile.full_name ?? null,
          );
        }
      }
    } catch (e) {
      console.error("admin notify sms failed", e);
    }

    return { ok: true, rentalId };
  });