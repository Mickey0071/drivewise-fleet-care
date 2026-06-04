import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { sendSms } from "@/lib/ghl.server";
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

        const { data: rentals, error } = await supabaseAdmin
          .from("rentals")
          .select(
            "id, driver_id, billing_period, billing_cadence, end_date, signed_at, client_signed_at, activated_at, start_date, reservation_status, extension_link_sent",
          )
          .eq("reservation_status", "active")
          .eq("extension_link_sent", false);
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

            const { data: drv } = await supabaseAdmin
              .from("drivers")
              .select("full_name, phone, email")
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

            await supabaseAdmin
              .from("rentals")
              .update({
                extension_link_sent: true,
                extension_link_sent_date: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any)
              .eq("id", r.id);

            // Admin: extension link sent (Extension Links Pending toggle).
            if (adminPendingEnabled) {
              try {
                await sendSms(
                  ADMIN_PHONE,
                  `Camauto: Extension link sent to ${customerName} (${offerType}).`,
                  "Admin",
                );
              } catch (e) {
                console.error("[auto-extension-links] admin notify failed", e);
              }
            }

            results.push({ rentalId: r.id, sent: true, offerType, phone: drv?.phone ?? null });
          } catch (e: any) {
            results.push({ rentalId: r.id, error: e?.message ?? String(e) });
          }
        }

        const sentCount = results.filter((x) => x.sent).length;
        return Response.json({ ok: true, processed: rentals?.length ?? 0, sent: sentCount, results });
      },
    },
  },
});