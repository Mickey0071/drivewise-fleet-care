import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

function stripeErr(e: unknown): string {
  if (e && typeof e === "object") {
    const x = e as { raw?: { message?: string }; message?: string };
    return x.raw?.message ?? x.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}

interface SetupIntentInput {
  driverId: string;
  environment: StripeEnv;
}

export interface SetupIntentResult {
  ok: boolean;
  clientSecret?: string;
  customerId?: string;
  error?: string;
}

/**
 * Ensure the driver has a reusable Stripe customer, then create a SetupIntent
 * so the admin can collect and save a card on file via Stripe Elements.
 */
export const createDriverSetupIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SetupIntentInput) => {
    if (!d.driverId || typeof d.driverId !== "string") throw new Error("driverId required");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }): Promise<SetupIntentResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const { data: driver, error } = await supabaseAdmin
        .from("drivers")
        .select("stripe_customer_id, full_name, email, phone")
        .eq("id", data.driverId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!driver) throw new Error("Driver not found");

      let customerId = driver.stripe_customer_id as string | null;
      if (!customerId) {
        const created = await stripe.customers.create({
          ...(driver.email ? { email: driver.email } : {}),
          ...(driver.full_name ? { name: driver.full_name } : {}),
          ...(driver.phone ? { phone: driver.phone } : {}),
          metadata: { driver_id: data.driverId },
        });
        customerId = created.id;
        await supabaseAdmin
          .from("drivers")
          .update({ stripe_customer_id: customerId } as never)
          .eq("id", data.driverId);
      }

      const si = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { driver_id: data.driverId },
      });

      return { ok: true, clientSecret: si.client_secret ?? undefined, customerId };
    } catch (e) {
      return { ok: false, error: stripeErr(e) };
    }
  });

interface SaveCardInput {
  driverId: string;
  paymentMethodId: string;
  environment: StripeEnv;
}

export interface SaveCardResult {
  ok: boolean;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  error?: string;
}

/**
 * After a SetupIntent succeeds, attach the new card as the default payment
 * method on the driver's customer and persist its display details.
 */
export const saveDriverCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SaveCardInput) => {
    if (!d.driverId || typeof d.driverId !== "string") throw new Error("driverId required");
    if (!d.paymentMethodId || typeof d.paymentMethodId !== "string")
      throw new Error("paymentMethodId required");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }): Promise<SaveCardResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const { data: driver, error } = await supabaseAdmin
        .from("drivers")
        .select("stripe_customer_id")
        .eq("id", data.driverId)
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
        .eq("id", data.driverId);

      return {
        ok: true,
        last4: last4 ?? undefined,
        brand: brand ?? undefined,
        expMonth: expMonth ?? undefined,
        expYear: expYear ?? undefined,
      };
    } catch (e) {
      return { ok: false, error: stripeErr(e) };
    }
  });

interface ChargeCardInput {
  driverId: string;
  amountCents: number;
  description?: string;
  environment: StripeEnv;
}

export interface ChargeCardResult {
  ok: boolean;
  last4?: string;
  brand?: string;
  declined?: boolean;
  error?: string;
}

/**
 * Charge the driver's saved card on file immediately (off-session). Used by the
 * "Charge Card" button on the reservation card. The caller records the paid
 * receipt into the store on success so it flows into balance + P&L.
 */
export const chargeCardOnFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ChargeCardInput) => {
    if (!d.driverId || typeof d.driverId !== "string") throw new Error("driverId required");
    if (!Number.isFinite(d.amountCents) || d.amountCents < 50)
      throw new Error("Amount must be at least $0.50");
    if (d.amountCents > 1_000_000) throw new Error("Amount too large");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }): Promise<ChargeCardResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const { data: driver, error } = await supabaseAdmin
        .from("drivers")
        .select("stripe_customer_id, stripe_payment_method_id, card_last4, card_brand, card_exp_month, card_exp_year")
        .eq("id", data.driverId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const customerId = driver?.stripe_customer_id as string | null;
      const paymentMethodId = driver?.stripe_payment_method_id as string | null;
      if (!customerId || !paymentMethodId) {
        return { ok: false, error: "No card on file for this renter." };
      }

      const expMonth = driver?.card_exp_month as number | null;
      const expYear = driver?.card_exp_year as number | null;
      if (expMonth && expYear) {
        const now = new Date();
        const expired =
          expYear < now.getFullYear() ||
          (expYear === now.getFullYear() && expMonth < now.getMonth() + 1);
        if (expired) {
          return { ok: false, error: "Card expired. Use Send Payment Link instead." };
        }
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount: Math.round(data.amountCents),
          currency: "usd",
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: (data.description || "Camauto Rentals payment").slice(0, 250),
          metadata: { driver_id: data.driverId, kind: "card_on_file_charge" },
        });
        if (pi.status !== "succeeded") {
          return { ok: false, declined: true, error: `Charge ${pi.status}. Try again or use Send Payment Link.` };
        }
        return {
          ok: true,
          last4: (driver?.card_last4 as string | null) ?? undefined,
          brand: (driver?.card_brand as string | null) ?? undefined,
        };
      } catch (e: any) {
        if (e?.type === "StripeCardError" || e?.code === "card_declined") {
          return { ok: false, declined: true, error: "Card declined. Try again or use Send Payment Link." };
        }
        throw e;
      }
    } catch (e) {
      return { ok: false, error: stripeErr(e) };
    }
  });
