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

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export const Route = createFileRoute("/api/public/hooks/send-reminders")({
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

        // 4) Admin digest: all payments due TODAY
        const { data: dueTodayPayments, error: dueTodayErr } = await supabaseAdmin
          .from("payments")
          .select("id, rental_id, driver_id, amount, due_date, status")
          .eq("due_date", today)
          .neq("status", "paid");

        if (dueTodayErr) {
          return Response.json({ ok: false, stage: "due_today", error: dueTodayErr.message }, { status: 500 });
        }

        // 5) 2-hour check-in SMS: rentals activated 2-3 hours ago
        const nowMs = Date.now();
        const checkinWindowStart = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();
        const checkinWindowEnd = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
        const { data: checkinRentals, error: checkinErr } = await supabaseAdmin
          .from("rentals")
          .select("id, driver_id, vehicle_id, activated_at, reservation_status")
          .eq("reservation_status", "active")
          .gte("activated_at", checkinWindowStart)
          .lte("activated_at", checkinWindowEnd);
        if (checkinErr) {
          return Response.json({ ok: false, stage: "checkin", error: checkinErr.message }, { status: 500 });
        }

        // Collect driver ids to fetch contact info in one go
        const driverIds = Array.from(
          new Set([
            ...(duePayments ?? []).map((p) => p.driver_id),
            ...(endingRentals ?? []).map((r) => r.driver_id),
            ...(pastDuePayments ?? []).map((p) => p.driver_id),
            ...(dueTodayPayments ?? []).map((p) => p.driver_id),
            ...(checkinRentals ?? []).map((r) => r.driver_id),
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

        // Only ACTIVE rentals should trigger payment reminders/overdue texts.
        // Skip anything tied to returned/cancelled/pending reservations.
        const paymentRentalIds = Array.from(
          new Set([
            ...(duePayments ?? []).map((p) => p.rental_id),
            ...(pastDuePayments ?? []).map((p) => p.rental_id),
            ...(dueTodayPayments ?? []).map((p) => p.rental_id),
          ].filter(Boolean))
        );
        const activeRentalIds = new Set<string>();
        if (paymentRentalIds.length) {
          const { data: statusRows } = await supabaseAdmin
            .from("rentals")
            .select("id, reservation_status")
            .in("id", paymentRentalIds)
            .eq("reservation_status", "active");
          (statusRows ?? []).forEach((r) => activeRentalIds.add(r.id));
        }
        const isActive = (rentalId: string | null | undefined) =>
          !!rentalId && activeRentalIds.has(rentalId);

        // Fetch vehicle info for check-in messages
        const checkinVehicleIds = Array.from(
          new Set((checkinRentals ?? []).map((r) => r.vehicle_id).filter(Boolean))
        );
        const vehiclesById = new Map<string, { year: number | null; make: string | null; model: string | null }>();
        if (checkinVehicleIds.length) {
          const { data: vs } = await supabaseAdmin
            .from("vehicles")
            .select("id, year, make, model")
            .in("id", checkinVehicleIds);
          (vs ?? []).forEach((v) => vehiclesById.set(v.id, { year: v.year, make: v.make, model: v.model }));
        }

        // Skip already-sent reminders (renter reminders use tomorrow's date,
        // admin past-due alerts use today's date as the dedupe key).
        // For check-in, dedupe is per-rental regardless of date — fetched separately.
        const { data: alreadySent } = await supabaseAdmin
          .from("reminder_log")
          .select("rental_id, reminder_type, target_date")
          .in("target_date", [target, today]);
        const sentSet = new Set(
          (alreadySent ?? []).map((r) => `${r.rental_id}:${r.reminder_type}:${r.target_date}`)
        );

        // Dedupe for checkin_2h: ANY past log for this rental + type
        const checkinRentalIds = (checkinRentals ?? []).map((r) => r.id);
        const checkinSent = new Set<string>();
        if (checkinRentalIds.length) {
          const { data: prior } = await supabaseAdmin
            .from("reminder_log")
            .select("rental_id")
            .eq("reminder_type", "checkin_2h")
            .in("rental_id", checkinRentalIds);
          (prior ?? []).forEach((r) => checkinSent.add(r.rental_id));
        }

        async function logAndSend(
          rentalId: string,
          type: "payment_due" | "rental_return" | "admin_past_due" | "admin_due_today" | "checkin_2h",
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
          if (!isActive(p.rental_id)) {
            results.push({ rentalId: p.rental_id, type: "payment_due", skipped: "rental_not_active" });
            continue;
          }
          const drv = driversById.get(p.driver_id);
          const msg = `Reminder from Rentalprise: a payment of $${Number(p.amount).toFixed(2)} for your rental is due tomorrow (${fmtDate(p.due_date)}). Please make payment to keep your rental active. Reply to this message with any questions.`;
          await logAndSend(p.rental_id, "payment_due", drv?.phone ?? null, drv?.full_name ?? null, msg);
        }

        for (const r of endingRentals ?? []) {
          const drv = driversById.get(r.driver_id);
          const msg = `Reminder from Rentalprise: your rental of vehicle ${r.vehicle_id} is scheduled to be returned tomorrow (${fmtDate(r.end_date as string)}). Reply to this message to renew/extend or to confirm return.`;
          await logAndSend(r.id, "rental_return", drv?.phone ?? null, drv?.full_name ?? null, msg);
        }

        // Check-in SMS — once per rental, ~2 hours after activation
        for (const r of checkinRentals ?? []) {
          if (checkinSent.has(r.id)) {
            results.push({ rentalId: r.id, type: "checkin_2h", skipped: "already_sent" });
            continue;
          }
          const drv = driversById.get(r.driver_id);
          if (!drv?.phone) {
            results.push({ rentalId: r.id, type: "checkin_2h", skipped: "no_phone" });
            continue;
          }
          const v = vehiclesById.get(r.vehicle_id);
          const vehicleLabel = v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : "vehicle";
          const firstName = (drv.full_name ?? "").split(" ")[0] || "there";
          const msg = `Hi ${firstName}, your Camauto rental is underway. How's everything going with your ${vehicleLabel}? Any issues?`;
          try {
            await sendSms(drv.phone, msg, drv.full_name);
            await supabaseAdmin.from("reminder_log").insert({
              rental_id: r.id,
              reminder_type: "checkin_2h",
              target_date: todayISO(),
              phone: drv.phone,
              message: msg,
            });
            results.push({ rentalId: r.id, type: "checkin_2h", phone: drv.phone, sent: true });
          } catch (e: any) {
            results.push({ rentalId: r.id, type: "checkin_2h", error: e?.message ?? String(e) });
          }
        }

        // 6) Daily 8AM admin alert: every active (non-complete) repair, until complete
        const ADMIN_REPAIR_PHONE = "267-221-3977";
        const { data: openRepairs, error: repairErr } = await supabaseAdmin
          .from("maintenance")
          .select("id, vehicle_id, service_type, status, date_completed")
          .is("date_completed", null)
          .not("status", "is", null)
          .neq("status", "complete");
        if (repairErr) {
          return Response.json({ ok: false, stage: "repairs", error: repairErr.message }, { status: 500 });
        }
        const activeRepairs = (openRepairs ?? []);
        if (activeRepairs.length > 0) {
          const repairVehicleIds = Array.from(
            new Set(activeRepairs.map((r) => r.vehicle_id).filter(Boolean))
          );
          const repairVehiclesById = new Map<string, string>();
          if (repairVehicleIds.length) {
            const { data: rvs } = await supabaseAdmin
              .from("vehicles")
              .select("id, year, make, model")
              .in("id", repairVehicleIds);
            (rvs ?? []).forEach((v) =>
              repairVehiclesById.set(v.id, `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim())
            );
          }
          const lines = activeRepairs
            .slice(0, 10)
            .map((r) => `• ${repairVehiclesById.get(r.vehicle_id) || r.vehicle_id}: ${r.service_type}`)
            .join("\n");
          const more = activeRepairs.length > 10 ? `\n…and ${activeRepairs.length - 10} more` : "";
          const repairMsg = `Camauto: ${activeRepairs.length} active repair${activeRepairs.length === 1 ? "" : "s"} still open.\n${lines}${more}`;
          try {
            await sendSms(ADMIN_REPAIR_PHONE, repairMsg, "Admin");
            results.push({ type: "admin_active_repairs", count: activeRepairs.length, sent: true });
          } catch (e: any) {
            results.push({ type: "admin_active_repairs", error: e?.message ?? String(e) });
          }
        }

        return Response.json({
          ok: true,
          target_date: target,
          payments_due: duePayments?.length ?? 0,
          rentals_ending: endingRentals?.length ?? 0,
          admin_past_due: (pastDuePayments ?? []).filter((p) => isActive(p.rental_id)).length,
          admin_due_today: (dueTodayPayments ?? []).filter((p) => isActive(p.rental_id)).length,
          checkin_2h: checkinRentals?.length ?? 0,
          active_repairs: (openRepairs ?? []).length,
          results,
        });
      },
    },
  },
});