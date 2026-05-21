import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_PHONE = "+12672213977";
const PORTAL_BASE = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";

function addInterval(from: Date, cadence: "daily" | "weekly"): Date {
  const d = new Date(from);
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

function fmtDateShort(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
}

export const Route = createFileRoute("/api/public/hooks/auto-renew-charges")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = request.headers.get("x-cron-secret");
        const apiKey = request.headers.get("apikey");
        const validCronSecret = !!cronSecret && cronSecret === process.env.CRON_SECRET;
        const validApiKey = !!apiKey && apiKey === process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!validCronSecret && !validApiKey) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const results: Array<Record<string, unknown>> = [];

        // Find active rentals that have a stored payment method.
        const { data: rentals, error } = await supabaseAdmin
          .from("rentals")
          .select(
            "id, driver_id, vehicle_id, activated_at, reservation_status, billing_cadence, billing_period, rate_amount, rate, weekly_rate, stripe_customer_id, stripe_payment_method_id, auto_renew, end_date"
          )
          .eq("reservation_status", "active")
          .not("stripe_customer_id", "is", null)
          .not("stripe_payment_method_id", "is", null);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        for (const r of rentals ?? []) {
          try {
            if (r.auto_renew === false) {
              results.push({ rentalId: r.id, skipped: "auto_renew_off" });
              continue;
            }

            const cadence: "daily" | "weekly" =
              (r.billing_cadence as "daily" | "weekly") ||
              (r.billing_period === "daily" ? "daily" : "weekly");

            const amount = Number(r.rate_amount ?? r.rate ?? r.weekly_rate ?? 0);
            if (!amount || amount < 1) {
              results.push({ rentalId: r.id, skipped: "no_amount" });
              continue;
            }

            // Determine the next charge due date.
            // Start from activated_at; advance by cadence for each succeeded charge.
            // The initial Stripe checkout counts as the first paid period, so the
            // first auto-renewal is due activated_at + 1 cadence period.
            const activated = r.activated_at ? new Date(r.activated_at as string) : null;
            if (!activated) {
              results.push({ rentalId: r.id, skipped: "no_activated_at" });
              continue;
            }

            const { data: priorCharges } = await supabaseAdmin
              .from("rental_charges")
              .select("status, charge_date")
              .eq("rental_id", r.id)
              .order("charge_date", { ascending: false });

            const succeededCount = (priorCharges ?? []).filter((c) => c.status === "succeeded").length;
            const lastAttempt = (priorCharges ?? [])[0];

            // periods_paid = 1 (initial checkout) + succeeded auto-charges.
            // Next charge is due exactly periods_paid intervals after activation.
            let nextDue = new Date(activated);
            for (let i = 0; i < succeededCount + 1; i++) nextDue = addInterval(nextDue, cadence);

            if (nextDue.getTime() > now.getTime()) {
              results.push({ rentalId: r.id, skipped: "not_due", next_due: nextDue.toISOString() });
              continue;
            }

            // If the last attempt failed, only retry once per 24h.
            if (lastAttempt && lastAttempt.status === "failed") {
              const ageMs = now.getTime() - new Date(lastAttempt.charge_date).getTime();
              if (ageMs < 23 * 60 * 60 * 1000) {
                results.push({ rentalId: r.id, skipped: "retry_cooldown" });
                continue;
              }
            }

            // Resolve Stripe env from the most recent subscriptions row for this rental.
            const { data: subRow } = await supabaseAdmin
              .from("subscriptions")
              .select("environment")
              .eq("rental_id", r.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const env: StripeEnv = (subRow?.environment as StripeEnv) || "sandbox";
            const stripe = createStripeClient(env);

            const amountCents = Math.round(amount * 100);
            const { data: driver } = await supabaseAdmin
              .from("drivers")
              .select("phone, full_name")
              .eq("id", r.driver_id)
              .maybeSingle();

            try {
              const pi = await stripe.paymentIntents.create({
                amount: amountCents,
                currency: "usd",
                customer: r.stripe_customer_id as string,
                payment_method: r.stripe_payment_method_id as string,
                off_session: true,
                confirm: true,
                description: `Auto-renewal (${cadence}) for rental ${r.id}`,
                metadata: { rental_id: r.id, kind: "auto_renewal", cadence },
              });

              const success = pi.status === "succeeded";
              await supabaseAdmin.from("rental_charges").insert({
                rental_id: r.id,
                amount,
                period_label: cadence,
                status: success ? "succeeded" : "failed",
                error_msg: success ? null : `PI status: ${pi.status}`,
                stripe_payment_intent_id: pi.id,
                environment: env,
              } as any);

              if (success) {
                // Extend reservation end date by one cadence period.
                const extendFrom = r.end_date
                  ? new Date(r.end_date as string)
                  : new Date(now);
                const newEnd = addInterval(extendFrom, cadence);
                await supabaseAdmin
                  .from("rentals")
                  .update({
                    end_date: newEnd.toISOString().slice(0, 10),
                    current_period_end: newEnd.toISOString().slice(0, 10),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", r.id);

                // Record the payment in the ledger
                await supabaseAdmin.from("payments").insert({
                  id: `PM-${pi.id.slice(-10)}`,
                  rental_id: r.id,
                  driver_id: r.driver_id,
                  amount,
                  due_date: now.toISOString().slice(0, 10),
                  paid_date: now.toISOString().slice(0, 10),
                  method: "Stripe",
                  status: "paid",
                } as any);

                if (driver?.phone) {
                  const days = cadence === "daily" ? 1 : 7;
                  await sendSms(
                    driver.phone,
                    `Rentalprise Auto: Payment processed ($${amount.toFixed(2)}). Rental extended ${days} day${days === 1 ? "" : "s"}.`,
                    driver.full_name
                  );
                }
                results.push({ rentalId: r.id, charged: amount, status: "succeeded" });
              } else {
                results.push({ rentalId: r.id, charged: amount, status: pi.status });
              }
            } catch (e: any) {
              const msg = e?.raw?.message || e?.message || String(e);
              await supabaseAdmin.from("rental_charges").insert({
                rental_id: r.id,
                amount,
                period_label: cadence,
                status: "failed",
                error_msg: msg.slice(0, 500),
                stripe_payment_intent_id: e?.raw?.payment_intent?.id ?? null,
                environment: env,
              } as any);

              const portalUrl = `${PORTAL_BASE}/rent/portal/${r.id}`;
              if (driver?.phone) {
                await sendSms(
                  driver.phone,
                  `Rentalprise Auto: Your payment was declined. Update your card here to keep your rental active: ${portalUrl}`,
                  driver.full_name
                );
              }
              await sendSms(
                ADMIN_PHONE,
                `Rentalprise: ${driver?.full_name ?? r.driver_id} payment declined ${fmtDateShort(now)} ($${amount.toFixed(2)}, rental ${r.id}).`,
                "Admin"
              );
              results.push({ rentalId: r.id, status: "failed", error: msg });
            }
          } catch (e: any) {
            results.push({ rentalId: r.id, error: e?.message ?? String(e) });
          }
        }

        return Response.json({ ok: true, processed: rentals?.length ?? 0, results });
      },
    },
  },
});