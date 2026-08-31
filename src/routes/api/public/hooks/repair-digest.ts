import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSectionDigestNow, type AlertItem } from "@/lib/alerts.server";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Daily active-repairs digest, grouped by vehicle. Every send goes through the
 * alert gate (master switch, section toggle, quiet hours) in alerts.server.
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
          .select("id, vehicle_id, service_type, issue_description, diagnosis_title, status")
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
          new Set(activeRepairs.map((r) => r.vehicle_id).filter(Boolean)),
        );
        const vehiclesById = new Map<string, { label: string; plate: string | null }>();
        if (vehicleIds.length) {
          const { data: vs } = await supabaseAdmin
            .from("vehicles")
            .select("id, year, make, model, plate")
            .in("id", vehicleIds);
          (vs ?? []).forEach((v) =>
            vehiclesById.set(v.id, {
              label: `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim(),
              plate: (v as { plate?: string | null }).plate ?? null,
            }),
          );
        }

        const items: AlertItem[] = activeRepairs.map((r) => {
          const veh = vehiclesById.get(r.vehicle_id);
          const issue = (r.diagnosis_title || r.issue_description || r.service_type || "Repair").toString();
          const inProgress = r.status === "in_progress" || r.status === "diagnosing";
          return {
            section: "repairs",
            alertType: "active_repair",
            vehicleId: r.vehicle_id,
            plate: veh?.plate ?? null,
            vehicleLabel: veh?.label || r.vehicle_id,
            headline: veh?.label || r.vehicle_id,
            detail: `${issue} — ${inProgress ? "in progress" : "waiting"}`,
            severity: inProgress ? 1 : 2,
            linkPath: "/repairs",
          };
        });

        const res = await sendSectionDigestNow("repairs", items);
        if (res.outcome !== "sent") {
          return Response.json({ ok: true, skipped: res.reason });
        }

        await supabaseAdmin.from("reminder_log").insert({
          rental_id: "ADMIN",
          reminder_type: "admin_active_repairs",
          target_date: today,
          phone: "admin",
          message: `Active repairs digest (${activeRepairs.length})`,
        });
        return Response.json({ ok: true, count: activeRepairs.length, sent: true });
      },
    },
  },
});
