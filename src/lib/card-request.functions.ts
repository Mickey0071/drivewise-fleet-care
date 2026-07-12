import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";

function stripeErr(e: unknown): string {
  if (e && typeof e === "object") {
    const x = e as { raw?: { message?: string }; message?: string };
    return x.raw?.message ?? x.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}

function genToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveOrigin(provided?: string): string {
  if (provided) {
    try {
      return new URL(provided).origin;
    } catch {
      /* fall through */
    }
  }
  const header = getRequestHeader("origin") || getRequestHeader("referer");
  if (header) {
    try {
      return new URL(header).origin;
    } catch {
      /* fall through */
    }
  }
  return (process.env.PUBLIC_APP_ORIGIN ?? "").replace(/\/+$/, "");
}

interface SendCardRequestInput {
  rentalId: string;
  sendSms?: boolean;
  sendEmail?: boolean;
  origin?: string;
}

/**
 * Staff action — text/email the renter a secure link to add a card on file.
 * This never charges the card; it only saves it to hold the reservation.
 */
export const sendCardRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SendCardRequestInput) => {
    if (!d.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    return d;
  })
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Reservation not found");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, full_name, email, phone")
      .eq("id", rental.driver_id)
      .maybeSingle();
    if (!driver) throw new Error("Renter record not found");

    const phone = driver.phone ?? null;
    const email = driver.email ?? null;
    const wantSms = data.sendSms !== false;
    const wantEmail = data.sendEmail === true;
    if (wantSms && !phone) throw new Error("No phone on file for this renter");
    if (wantEmail && !email) throw new Error("No email on file for this renter");

    const origin = resolveOrigin(data.origin);
    if (!origin) throw new Error("App origin not configured");

    const token = genToken();
    const { error: tokErr } = await supabaseAdmin
      .from("card_requests")
      .insert({ token, driver_id: driver.id, rental_id: rental.id, status: "pending" } as never);
    if (tokErr) throw new Error(tokErr.message);

    const url = `${origin}/add-card/${encodeURIComponent(token)}`;

    const result = await notifyRenter({
      phone: wantSms ? phone : null,
      email: wantEmail ? email : null,
      name: driver.full_name ?? null,
      sms:
        `Camauto Rentals: please add a card on file to hold your reservation. ` +
        `This is NOT a charge — we just need a card on file. Add it securely here: ${url}`,
      emailSubject: "Add a card on file for your reservation",
      emailHeading: "Add a Card on File",
      emailIntro:
        "To hold your reservation, we just need a card on file. " +
        "<strong>This is not a charge</strong> — your card is simply saved securely so we can hold the reservation.",
      emailCta: { label: "Add My Card Securely", url },
      emailFootnote: "This secure link is personal to you and expires in 7 days.",
    });

    if (!result.smsSent && !result.emailSent) {
      throw new Error(result.errors.join("; ") || "Could not send card link");
    }

    return {
      ok: true as const,
      url,
      smsSent: result.smsSent,
      emailSent: result.emailSent,
    };
  });

interface TokenInput {
  token: string;
}

export interface CardRequestLookup {
  found: boolean;
  expired?: boolean;
  status?: string;
  renterName?: string;
}

