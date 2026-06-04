import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { isNotificationEnabled } from "@/lib/notifications.server";

const ADMIN_REPAIR_PHONE = "267-221-3977";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Daily 8AM active-repairs digest. Scheduled via a dedicated once-per-day cron
 * (NOT the every-15-min reminders hook), so it can never recur hourly.
 * Skips SMS entirely when there are no active repairs.
 */
export const Route = createFileRoute("/api/public/hooks/repair-digest")({
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

        const today = todayISO();

        // Respect the admin Notifications Control Center toggle.
        if (!(await isNotificationEnabled("admin_morning_text"))) {
          return Response.json({ ok: true, skipped: "disabled" });
        }

        // Dedupe: only one digest per calendar day, even if invoked twice.
        const { data: prior } = await supabaseAdmin
          .from("reminder_log")
          .select("id")
          .eq("reminder_type", "admin_active_repairs")
          .eq("target_date", today)
          .limit(1);
        if ((prior ?? []).length > 0) {
          return Response.json({ ok: true, skipped: "already_sent_today" });
        }

        const { data: openRepairs, error } = await supabaseAdmin
          .from("maintenance")
          .select("id, vehicle_id, service_type, issue_description, status")
          .in("status", ["reported", "diagnosing", "pending_complete", "open", "in_progress"])
          .order("created_at", { ascending: true });
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const activeRepairs = openRepairs ?? [];
        if (activeRepairs.length === 0) {
          return Response.json({ ok: true, skipped: "no_active_repairs" });
        }

        const vehicleIds = Array.from(
          new Set(activeRepairs.map((r) => r.vehicle_id).filter(Boolean))
        );
        const vehiclesById = new Map<string, string>();
        if (vehicleIds.length) {
          const { data: vs } = await supabaseAdmin
            .from("vehicles")
            .select("id, year, make, model")
            .in("id", vehicleIds);
          (vs ?? []).forEach((v) =>
            vehiclesById.set(v.id, `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim())
          );
        }

        const lines = activeRepairs
          .slice(0, 20)
          .map((r) => {
            const veh = vehiclesById.get(r.vehicle_id) || r.vehicle_id;
            const issue = (r.issue_description || r.service_type || "Repair").toString();
            return `• ${veh} — ${issue}`;
          })
          .join("\n");
        const more = activeRepairs.length > 20 ? `\n…and ${activeRepairs.length - 20} more` : "";
        const msg = `🔧 Active Repairs (${activeRepairs.length})\n${lines}${more}`;

        try {
          await sendSms(ADMIN_REPAIR_PHONE, msg, "Admin");
          await supabaseAdmin.from("reminder_log").insert({
            rental_id: "ADMIN",
            reminder_type: "admin_active_repairs",
            target_date: today,
            phone: ADMIN_REPAIR_PHONE,
            message: msg,
          });
          return Response.json({ ok: true, count: activeRepairs.length, sent: true });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});