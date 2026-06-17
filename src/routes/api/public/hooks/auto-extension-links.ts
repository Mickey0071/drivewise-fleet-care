import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { sendSms } from "@/lib/ghl.server";
import { createStripeClient } from "@/lib/stripe.server";
import {
  getNotificationSetting,
  isNotificationEnabled,
} from "@/lib/notifications.server";

const ORIGIN = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
const ADMIN_PHONE = "267-221-3977";

function genToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Resolve the per-period rate (daily or weekly) for a rental from its own
 *  rate fields, falling back to the vehicle's configured rates. */
function resolvePeriodRate(
  isDaily: boolean,
  rental: { billing_period: string | null; rate: number | null; weekly_rate: number | null },
  vehicle: { daily_rate: number | null; weekly_rate: number | null } | null,
): number {
  const rentalIsDaily = (rental.billing_period || "").toLowerCase().startsWith("day");
  let weekly =
    Number(rental.weekly_rate ?? 0) ||
    (!rentalIsDaily ? Number(rental.rate ?? 0) : 0) ||
    Number(vehicle?.weekly_rate ?? 0);
  let daily =
    (rentalIsDaily ? Number(rental.rate ?? 0) : 0) ||
    Number(vehicle?.daily_rate ?? 0) ||
    (weekly ? round2(weekly / 7) : 0);
  if (!weekly && daily) weekly = round2(daily * 7);
  return isDaily ? round2(daily) : round2(weekly);
}

/** Apply a fully-paid auto-renewal: advance end date, record payment +
 *  extension rows. Mirrors the payments webhook admin_extension path. */
async function applyAutoExtension(args: {
  rentalId: string;
  driverId: string;
  isDaily: boolean;
  amount: number;
  prevEndDate: string | null;
  paymentIntentId: string;
}): Promise<string> {
  const { rentalId, driverId, isDaily, amount, prevEndDate, paymentIntentId } = args;
  const today = ymd(new Date());
  const base = prevEndDate ? new Date(prevEndDate + "T00:00:00Z") : new Date();
  const newEnd = new Date(base);
  newEnd.setUTCDate(newEnd.getUTCDate() + (isDaily ? 1 : 7));
  const newEndIso = ymd(newEnd);
  const periodLabel = isDaily ? "day" : "week";

  const paidId = `PM-${paymentIntentId.slice(-12)}`;
  await supabaseAdmin.from("payments").upsert(
    {
      id: paidId,
      rental_id: rentalId,
      driver_id: driverId,
      amount,
      due_date: today,
      paid_date: today,
      method: "Stripe (auto-renew)",
      status: "paid",
      note: `Auto-renew: +1 ${periodLabel}`,
    } as any,
    { onConflict: "id" },
  );

  const extRowId = `EXT-${paymentIntentId.slice(-12)}`;
  await supabaseAdmin.from("rental_extensions").upsert(
    {
      id: extRowId,
      rental_id: rentalId,
      previous_end_date: prevEndDate,
      new_end_date: newEndIso,
      periods: 1,
      period_label: periodLabel,
      additional_amount: amount,
      payment_id: paidId,
    } as any,
    { onConflict: "id" },
  );

  await supabaseAdmin
    .from("rentals")
    .update({ end_date: newEndIso, updated_at: new Date().toISOString() })
    .eq("id", rentalId);

  return newEndIso;
}

/** Whole-day difference (today - dateStr) using UTC calendar days. */
function daysSince(dateStr: string | null | undefined, today: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? dateStr + "T00:00:00Z" : dateStr);
  if (isNaN(d.getTime())) return null;
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

