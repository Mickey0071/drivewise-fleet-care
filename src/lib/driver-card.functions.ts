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
      return { ok: false, error: getStripeErrorMessage(e) };
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
      return { ok: false, error: getStripeErrorMessage(e) };
    }
  });