async function loadRequest(token: string) {
  const { data, error } = await supabaseAdmin
    .from("card_requests")
    .select("token, driver_id, rental_id, status, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Public — resolve a card-request token for the renter-facing page. */
export const getCardRequestByToken = createServerFn({ method: "POST" })
  .inputValidator((d: TokenInput) => {
    if (!d.token || typeof d.token !== "string") throw new Error("token required");
    return d;
  })
  .handler(async ({ data }): Promise<CardRequestLookup> => {
    const req = await loadRequest(data.token);
    if (!req) return { found: false };
    const expired = req.expires_at ? new Date(req.expires_at as string) < new Date() : false;
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name")
      .eq("id", req.driver_id)
      .maybeSingle();
    return {
      found: true,
      expired,
      status: (req.status as string) ?? "pending",
      renterName: (driver?.full_name as string | null) ?? undefined,
    };
  });

interface SetupIntentInput extends TokenInput {
  environment: StripeEnv;
}

export interface CardRequestSetupResult {
  ok: boolean;
  clientSecret?: string;
  error?: string;
}

/** Public — create a SetupIntent for the token's driver (no charge). */
export const createCardRequestSetupIntent = createServerFn({ method: "POST" })
  .inputValidator((d: SetupIntentInput) => {
    if (!d.token || typeof d.token !== "string") throw new Error("token required");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }): Promise<CardRequestSetupResult> => {
    try {
      const req = await loadRequest(data.token);
      if (!req) return { ok: false, error: "This link is invalid." };
      if (req.expires_at && new Date(req.expires_at as string) < new Date())
        return { ok: false, error: "This link has expired." };
      if (req.status === "completed") return { ok: false, error: "A card is already on file." };

      const stripe = createStripeClient(data.environment);
      const { data: driver, error } = await supabaseAdmin
        .from("drivers")
        .select("stripe_customer_id, full_name, email, phone")
        .eq("id", req.driver_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!driver) throw new Error("Renter record not found");

      let customerId = driver.stripe_customer_id as string | null;
      if (!customerId) {
        const created = await stripe.customers.create({
          ...(driver.email ? { email: driver.email } : {}),
          ...(driver.full_name ? { name: driver.full_name } : {}),
          ...(driver.phone ? { phone: driver.phone } : {}),
          metadata: { driver_id: req.driver_id },
        });
        customerId = created.id;
        await supabaseAdmin
          .from("drivers")
          .update({ stripe_customer_id: customerId } as never)
          .eq("id", req.driver_id);
      }

      const si = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { driver_id: req.driver_id, kind: "card_request" },
      });

      return { ok: true, clientSecret: si.client_secret ?? undefined };
    } catch (e) {
      return { ok: false, error: stripeErr(e) };
    }
  });

interface SaveCardInput extends TokenInput {
  paymentMethodId: string;
  environment: StripeEnv;
}

export interface CardRequestSaveResult {
  ok: boolean;
  last4?: string;
  brand?: string;
  error?: string;
}

/** Public — attach the saved card to the driver and mark the request done. */
export const saveCardRequestCard = createServerFn({ method: "POST" })
  .inputValidator((d: SaveCardInput) => {
    if (!d.token || typeof d.token !== "string") throw new Error("token required");
    if (!d.paymentMethodId || typeof d.paymentMethodId !== "string")
      throw new Error("paymentMethodId required");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }): Promise<CardRequestSaveResult> => {
    try {
      const req = await loadRequest(data.token);
      if (!req) return { ok: false, error: "This link is invalid." };

      const stripe = createStripeClient(data.environment);
      const { data: driver, error } = await supabaseAdmin
        .from("drivers")
        .select("stripe_customer_id")
        .eq("id", req.driver_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const customerId = driver?.stripe_customer_id as string | null;

      if (customerId) {
        try {
          await stripe.paymentMethods.attach(data.paymentMethodId, { customer: customerId });
        } catch (e: any) {
          if (e?.code !== "resource_already_exists") throw e;
        }
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: data.paymentMethodId },
        });
      }

      const pm = await stripe.paymentMethods.retrieve(data.paymentMethodId);
      const last4 = pm.card?.last4 ?? null;
      const brand = pm.card?.brand ?? null;
      const expMonth = pm.card?.exp_month ?? null;
      const expYear = pm.card?.exp_year ?? null;

      await supabaseAdmin
        .from("drivers")
        .update({
          stripe_payment_method_id: data.paymentMethodId,
          ...(last4 ? { card_last4: last4 } : {}),
          ...(brand ? { card_brand: brand } : {}),
          ...(expMonth ? { card_exp_month: expMonth } : {}),
          ...(expYear ? { card_exp_year: expYear } : {}),
          card_saved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", req.driver_id);

      await supabaseAdmin
        .from("card_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() } as never)
        .eq("token", data.token);

      return {
        ok: true,
        last4: last4 ?? undefined,
        brand: brand ?? undefined,
      };
    } catch (e) {
      return { ok: false, error: stripeErr(e) };
    }
  });