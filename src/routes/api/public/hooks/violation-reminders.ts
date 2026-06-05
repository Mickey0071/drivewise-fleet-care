import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";

function daysAgoISO(n: number): string {
  return new Date(Date.now() - 1000 * 60 * 60 * 24 * n).toISOString();
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

        const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
        const { data: rows } = await (supabaseAdmin as any)
          .from("violations")
          .select("*")
          .in("status", ["sent_to_customer", "viewing"])
          .lte("sent_to_customer_at", daysAgoISO(7))
          .is("reminder_sent_at", null)
          .limit(200);

        let sent = 0;
        for (const v of rows ?? []) {
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
          sent++;
        }
        return Response.json({ ok: true, sent });
      },
    },
  },
});
