import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { getRequestHeader } from "@tanstack/react-start/server";

export const chargeViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rentalId: string; amount: number; description: string }) => {
    if (!input.rentalId) throw new Error("rentalId required");
    const amt = Number(input.amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than zero");
    if (amt > 10000) throw new Error("Amount too large");
    const desc = (input.description || "").trim();
    if (!desc) throw new Error("Description required");
    if (desc.length > 200) throw new Error("Description too long");
    return { rentalId: input.rentalId, amount: amt, description: desc };
  })
  .handler(async ({ data }) => {
    const { rentalId, amount, description } = data;

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, stripe_customer_id, stripe_payment_method_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (rErr || !rental) throw new Error("Rental not found");

    const { data: subRow } = await supabaseAdmin
      .from("subscriptions")
      .select("environment")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const env: StripeEnv = (subRow?.environment as StripeEnv) || "sandbox";
    const stripe = createStripeClient(env);

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, phone, email")
      .eq("id", rental.driver_id)
      .maybeSingle();

    const amountCents = Math.round(amount * 100);

    let stripeCustomerId = (rental.stripe_customer_id as string | null) || null;
    const stripePaymentMethodId = (rental.stripe_payment_method_id as string | null) || null;

    if (stripePaymentMethodId && !stripeCustomerId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
        const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
        if (pmCustomer) {
          stripeCustomerId = pmCustomer;
          await supabaseAdmin
            .from("rentals")
            .update({
              stripe_customer_id: pmCustomer,
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", rentalId);
        }
      } catch (e) {
        console.warn("[chargeViolation] could not recover customer from saved payment method", e);
      }
    }

    // ---- No reusable saved card on file: send a one-off Stripe Payment Link ----
    if (!stripeCustomerId || !stripePaymentMethodId) {
      if (!driver?.phone && !driver?.email) {
        throw new Error("Renter has no phone or email on file — cannot send payment link");
      }
      const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
      let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
      if (originHeader) {
        try {
          origin = new URL(originHeader).origin;
        } catch {
          /* keep default */
        }
      }
      const note = `Violation: ${description}`.slice(0, 200);
      const metadata = {
        kind: "custom_renter_payment",
        rental_id: rentalId,
        note,
      };
      const product = await stripe.products.create({
        name: `Camauto Rentals — ${note}`.slice(0, 250),
        metadata: { rental_id: rentalId },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: amountCents,
      });
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata,
        customer_creation: "always",
        payment_intent_data: { metadata, setup_future_usage: "off_session" },
        ...(origin
          ? {
              after_completion: {
                type: "redirect" as const,
                redirect: {
                  url: `${origin}/my-rentals/${encodeURIComponent(rentalId)}?paid=1`,
                },
              },
            }
          : {}),
        restrictions: { completed_sessions: { limit: 1 } },
      });
      if (!link.url) throw new Error("Stripe did not return a payment link URL");

      const amt = `$${amount.toFixed(2)}`;
      await notifyRenter({
        phone: driver?.phone ?? null,
        email: driver?.email ?? null,
        name: driver?.full_name ?? null,
        sms: `Camauto Rentals: Violation charge of ${amt} — ${description}. Pay: ${link.url}`,
        emailSubject: "Violation Charge — Camauto Rentals",
        emailHeading: "Violation Charge",
        emailIntro: `A violation charge of <strong>${amt}</strong> has been issued: ${description}. Tap below to pay securely.`,
        emailCta: { label: `Pay ${amt} Now`, url: link.url },
        emailDetails: [
          { label: "Amount", value: amt },
          { label: "Description", value: description },
        ],
      });

      await supabaseAdmin.from("rental_charges").insert({
        rental_id: rentalId,
        amount,
        period_label: `violation: ${description}`,
        status: "pending",
        error_msg: "Awaiting renter payment via link",
        environment: env,
      } as never);

      return { ok: true as const, mode: "link" as const, url: link.url, amount };
    }

    // ---- Card on file: charge it now ----
    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomerId,
        payment_method: stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Violation: ${description} (rental ${rentalId})`,
        metadata: { rental_id: rentalId, kind: "violation", description },
      });

      if (pi.status !== "succeeded") {
        await supabaseAdmin.from("rental_charges").insert({
          rental_id: rentalId,
          amount,
          period_label: `violation: ${description}`,
          status: "failed",
          error_msg: `PI status: ${pi.status}`,
          stripe_payment_intent_id: pi.id,
          environment: env,
        } as never);
        throw new Error(`Charge not completed (status: ${pi.status})`);
      }

      await supabaseAdmin.from("rental_charges").insert({
        rental_id: rentalId,
        amount,
        period_label: `violation: ${description}`,
        status: "succeeded",
        stripe_payment_intent_id: pi.id,
        environment: env,
      } as never);

      await supabaseAdmin.from("payments").insert({
        id: `VL-${pi.id.slice(-10)}`,
        rental_id: rentalId,
        driver_id: rental.driver_id,
        amount,
        due_date: new Date().toISOString().slice(0, 10),
        paid_date: new Date().toISOString().slice(0, 10),
        method: "Stripe",
        status: "paid",
      } as never);

      if (driver?.phone || driver?.email) {
        const amt = `$${amount.toFixed(2)}`;
        let last4: string | null = null;
        try {
          const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
          last4 = pm.card?.last4 ?? null;
        } catch {
          /* non-fatal */
        }
        const cardLabel = last4 ? ` ending in ${last4}` : "";
        await notifyRenter({
          phone: driver?.phone ?? null,
          email: driver?.email ?? null,
          name: driver?.full_name ?? null,
          sms: `Camauto Rentals charged your card${cardLabel} ${amt} for ${description}. Questions? Contact 866-625-5550`,
          emailSubject: "Violation Charged — Camauto Rentals",
          emailHeading: "Violation Charged",
          emailIntro: `A violation charge of <strong>${amt}</strong> has been charged to your card${cardLabel ? ` <strong>${cardLabel.trim()}</strong>` : " on file"}: ${description}.`,
          emailDetails: [
            { label: "Amount", value: amt },
            { label: "Description", value: description },
            ...(last4 ? [{ label: "Card", value: `•••• ${last4}` }] : []),
          ],
        });
      }

      return { ok: true as const, mode: "charged" as const, paymentIntentId: pi.id, amount };
    } catch (e: unknown) {
      const err = e as {
        raw?: { message?: string; payment_intent?: { id?: string } };
        message?: string;
      };
      const msg = err?.raw?.message || err?.message || String(e);
      await supabaseAdmin.from("rental_charges").insert({
        rental_id: rentalId,
        amount,
        period_label: `violation: ${description}`,
        status: "failed",
        error_msg: msg.slice(0, 500),
        stripe_payment_intent_id: err?.raw?.payment_intent?.id ?? null,
        environment: env,
      } as never);
      throw new Error(msg);
    }
  });
