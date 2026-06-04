import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { getNotificationSetting } from "@/lib/notifications.server";

/**
 * Hourly cron: remind drivers 24h before their next Auto-Pay charge.
 * Finds drivers whose next_auto_charge_date falls within the next 24-48h
 * window, dedupes via reminder_log, and respects the "autopay_reminders"
 * notification toggle.
 */
export const Route = createFileRoute("/api/public/hooks/autopay-reminders")({
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

        const setting = await getNotificationSetting("autopay_reminders");
        if (setting && setting.enabled === false) {
          return Response.json({ ok: true, skipped: "disabled" });
        }

        // Window: charges happening between 24h and 48h from now (i.e. "tomorrow").
        const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const end = new Date(Date.now() + 48 * 60 * 60 * 1000);

        const { data: drivers, error } = await supabaseAdmin
          .from("drivers")
          .select("id, full_name, phone, email, next_auto_charge_date, auto_pay_cadence")
          .eq("auto_pay_enabled", true)
          .gte("next_auto_charge_date", start.toISOString())
          .lte("next_auto_charge_date", end.toISOString());
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const origin = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
        const template = setting?.message_template || null;
        let sent = 0;

        for (const d of drivers ?? []) {
          if (!d.phone && !d.email) continue;
          const chargeDate = String(d.next_auto_charge_date).slice(0, 10);

          // Dedupe: one reminder per driver per charge date.
          const { data: prior } = await supabaseAdmin
            .from("reminder_log")
            .select("id")
            .eq("reminder_type", "autopay_reminder")
            .eq("target_date", chargeDate)
            .eq("phone", d.phone || d.email || d.id)
            .limit(1);
          if ((prior ?? []).length > 0) continue;

          const link = `${origin}/driver-portal`;
          const sms =
            (template
              ? template
                  .split("[date]")
                  .join(chargeDate)
                  .split("[link]")
                  .join(link)
              : `Reminder: Your Camauto Auto-Pay charges tomorrow (${chargeDate}). Manage or cancel: ${link}`);

          try {
            await notifyRenter({
              phone: d.phone ?? null,
              email: d.email ?? null,
              name: d.full_name ?? null,
              sms,
              emailSubject: "Auto-Pay Reminder — Camauto Rentals",
              emailHeading: "Your Auto-Pay Charges Tomorrow",
              emailIntro: `This is a reminder that your Auto-Pay charge is scheduled for <strong>${chargeDate}</strong>. You can update your card or cancel Auto-Pay anytime from your portal.`,
              emailCta: { label: "Manage Auto-Pay", url: link },
            });
            await supabaseAdmin.from("reminder_log").insert({
              rental_id: d.id,
              reminder_type: "autopay_reminder",
              target_date: chargeDate,
              phone: d.phone || d.email || d.id,
              message: sms,
            });
            sent++;
          } catch (e) {
            console.error("[autopay-reminders] failed for driver", d.id, e);
          }
        }

        return Response.json({ ok: true, sent, checked: (drivers ?? []).length });
      },
    },
  },
});
