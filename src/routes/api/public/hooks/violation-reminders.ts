import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { isNotificationEnabled } from "@/lib/notifications.server";

function daysAgoISO(n: number): string {
  return new Date(Date.now() - 1000 * 60 * 60 * 24 * n).toISOString();
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

export const Route = createFileRoute("/api/public/hooks/violation-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = request.headers.get("x-cron-secret");
        const apiKey = request.headers.get("apikey");
        const valid =
          (!!cronSecret && cronSecret === process.env.CRON_SECRET) ||
          (!!apiKey && apiKey === process.env.SUPABASE_PUBLISHABLE_KEY);
        if (!valid) return new Response("Unauthorized", { status: 401 });

        if (!(await isNotificationEnabled("new_issue_alerts"))) {
          return Response.json({ ok: true, sent: 0, skipped: "notifications disabled" });
        }

        const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
        // Anything sent to customer 3+ days ago and still unresolved.
        const { data: rows } = await (supabaseAdmin as any)
          .from("violations")
          .select("*")
          .in("status", ["sent_to_customer", "viewing"])
          .lte("sent_to_customer_at", daysAgoISO(3))
          .limit(200);

        let sent = 0;
        for (const v of rows ?? []) {
          const age = daysSince(v.sent_to_customer_at);
          // Stage gating: day 3 reminder, day 6 final warning (also covers day 7).
          const needsFinal = age >= 6 && !v.final_warning_sent_at;
          const needsReminder = age >= 3 && age < 6 && !v.reminder_sent_at;
          if (!needsFinal && !needsReminder) continue;
          const { data: driver } = v.driver_id
            ? await (supabaseAdmin as any)
                .from("drivers")
                .select("full_name, phone, email")
                .eq("id", v.driver_id)
                .maybeSingle()
            : { data: null };
          if (!driver?.phone && !driver?.email) continue;
          const url = `${origin}/violation/${encodeURIComponent(v.customer_token)}`;
          const amt = `$${Number(v.total_amount || v.amount || 0).toFixed(2)}`;
          if (needsFinal) {
            await notifyRenter({
              phone: driver.phone ?? null,
              email: driver.email ?? null,
              name: driver.full_name ?? null,
              sms: `FINAL NOTICE from Camauto Rentals: Your EZPass violation (${amt}) is unresolved. If we don't hear from you, liability will be transferred to you with the issuing authority. ${url}`,
              emailSubject: "Final Notice: EZPass Violation — Camauto Rentals",
              emailHeading: "Final Notice: Unresolved Violation",
              emailIntro: `This is your final notice. Your EZPass violation of <strong>${amt}</strong> remains unresolved. If no action is taken, liability will be transferred directly to you with the issuing authority.`,
              emailCta: { label: "Resolve Now", url },
            });
            await (supabaseAdmin as any)
              .from("violations")
              .update({ final_warning_sent_at: new Date().toISOString() })
              .eq("id", v.id);
          } else {
            await notifyRenter({
              phone: driver.phone ?? null,
              email: driver.email ?? null,
              name: driver.full_name ?? null,
              sms: `Reminder from Camauto Rentals: Your EZPass violation (${amt}) is still unresolved. ${url}`,
              emailSubject: "Reminder: EZPass Violation — Camauto Rentals",
              emailHeading: "Reminder: Unresolved Violation",
              emailIntro: `This is a reminder that your EZPass violation of <strong>${amt}</strong> is still unresolved. Please pay or sign the affidavit.`,
              emailCta: { label: "Resolve Now", url },
            });
            await (supabaseAdmin as any)
              .from("violations")
              .update({ reminder_sent_at: new Date().toISOString() })
              .eq("id", v.id);
          }
          sent++;
        }
        return Response.json({ ok: true, sent });
      },
    },
  },
});
