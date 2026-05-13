import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

async function getProfile(userId: string | null): Promise<{ phone: string | null; full_name: string | null } | null> {
  if (!userId) return null;
  const { data } = await getSupabase()
    .from("profiles")
    .select("phone, full_name")
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

function fmtAmount(cents: number | null | undefined): string {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId || null;
  const rentalId = session.metadata?.rental_id || null;
  const kind = session.metadata?.kind || (session.mode === "subscription" ? "subscription" : "deposit");

  if (kind === "deposit") {
    await getSupabase().from("subscriptions").insert({
      user_id: userId,
      rental_id: rentalId,
      stripe_customer_id: session.customer,
      stripe_session_id: session.id,
      kind: "deposit",
      amount_cents: session.amount_total ?? null,
      status: "paid",
      environment: env,
    } as any);
    // Business logic: deposit paid → unlock vehicle handoff (handled via row in subs table; UI reads it)
    const profile = await getProfile(userId);
    if (profile?.phone) {
      const amt = fmtAmount(session.amount_total);
      await sendSms(
        profile.phone,
        `Rentalprise Auto: Your deposit ${amt ? amt + " " : ""}has been received. We'll be in touch shortly to coordinate vehicle handoff.`,
        profile.full_name
      );
    }
  }
}

async function handleSubscriptionCreated(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId || null;
  const rentalId = subscription.metadata?.rental_id || null;
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase().from("subscriptions").upsert(
    {
      user_id: userId,
      rental_id: rentalId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      product_id: productId,
      price_id: priceId,
      kind: "subscription",
      amount_cents: item?.price?.unit_amount ?? null,
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      environment: env,
      updated_at: new Date().toISOString(),
    } as any,
    { onConflict: "stripe_subscription_id" }
  );

  const profile = await getProfile(userId);
  if (profile?.phone) {
    const amt = fmtAmount(item?.price?.unit_amount);
    await sendSms(
      profile.phone,
      `Rentalprise Auto: Your rental subscription is active${amt ? " (" + amt + ")" : ""}. Welcome aboard!`,
      profile.full_name
    );
  }
}

async function handleSubscriptionUpdated(subscription: any, env: StripeEnv) {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  // Detect a cancel-at-period-end transition by comparing to the existing row.
  const { data: existing } = await getSupabase()
    .from("subscriptions")
    .select("user_id, cancel_at_period_end")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await getSupabase().from("subscriptions").update({
    status: subscription.status,
    product_id: productId,
    price_id: priceId,
    amount_cents: item?.price?.unit_amount ?? null,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end || false,
    updated_at: new Date().toISOString(),
  } as any).eq("stripe_subscription_id", subscription.id).eq("environment", env);

  const justCanceled = !existing?.cancel_at_period_end && subscription.cancel_at_period_end;
  if (justCanceled) {
    const profile = await getProfile(existing?.user_id || null);
    if (profile?.phone) {
      const endsAt = periodEnd ? new Date(periodEnd * 1000).toLocaleDateString("en-US") : "the end of your current period";
      await sendSms(
        profile.phone,
        `Rentalprise Auto: Your subscription has been canceled. You'll retain access until ${endsAt}.`,
        profile.full_name
      );
    }
  }
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  // Cancel = end at period end. Stripe fires this when the period actually ends.
  await getSupabase().from("subscriptions").update({
    status: "canceled",
    updated_at: new Date().toISOString(),
  } as any).eq("stripe_subscription_id", subscription.id).eq("environment", env);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object, env);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});