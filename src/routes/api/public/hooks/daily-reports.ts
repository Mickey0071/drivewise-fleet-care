import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const REPORT_RECIPIENT = "+12672213977";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "N/A";
  return `${Number(m)}-${Number(d)}-${y.slice(2)}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function money(n: number): string {
  return `$${Math.round(n)}`;
}

export const Route = createFileRoute("/api/public/hooks/daily-reports")({
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
        const dateLabel = fmtDate(today);

        // ---------- Load supporting data ----------
        const [{ data: drivers }, { data: vehicles }, { data: rentals }] = await Promise.all([
          supabaseAdmin.from("drivers").select("id, full_name, phone"),
          supabaseAdmin.from("vehicles").select("id, make, model, year, plate, status, has_open_issues"),
          supabaseAdmin.from("rentals").select("id, driver_id, vehicle_id, start_date, end_date, reservation_status, returned_at"),
        ]);

        const driversById = new Map((drivers ?? []).map((d) => [d.id, d]));
        const vehiclesById = new Map((vehicles ?? []).map((v) => [v.id, v]));
        const rentalsById = new Map((rentals ?? []).map((r) => [r.id, r]));

        const vehicleLabel = (v: any) =>
          v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.replace(/\s+/g, " ").trim() : "Vehicle";

        // ========== REPORT 1: PAST DUE ==========
        const [{ data: duePayments }, { data: dueViolations }, { data: dueExtensions }] = await Promise.all([
          supabaseAdmin
            .from("payments")
            .select("driver_id, rental_id, amount, due_date, status")
            .neq("status", "paid")
            .lt("due_date", today),
          supabaseAdmin
            .from("violations")
            .select("driver_id, vehicle_id, total_amount, date_issued, status, paid_at")
            .neq("status", "paid")
            .is("paid_at", null)
            .lt("date_issued", today),
          supabaseAdmin
            .from("extension_requests")
            .select("rental_id, additional_amount, previous_end_date, new_end_date, status, paid_at")
            .is("paid_at", null)
            .lt("previous_end_date", today),
        ]);

        type PastDueRow = { name: string; phone: string; amount: number; dueISO: string; vehicle: string };
        const pastDueRows: PastDueRow[] = [];

        for (const p of duePayments ?? []) {
          const drv = driversById.get(p.driver_id);
          const rental = p.rental_id ? rentalsById.get(p.rental_id) : undefined;
          const veh = rental ? vehiclesById.get(rental.vehicle_id) : undefined;
          pastDueRows.push({
            name: drv?.full_name ?? "Unknown",
            phone: drv?.phone ?? "N/A",
            amount: Number(p.amount) || 0,
            dueISO: p.due_date,
            vehicle: veh?.make ?? "—",
          });
        }
        for (const v of dueViolations ?? []) {
          const drv = v.driver_id ? driversById.get(v.driver_id) : undefined;
          const veh = v.vehicle_id ? vehiclesById.get(v.vehicle_id) : undefined;
          pastDueRows.push({
            name: drv?.full_name ?? "Unknown",
            phone: drv?.phone ?? "N/A",
            amount: Number(v.total_amount) || 0,
            dueISO: v.date_issued,
            vehicle: veh?.make ?? "—",
          });
        }
        for (const e of dueExtensions ?? []) {
          const rental = rentalsById.get(e.rental_id);
          const drv = rental ? driversById.get(rental.driver_id) : undefined;
          const veh = rental ? vehiclesById.get(rental.vehicle_id) : undefined;
          pastDueRows.push({
            name: drv?.full_name ?? "Unknown",
            phone: drv?.phone ?? "N/A",
            amount: Number(e.additional_amount) || 0,
            dueISO: e.previous_end_date ?? e.new_end_date,
            vehicle: veh?.make ?? "—",
          });
        }

        const pastDueLines = pastDueRows.map((r) => {
          const overdue = daysBetween(r.dueISO.slice(0, 10), today);
          const dayLabel = `${overdue} day${overdue === 1 ? "" : "s"} overdue`;
          return `${r.name} | ${dayLabel} | ${money(r.amount)} | Due ${fmtDate(r.dueISO)} | ${r.vehicle} | ${r.phone}`;
        });
        const pastDueTotal = pastDueRows.reduce((s, r) => s + r.amount, 0);
        const pastDueMsg =
          `PAST DUE REPORT - ${dateLabel}\n\n` +
          (pastDueLines.length ? pastDueLines.join("\n") + "\n\n" : "No past due customers.\n\n") +
          `Total Past Due: ${pastDueRows.length} customer${pastDueRows.length === 1 ? "" : "s"} | ${money(pastDueTotal)}`;

        // ========== REPORT 2: CAR REPORTS ==========
        const downVehicleIds = new Set<string>();
        const carLines: string[] = [];

        // Open maintenance issues
        const { data: openMaint } = await supabaseAdmin
          .from("maintenance")
          .select("vehicle_id, service_type, vendor, next_service_due, date_completed")
          .is("date_completed", null);

        const maintByVehicle = new Map<string, any>();
        for (const m of openMaint ?? []) {
          if (!maintByVehicle.has(m.vehicle_id)) maintByVehicle.set(m.vehicle_id, m);
        }

        // Open-ended (indefinite) active rentals
        const openEndedByVehicle = new Map<string, any>();
        for (const r of rentals ?? []) {
          if (r.reservation_status === "active" && !r.returned_at && !r.end_date) {
            openEndedByVehicle.set(r.vehicle_id, r);
          }
        }

        for (const v of vehicles ?? []) {
          const label = `${vehicleLabel(v)} (Tag #${v.plate})`;
          const isDoNotRent = (v.status ?? "").toLowerCase().includes("do_not_rent") ||
            (v.status ?? "").toLowerCase().includes("down") ||
            (v.status ?? "").toLowerCase() === "maintenance";

          if (maintByVehicle.has(v.id)) {
            const m = maintByVehicle.get(v.id);
            carLines.push(`${label} | ${m.service_type} | ${m.vendor ?? "Pending"} | Est. Return ${fmtDate(m.next_service_due)}`);
            downVehicleIds.add(v.id);
          } else if (openEndedByVehicle.has(v.id)) {
            const r = openEndedByVehicle.get(v.id);
            const drv = driversById.get(r.driver_id);
            carLines.push(`${label} | On rent - No return date | Customer: ${drv?.full_name ?? "Unknown"} | Since ${fmtDate(r.start_date)}`);
            downVehicleIds.add(v.id);
          } else if (v.has_open_issues || isDoNotRent) {
            carLines.push(`${label} | Down - ${v.status ?? "Needs attention"}`);
            downVehicleIds.add(v.id);
          }
        }

        const totalVehicles = (vehicles ?? []).length;
        const availableCount = Math.max(0, totalVehicles - downVehicleIds.size);
        const carMsg =
          `CAR REPORTS - ${dateLabel}\n\n` +
          (carLines.length ? carLines.join("\n") + "\n\n" : "No vehicles down.\n\n") +
          `Total Down: ${downVehicleIds.size} vehicle${downVehicleIds.size === 1 ? "" : "s"}\n` +
          `Available: ${availableCount} vehicle${availableCount === 1 ? "" : "s"}`;

        // ---------- Send ----------
        const results: Record<string, unknown> = {};
        try {
          await sendSms(REPORT_RECIPIENT, pastDueMsg, "Management");
          results.pastDue = "sent";
        } catch (e: any) {
          results.pastDue = `error: ${e?.message ?? String(e)}`;
        }
        try {
          await sendSms(REPORT_RECIPIENT, carMsg, "Management");
          results.carReports = "sent";
        } catch (e: any) {
          results.carReports = `error: ${e?.message ?? String(e)}`;
        }

        return Response.json({
          ok: true,
          date: today,
          past_due_count: pastDueRows.length,
          down_count: downVehicleIds.size,
          available_count: availableCount,
          results,
        });
      },
    },
  },
});
