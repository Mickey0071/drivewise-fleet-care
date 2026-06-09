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
        // Anything sent to customer 3+ days ago and not yet followed up.
        const { data: rows } = await (supabaseAdmin as any)
          .from("violations")
          .select("*")
          .in("status", ["sent_to_customer", "viewing"])
          .lte("sent_to_customer_at", daysAgoISO(3))
          .limit(200);

        let sent = 0;
        for (const v of rows ?? []) {
          const age = daysSince(v.sent_to_customer_at);
          // Single informational follow-up at day 3+ (no pay/sign pressure).
          if (age < 3 || v.reminder_sent_at) continue;
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
          await notifyRenter({
            phone: driver.phone ?? null,
            email: driver.email ?? null,
            name: driver.full_name ?? null,
            sms: `Camauto Rentals: A toll violation (${amt}) on your rental has been transferred to you per your rental agreement. The issuing authority will contact you directly. Details: ${url}`,
            emailSubject: "Toll Violation Transferred — Camauto Rentals",
            emailHeading: "Toll Violation Transferred to You",
            emailIntro: `A toll violation of <strong>${amt}</strong> incurred during your rental has been transferred to you as the operator, per your signed rental agreement and N.J.S.A. 39:4-138.1. The issuing authority will contact you directly to resolve it. No action is required through Camauto Rentals.`,
            emailCta: { label: "View Details", url },
          });
          await (supabaseAdmin as any)
            .from("violations")
            .update({ reminder_sent_at: new Date().toISOString() })
            .eq("id", v.id);
          sent++;
        }
        return Response.json({ ok: true, sent });
      },
    },
  },
});
