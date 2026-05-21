import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_PHONE = "+12672213977";

export const chargeViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { rentalId: string; amount: number; description: string }) => {
      if (!input.rentalId) throw new Error("rentalId required");
      const amt = Number(input.amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than zero");
      if (amt > 10000) throw new Error("Amount too large");
      const desc = (input.description || "").trim();
      if (!desc) throw new Error("Description required");
      if (desc.length > 200) throw new Error("Description too long");
      return { rentalId: input.rentalId, amount: amt, description: desc };
    }
  )
  .handler(async ({ data }) => {
    const { rentalId, amount, description } = data;

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, stripe_customer_id, stripe_payment_method_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (rErr || !rental) throw new Error("Rental not found");
    if (!rental.stripe_customer_id || !rental.stripe_payment_method_id) {
      throw new Error("No card on file for this rental");
    }

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
      .select("full_name, phone")
      .eq("id", rental.driver_id)
      .maybeSingle();

    const amountCents = Math.round(amount * 100);

    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: rental.stripe_customer_id as string,
        payment_method: rental.stripe_payment_method_id as string,
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

      if (driver?.phone) {
        await sendSms(
          driver.phone,
          `Rentalprise: Violation charge of $${amount.toFixed(2)} has been charged to your card: ${description}`,
          driver.full_name ?? undefined
        );
      }
      await sendSms(
        ADMIN_PHONE,
        `Rentalprise: ${driver?.full_name ?? rental.driver_id} charged $${amount.toFixed(2)} for ${description}.`,
        "Admin"
      );

      return { ok: true as const, paymentIntentId: pi.id, amount };
    } catch (e: unknown) {
      const err = e as { raw?: { message?: string; payment_intent?: { id?: string } }; message?: string };
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