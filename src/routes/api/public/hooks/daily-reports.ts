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

// ---------- Unicode bold helpers (SMS has no markdown) ----------
// Sans-serif bold: letters and digits.
function boldChar(ch: string): string {
  const c = ch.codePointAt(0)!;
  if (ch >= "0" && ch <= "9") return String.fromCodePoint(0x1d7ec + (c - 48));
  if (ch >= "A" && ch <= "Z") return String.fromCodePoint(0x1d5d4 + (c - 65));
  if (ch >= "a" && ch <= "z") return String.fromCodePoint(0x1d5ee + (c - 97));
  return ch;
}
function bold(s: string): string {
  return Array.from(s).map(boldChar).join("");
}
function money(n: number): string {
  return `$${bold(String(Math.round(n)))}`;
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
        // 🚗 [Year Make Model] — [Plate]
        const vehicleHeader = (v: any) => {
          const name = vehicleLabel(v);
          const plate = v?.plate ? ` — ${v.plate}` : "";
          return `🚗 ${name}${plate}`;
        };

        // ========== SECTION 1: PAST DUES ==========
        const { data: duePayments } = await supabaseAdmin
          .from("payments")
          .select("driver_id, rental_id, amount, due_date, status")
          .neq("status", "paid")
          .lt("due_date", today);

        type PastDueRow = { name: string; amount: number; dueISO: string; veh: any };
        const pastDueRows: PastDueRow[] = [];

        // Only include reservations that are ON RENT (active).
        const includedStatuses = new Set(["active"]);
        const isEligibleRental = (rental: any) =>
          !!rental && includedStatuses.has((rental.reservation_status ?? "").toLowerCase());

        for (const p of duePayments ?? []) {
          const drv = driversById.get(p.driver_id);
          const rental = p.rental_id ? rentalsById.get(p.rental_id) : undefined;
          if (!isEligibleRental(rental)) continue;
          const veh = rental ? vehiclesById.get(rental.vehicle_id) : undefined;
          pastDueRows.push({
            name: drv?.full_name ?? "Unknown",
            amount: Number(p.amount) || 0,
            dueISO: p.due_date,
            veh,
          });
        }

        const pastDueBlocks = pastDueRows.map((r) => {
          const overdue = daysBetween(r.dueISO.slice(0, 10), today);
          const dayLabel = `${overdue} day${overdue === 1 ? "" : "s"}`;
          return (
            `${vehicleHeader(r.veh)}\n` +
            `Renter: ${r.name}\n` +
            `${bold("Past due")}: ${money(r.amount)} (${dayLabel})`
          );
        });
        const pastDueTotal = pastDueRows.reduce((s, r) => s + r.amount, 0);

        // ========== Maintenance: split into ACTIVE REPAIRS vs UNDIAGNOSED ISSUES ==========
        const { data: openMaint } = await supabaseAdmin
          .from("maintenance")
          .select("vehicle_id, service_type, issue_description, diagnosis_title, status, vendor, next_service_due, date_completed")
          .is("date_completed", null)
          .order("created_at", { ascending: true });

        const ACTIVE = new Set(["diagnosing", "pending_complete", "in_progress"]);
        const UNDIAGNOSED = new Set(["reported", "open"]);

        const activeRepairBlocks: string[] = [];
        const issueBlocks: string[] = [];

        for (const m of openMaint ?? []) {
          const v = vehiclesById.get(m.vehicle_id);
          const status = (m.status ?? "").toLowerCase();
          const header = vehicleHeader(v);
          if (ACTIVE.has(status)) {
            const label = (m.diagnosis_title || m.issue_description || m.service_type || "Repair").toString();
            activeRepairBlocks.push(
              `${header}\n` +
                `Repair: ${label}\n` +
                `Status: ${status === "pending_complete" ? "Awaiting completion" : status === "diagnosing" ? "Diagnosing" : "In progress"}`,
            );
          } else if (UNDIAGNOSED.has(status)) {
            const label = (m.issue_description || m.service_type || "Reported issue").toString();
            issueBlocks.push(
              `${header}\n` +
                `Issue: ${label}\n` +
                `Status: Awaiting diagnosis`,
            );
          }
        }

        // ========== Build the morning report ==========
        const section = (title: string, blocks: string[], empty: string) =>
          `${title}\n${blocks.length ? blocks.join("\n\n") : empty}`;

        const activeRentalCount = (rentals ?? []).filter(
          (r) => (r.reservation_status ?? "").toLowerCase() === "active",
        ).length;

        const morningMsg =
          `CAMAUTO MORNING REPORT — ${dateLabel}\n\n` +
          section("PAST DUES", pastDueBlocks, "None") +
          `\n\n` +
          section("ACTIVE REPAIRS", activeRepairBlocks, "None") +
          `\n\n` +
          section("VEHICLE ISSUES (awaiting diagnosis)", issueBlocks, "None") +
          `\n\n` +
          `SUMMARY\n` +
          `Active Rentals: ${bold(String(activeRentalCount))}\n` +
          `Total Past Due: ${money(pastDueTotal)}`;

        // ---------- Send ----------
        const results: Record<string, unknown> = {};
        try {
          await sendSms(REPORT_RECIPIENT, morningMsg, "Management");
          results.morning = "sent";
        } catch (e: any) {
          results.morning = `error: ${e?.message ?? String(e)}`;
        }

        return Response.json({
          ok: true,
          date: today,
          past_due_count: pastDueRows.length,
          active_repair_count: activeRepairBlocks.length,
          issue_count: issueBlocks.length,
          results,
          sample: morningMsg,
        });
      },
    },
  },
});
