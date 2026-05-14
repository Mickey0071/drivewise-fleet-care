import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

function tomorrowISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const ADMIN_PHONE = "+12672213977";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export const Route = createFileRoute("/api/public/hooks/send-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const target = tomorrowISO();
        const today = todayISO();
        const pastDueCutoff = daysAgoISO(2); // due_date strictly before this = >2 days late
        const results: Array<Record<string, unknown>> = [];

        // 1) Payment-due reminders
        const { data: duePayments, error: payErr } = await supabaseAdmin
          .from("payments")
          .select("id, rental_id, driver_id, amount, due_date, status")
          .eq("due_date", target)
          .neq("status", "paid");

        if (payErr) {
          return Response.json({ ok: false, stage: "payments", error: payErr.message }, { status: 500 });
        }

        // 2) Rental-return reminders
        const { data: endingRentals, error: rentErr } = await supabaseAdmin
          .from("rentals")
          .select("id, driver_id, vehicle_id, end_date, reservation_status")
          .eq("end_date", target)
          .eq("reservation_status", "active");

        if (rentErr) {
          return Response.json({ ok: false, stage: "rentals", error: rentErr.message }, { status: 500 });
        }

        // 3) Admin alerts: payments more than 2 days past due
        const { data: pastDuePayments, error: pastErr } = await supabaseAdmin
          .from("payments")
          .select("id, rental_id, driver_id, amount, due_date, status")
          .lt("due_date", pastDueCutoff)
          .neq("status", "paid");

        if (pastErr) {
          return Response.json({ ok: false, stage: "past_due", error: pastErr.message }, { status: 500 });
        }

        // Collect driver ids to fetch contact info in one go
        const driverIds = Array.from(
          new Set([
            ...(duePayments ?? []).map((p) => p.driver_id),
            ...(endingRentals ?? []).map((r) => r.driver_id),
            ...(pastDuePayments ?? []).map((p) => p.driver_id),
          ])
        );
        const driversById = new Map<string, { phone: string | null; full_name: string | null }>();
        if (driverIds.length) {
          const { data: drivers } = await supabaseAdmin
            .from("drivers")
            .select("id, phone, full_name")
            .in("id", driverIds);
          (drivers ?? []).forEach((d) => driversById.set(d.id, { phone: d.phone, full_name: d.full_name }));
        }

        // Skip already-sent reminders (renter reminders use tomorrow's date,
        // admin past-due alerts use today's date as the dedupe key).
        const { data: alreadySent } = await supabaseAdmin
          .from("reminder_log")
          .select("rental_id, reminder_type, target_date")
          .in("target_date", [target, today]);
        const sentSet = new Set(
          (alreadySent ?? []).map((r) => `${r.rental_id}:${r.reminder_type}:${r.target_date}`)
        );

        async function logAndSend(
          rentalId: string,
          type: "payment_due" | "rental_return" | "admin_past_due",
          phone: string | null,
          name: string | null,
          message: string,
          dedupeDate: string = target
        ) {
          if (sentSet.has(`${rentalId}:${type}:${dedupeDate}`)) {
            results.push({ rentalId, type, skipped: "already_sent" });
            return;
          }
          if (!phone) {
            results.push({ rentalId, type, skipped: "no_phone" });
            return;
          }
          await sendSms(phone, message, name);
          await supabaseAdmin.from("reminder_log").insert({
            rental_id: rentalId,
            reminder_type: type,
            target_date: dedupeDate,
            phone,
            message,
          });
          results.push({ rentalId, type, phone, sent: true });
        }

        for (const p of duePayments ?? []) {
          const drv = driversById.get(p.driver_id);
          const msg = `Reminder from Rentalprise: a payment of $${Number(p.amount).toFixed(2)} for your rental is due tomorrow (${fmtDate(p.due_date)}). Please make payment to keep your rental active. Reply to this message with any questions.`;
          await logAndSend(p.rental_id, "payment_due", drv?.phone ?? null, drv?.full_name ?? null, msg);
        }

        for (const r of endingRentals ?? []) {
          const drv = driversById.get(r.driver_id);
          const msg = `Reminder from Rentalprise: your rental of vehicle ${r.vehicle_id} is scheduled to be returned tomorrow (${fmtDate(r.end_date as string)}). Reply to this message to renew/extend or to confirm return.`;
          await logAndSend(r.id, "rental_return", drv?.phone ?? null, drv?.full_name ?? null, msg);
        }

        // Admin past-due alerts — one SMS per past-due payment per day to the owner number
        for (const p of pastDuePayments ?? []) {
          const drv = driversById.get(p.driver_id);
          const name = drv?.full_name ?? p.driver_id;
          const driverPhone = drv?.phone ?? "unknown";
          const msg = `Rentalprise PAST DUE alert: ${name} (${driverPhone}) is past due on $${Number(p.amount).toFixed(2)} that was due ${fmtDate(p.due_date)}.`;
          await logAndSend(p.rental_id, "admin_past_due", ADMIN_PHONE, "Admin", msg, today);
        }

        return Response.json({
          ok: true,
          target_date: target,
          payments_due: duePayments?.length ?? 0,
          rentals_ending: endingRentals?.length ?? 0,
          admin_past_due: pastDuePayments?.length ?? 0,
          results,
        });
      },
    },
  },
});