export const Route = createFileRoute("/api/public/hooks/auto-extension-links")({
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

        // Respect the Notifications tab toggle for Auto-Extension Links.
        if (!(await isNotificationEnabled("auto_extension_links"))) {
          return Response.json({ ok: true, skipped: "auto_extension_links_disabled" });
        }
        const setting = await getNotificationSetting("auto_extension_links");
        const smsTemplate =
          setting?.message_template || "Hi [Customer Name], it's time to extend your rental! Click to extend: [link]";
        const adminPendingEnabled = await isNotificationEnabled("extension_pending");

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayIso = ymd(yesterday);
        const todayIso = ymd(today);

        const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
        const stripe = createStripeClient(env);

        const { data: rentals, error } = await supabaseAdmin
          .from("rentals")
          .select(
            "id, driver_id, vehicle_id, billing_period, billing_cadence, rate, weekly_rate, end_date, signed_at, client_signed_at, activated_at, start_date, reservation_status, auto_renew, last_auto_renew_date",
          )
          .eq("reservation_status", "active")
          .or("auto_renew.is.null,auto_renew.eq.true");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const results: Array<Record<string, unknown>> = [];

        for (const r of rentals ?? []) {
          try {
            const cadence = (
              (r.billing_cadence as string) ||
              (r.billing_period as string) ||
              "weekly"
            ).toLowerCase();
            const isDaily = cadence.startsWith("day");

            let eligible = false;
            if (isDaily) {
              // Daily: rental ended yesterday (today is the morning after).
              eligible = r.end_date != null && String(r.end_date).slice(0, 10) === yesterdayIso;
            } else {
              // Weekly: 8th morning after the sign date.
              const signDate =
                (r.signed_at as string) ||
                (r.client_signed_at as string) ||
                (r.activated_at as string) ||
                (r.start_date as string) ||
                null;
              eligible = daysSince(signDate, today) === 8;
            }
            if (!eligible) {
              results.push({ rentalId: r.id, skipped: "not_due" });
              continue;
            }

            // Per-period re-arm: only process once per cycle. If we already
            // ran auto-renew for this rental today, skip.
            if (r.last_auto_renew_date && String(r.last_auto_renew_date).slice(0, 10) === todayIso) {
              results.push({ rentalId: r.id, skipped: "already_processed_today" });
              continue;
            }

            const { data: drv } = await supabaseAdmin
              .from("drivers")
              .select("full_name, phone, email, stripe_customer_id, stripe_payment_method_id")
              .eq("id", r.driver_id)
              .maybeSingle();

            const token = genToken();
            const offerType = isDaily ? "daily" : "weekly";
            const { error: insErr } = await supabaseAdmin
              .from("auto_extension_offers")
              .insert({ token, rental_id: r.id, offer_type: offerType, status: "pending" } as any);
            if (insErr) {
              results.push({ rentalId: r.id, error: insErr.message });
              continue;
            }

            const link = `${ORIGIN}/auto-extend/${encodeURIComponent(token)}`;
            const customerName = drv?.full_name || "there";
            const sms = smsTemplate
              .replace(/\[Customer Name\]/gi, customerName)
              .replace(/\[link\]/gi, link);

            if (drv?.phone) {
              await notifyRenter({
                phone: drv.phone,
                email: drv.email ?? null,
                name: drv.full_name,
                sms,
                emailSubject: "Time to extend your Camauto Rentals rental",
                emailHeading: "Extend Your Rental",
                emailIntro:
                  "It's time to extend your rental. Choose a daily or weekly extension, sign, and pay in one secure step.",
                emailCta: { label: "Extend My Rental", url: link },
              });
            }

            // Attempt an off-session auto-charge of the saved card. The renter
            // still has the link above to decline before/after.
            let autoCharged = false;
            let chargeError: string | null = null;
            if (drv?.stripe_customer_id && drv?.stripe_payment_method_id) {
              const { data: veh } = await supabaseAdmin
                .from("vehicles")
                .select("daily_rate, weekly_rate")
                .eq("id", r.vehicle_id)
                .maybeSingle();
              const amount = resolvePeriodRate(
                isDaily,
                { billing_period: r.billing_period as any, rate: r.rate as any, weekly_rate: r.weekly_rate as any },
                (veh as any) ?? null,
              );
              if (amount > 0) {
                try {
                  const pi = await stripe.paymentIntents.create({
                    amount: Math.round(amount * 100),
                    currency: "usd",
                    customer: drv.stripe_customer_id as string,
                    payment_method: drv.stripe_payment_method_id as string,
                    off_session: true,
                    confirm: true,
                    metadata: {
                      kind: "auto_renew",
                      rental_id: r.id,
                      offer_token: token,
                      period_label: isDaily ? "day" : "week",
                    },
                  });
                  if (pi.status === "succeeded") {
                    const newEnd = await applyAutoExtension({
                      rentalId: r.id,
                      driverId: r.driver_id as string,
                      isDaily,
                      amount,
                      prevEndDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
                      paymentIntentId: pi.id,
                    });
                    autoCharged = true;
                    await supabaseAdmin
                      .from("auto_extension_offers")
                      .update({ status: "consumed", auto_pay_enabled: true, consumed_at: new Date().toISOString() })
                      .eq("token", token);
                    if (drv?.phone) {
                      await notifyRenter({
                        phone: drv.phone,
                        email: drv.email ?? null,
                        name: drv.full_name,
                        sms: `Camauto: Your rental was auto-renewed (+1 ${isDaily ? "day" : "week"}, $${amount.toFixed(2)}). New return date: ${newEnd}. Reply or call 1-866-625-5550 to stop auto-renew.`,
                        emailSubject: "Your rental was auto-renewed",
                        emailHeading: "Rental auto-renewed",
                        emailIntro: `We charged your card on file $${amount.toFixed(2)} and extended your rental to ${newEnd}.`,
                      });
                    }
                  } else {
                    chargeError = `payment_intent_status_${pi.status}`;
                  }
                } catch (e: any) {
                  chargeError = e?.message ?? String(e);
                }
              }
            }

            await supabaseAdmin
              .from("rentals")
              .update({
                extension_link_sent: true,
                extension_link_sent_date: new Date().toISOString(),
                last_auto_renew_date: todayIso,
                updated_at: new Date().toISOString(),
              } as any)
              .eq("id", r.id);

            // Admin: extension link sent (Extension Links Pending toggle).
            if (adminPendingEnabled) {
              try {
                await sendSms(
                  ADMIN_PHONE,
                  autoCharged
                    ? `Camauto: ${customerName} auto-renewed (${offerType}).`
                    : chargeError
                      ? `Camauto: Auto-renew charge FAILED for ${customerName} (${offerType}) — link sent for manual pay. ${chargeError}`
                      : `Camauto: Extension link sent to ${customerName} (${offerType}).`,
                  "Admin",
                );
              } catch (e) {
                console.error("[auto-extension-links] admin notify failed", e);
              }
            }

            results.push({ rentalId: r.id, sent: true, offerType, autoCharged, chargeError, phone: drv?.phone ?? null });
          } catch (e: any) {
            results.push({ rentalId: r.id, error: e?.message ?? String(e) });
          }
        }

        const sentCount = results.filter((x) => x.sent).length;
        const chargedCount = results.filter((x) => x.autoCharged).length;
        return Response.json({ ok: true, processed: rentals?.length ?? 0, sent: sentCount, autoCharged: chargedCount, results });
      },
    },
  },
});