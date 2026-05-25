import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient } from "@/lib/stripe.server";

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string; name?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error("Invalid userId");
  if (options.userId) {
    const found = await stripe.customers.search({ query: `metadata['userId']:'${options.userId}'`, limit: 1 });
    if (found.data.length) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const c = existing.data[0];
      if (options.userId && c.metadata?.userId !== options.userId) {
        await stripe.customers.update(c.id, { metadata: { ...c.metadata, userId: options.userId } });
      }
      return c.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.name && { name: options.name }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

// Weekly rental subscription with dynamic per-driver amount.
export const createWeeklyRentalCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    amountInCents: number;
    rentalId: string;
    customerEmail?: string;
    customerName?: string;
    userId?: string;
    returnUrl: string;
    environment: StripeEnv;
  }) => {
    if (!data.amountInCents || data.amountInCents < 100) throw new Error("Amount too small");
    if (!data.rentalId) throw new Error("rentalId required");
    return data;
  })
  .handler(async ({ data }) => {
    const stripe = createStripeClient(data.environment);
    const customerId = await resolveOrCreateCustomer(stripe, {
      email: data.customerEmail, userId: data.userId, name: data.customerName,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded_page",
      return_url: data.returnUrl,
      customer: customerId,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Weekly vehicle rental" },
          recurring: { interval: "week" },
          unit_amount: data.amountInCents,
        },
        quantity: 1,
      }],
      automatic_tax: { enabled: false },
      metadata: {
        userId: data.userId ?? "",
        rental_id: data.rentalId,
        kind: "weekly_subscription",
      },
      subscription_data: {
        metadata: {
          userId: data.userId ?? "",
          rental_id: data.rentalId,
        },
      },
    });
    return session.client_secret;
  });

// One-time deposit (2 days advance) at handoff.
export const createDepositCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    amountInCents: number;
    rentalId: string;
    customerEmail?: string;
    customerName?: string;
    userId?: string;
    returnUrl: string;
    environment: StripeEnv;
  }) => {
    if (!data.amountInCents || data.amountInCents < 100) throw new Error("Amount too small");
    if (!data.rentalId) throw new Error("rentalId required");
    return data;
  })
  .handler(async ({ data }) => {
    const stripe = createStripeClient(data.environment);
    const customerId = await resolveOrCreateCustomer(stripe, {
      email: data.customerEmail, userId: data.userId, name: data.customerName,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: data.returnUrl,
      customer: customerId,
      customer_creation: "always",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Rental advance deposit" },
          unit_amount: data.amountInCents,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      metadata: {
        userId: data.userId ?? "",
        rental_id: data.rentalId,
        kind: "deposit",
      },
    });
    return session.client_secret;
  });

// Customer portal (cancel = end at period end is the Stripe default for self-serve cancel).
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) throw new Error("No subscription found");
    const stripe = createStripeClient(data.environment);
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id as string,
      ...(data.returnUrl && { return_url: data.returnUrl }),
    });
    return portal.url;
  });