import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendVerifyReminder,
  getVerifyReminderSetting,
} from "@/lib/cardholder-reminders.server";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cardholder verification reminder cron.
 * Modes:
 *  - "hourly" (default): sends the one-hour follow-up SMS to any pending
 *    cardholder whose initial reminder went out at least an hour ago.
 *  - "daily": sends the daily 8AM reminder to every still-pending cardholder.
 *
 * Stop conditions are enforced by the query: only rentals that are still
 * active AND have verification_status='pending' AND name_mismatch_flag=true
 * are considered. Verified / submitted / refused / reviewed / returned
 * rentals fall out automatically.
 */
export const Route = createFileRoute("/api/public/hooks/verification-reminders")({
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

        let mode: "hourly" | "daily" = "hourly";
        try {
          const body = (await request.json()) as { mode?: string };
          if (body?.mode === "daily") mode = "daily";
        } catch {
          // empty body — default hourly
        }

        const setting = await getVerifyReminderSetting();
        if (!setting.enabled) {
          return Response.json({ ok: true, skipped: "disabled", mode });
        }

        const today = todayISO();
        const results: Array<Record<string, unknown>> = [];

        // Pending, still-active rentals flagged for a card name mismatch.
        const { data: pending, error } = await supabaseAdmin
          .from("rentals")
          .select("id, driver_id, verification_status, name_mismatch_flag, reservation_status")
          .eq("name_mismatch_flag", true)
          .eq("verification_status", "pending")
          .eq("reservation_status", "active")
          .limit(500);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!pending || pending.length === 0) {
          return Response.json({ ok: true, mode, pending: 0, results });
        }

        const rentalIds = pending.map((r) => r.id);
        const driverIds = Array.from(
          new Set(pending.map((r) => r.driver_id).filter(Boolean)),
        );
        const driversById = new Map<string, { phone: string | null; full_name: string | null }>();
        if (driverIds.length) {
          const { data: drivers } = await supabaseAdmin
            .from("drivers")
            .select("id, phone, full_name")
            .in("id", driverIds);
          (drivers ?? []).forEach((d) =>
            driversById.set(d.id, { phone: d.phone, full_name: d.full_name }),
          );
        }

        if (mode === "daily") {
          for (const r of pending) {
            const drv = driversById.get(r.driver_id);
            const res = await sendVerifyReminder({
              rentalId: r.id,
              type: "cardholder_verify_daily",
              phone: drv?.phone ?? null,
              name: drv?.full_name ?? null,
              dedupeDate: today,
            });
            results.push(res);
          }
          return Response.json({ ok: true, mode, pending: pending.length, results });
        }

        // hourly: 1-hour follow-up. Needs the initial reminder timestamp.
        const { data: initials } = await supabaseAdmin
          .from("reminder_log")
          .select("rental_id, sent_at")
          .eq("reminder_type", "cardholder_verify_initial")
          .in("rental_id", rentalIds);
        const initialAt = new Map<string, string>();
        (initials ?? []).forEach((row) => {
          if (!initialAt.has(row.rental_id)) initialAt.set(row.rental_id, row.sent_at);
        });

        const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour ago
        for (const r of pending) {
          const sentAt = initialAt.get(r.id);
          if (!sentAt || new Date(sentAt).getTime() > cutoff) {
            results.push({ rentalId: r.id, type: "cardholder_verify_1h", status: "too_early" });
            continue;
          }
          const drv = driversById.get(r.driver_id);
          const res = await sendVerifyReminder({
            rentalId: r.id,
            type: "cardholder_verify_1h",
            phone: drv?.phone ?? null,
            name: drv?.full_name ?? null,
            dedupeDate: today,
            globalDedupe: true,
          });
          results.push(res);
        }
        return Response.json({ ok: true, mode, pending: pending.length, results });
      },
    },
  },
});