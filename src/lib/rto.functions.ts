import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "@/lib/stripe.server";

function genToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

/** Text the renter a link to sign the rent-to-own agreement. */
export const sendRtoSignLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { contractId: string; origin: string }) => {
    if (!d.contractId) throw new Error("contractId required");
    if (!/^https?:\/\//.test(d.origin)) throw new Error("origin required");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyRenter } = await import("@/lib/renter-notify.server");
    const { data: c } = await supabaseAdmin.from("rto_contracts").select("*").eq("id", data.contractId).single();
    if (!c) throw new Error("Contract not found");
    if (!c.phone) throw new Error("Add the customer's phone first");
    const token = c.sign_token || genToken();
    await supabaseAdmin.from("rto_contracts").update({
      sign_token: token, sent_at: new Date().toISOString(),
      status: c.status === "draft" ? "sent" : c.status,
    }).eq("id", c.id);
    const link = `${data.origin.replace(/\/$/, "")}/rto-sign/${token}`;
    const res = await notifyRenter({
      phone: c.phone, email: c.email || null, name: c.customer_name || null,
      sms: `CAM Auto Rentals: Please review and sign your Rent-To-Own Agreement here: ${link}`,
      emailSubject: "Your CAM Auto Rent-To-Own Agreement",
      emailHeading: "Sign Your Rent-To-Own Agreement",
      emailIntro: "Please review and sign your Rent-To-Own Agreement online.",
      emailCta: { label: "Review & Sign", url: link },
    });
    if (!res.smsSent && !res.emailSent) throw new Error(res.errors.join("; ") || "Could not send");
    return { ok: true, link };
  });

/** Public: load a contract by its signing token (safe fields only). */
export const getRtoByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d.token || !/^[a-f0-9]{32}$/.test(d.token)) throw new Error("Invalid link");
    return d;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("rto_contracts")
      .select("id, customer_name, address, city_state_zip, phone, email, license_number, vehicle_year, vehicle_make, vehicle_model, vehicle_color, vin, plate, odometer, agreement_date, down_payment, weekly_amount, num_payments, late_fee_per_day, cancel_fee, first_due_date, status, signed_at, customer_signed_name")
      .eq("sign_token", data.token).maybeSingle();
    if (!c || c.status === "cancelled") throw new Error("This link is no longer valid");
    return c;
  });

/** Public: renter signs. Token is the only credential. */
export const signRto = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; name: string; signature: string }) => {
    if (!/^[a-f0-9]{32}$/.test(d.token || "")) throw new Error("Invalid link");
    if (!d.name?.trim() || d.name.length > 120) throw new Error("Type your full name");
    if (!/^data:image\/png;base64,/.test(d.signature || "") || d.signature.length > 600_000) throw new Error("Signature required");
    return d;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("rto_contracts")
      .select("id, status, customer_name, vehicle_year, vehicle_make, vehicle_model, plate")
      .eq("sign_token", data.token).maybeSingle();
    if (!c || c.status === "cancelled") throw new Error("This link is no longer valid");
    if (c.status === "signed" || c.status === "active" || c.status === "completed") return { ok: true, already: true };
    const { error } = await supabaseAdmin.from("rto_contracts").update({
      customer_signature: data.signature, customer_signed_name: data.name.trim(),
      signed_at: new Date().toISOString(), status: "signed", staff_seen: false,
    }).eq("id", c.id);
    if (error) throw new Error("Could not save signature");
    try {
      const { sendAdminSmsIfEnabled } = await import("@/lib/alerts.server");
      const origin = process.env.PUBLIC_APP_ORIGIN || "";
      await sendAdminSmsIfEnabled(`CAM Auto: ${data.name.trim()} signed the Rent-To-Own agreement for ${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model} ${c.plate}. ${origin}/rent-to-own`);
    } catch (e) { console.error("[rto] admin sms failed", e); }
    return { ok: true };
  });

/** Text a Stripe payment link; the webhook records it and lowers the balance. */
export const sendRtoPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { contractId: string; amountCents: number; label: string; environment: StripeEnv }) => {
    if (!d.contractId) throw new Error("contractId required");
    if (!Number.isFinite(d.amountCents) || d.amountCents < 50) throw new Error("Amount must be at least $0.50");
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createStripeClient } = await import("@/lib/stripe.server");
    const { notifyRenter } = await import("@/lib/renter-notify.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { data: c } = await supabaseAdmin.from("rto_contracts").select("*").eq("id", data.contractId).single();
    if (!c?.phone) throw new Error("Customer has no phone on file");
    let origin = process.env.PUBLIC_APP_ORIGIN || "";
    try { const h = getRequestHeader("origin") || getRequestHeader("referer"); if (h) origin = new URL(h).origin; } catch { /* keep */ }
    const stripe = createStripeClient(data.environment);
    const metadata = { kind: "rto_payment", rto_contract_id: c.id };
    const desc = `Rent-To-Own ${data.label} — ${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model}`.slice(0, 200);
    const product = await stripe.products.create({ name: desc, metadata });
    const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: Math.round(data.amountCents) });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      ...(origin ? { after_completion: { type: "redirect" as const, redirect: { url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}` } } } : {}),
      restrictions: { completed_sessions: { limit: 1 } },
    });
    const amt = `$${(data.amountCents / 100).toFixed(2)}`;
    await notifyRenter({
      phone: c.phone, email: c.email || null, name: c.customer_name || null,
      sms: `CAM Auto Rentals: Your Rent-To-Own payment of ${amt} is due. Pay securely: ${link.url}`,
      emailSubject: "Rent-To-Own Payment — CAM Auto Rentals",
      emailHeading: "Rent-To-Own Payment",
      emailIntro: `Your payment of <strong>${amt}</strong> is ready.`,
      emailCta: { label: `Pay ${amt}`, url: link.url },
    });
    return { ok: true, url: link.url };
  });

/** Webhook helper: record a completed Stripe rent-to-own payment once. */
export async function recordRtoStripePayment(session: { id: string; amount_total?: number | null; metadata?: Record<string, string> | null }) {
  const contractId = session.metadata?.rto_contract_id;
  if (!contractId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const amount = Number(session.amount_total || 0) / 100;
  const { error } = await supabaseAdmin.from("rto_payments").insert({
    contract_id: contractId, amount, late_fee: 0, method: "card", note: "Paid by payment link", stripe_session_id: session.id,
  });
  if (error && !String(error.message).includes("duplicate")) throw error;
  if (!error) {
    try {
      const { sendAdminSmsIfEnabled } = await import("@/lib/alerts.server");
      await sendAdminSmsIfEnabled(`CAM Auto: Rent-To-Own payment of $${amount.toFixed(2)} received online.`);
    } catch { /* ignore */ }
  }
}
