import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_REPAIR_PHONE = "267-221-3977";
const MECHANIC_CALLBACK = "(866) 625-5550";
const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

const DECLINE_REASONS = [
  "Too expensive",
  "Need second opinion",
  "Customer declined repair",
  "Need more information",
  "Other",
];

const money = (n: unknown) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const db = supabaseAdmin as any;

type PartItem = { name: string; price: number };

/** Public: load repair details by accept OR decline token. */
export const getRepairActionByToken = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: rows } = await db.rpc("get_repair_action_public", { _token: data.token });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };
    const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(" ");
    const partsTotal = (row.parts_list ?? []).reduce((s: number, p: PartItem) => s + (Number(p.price) || 0), 0);
    return {
      found: true as const,
      mode: row.is_accept ? ("accept" as const) : ("decline" as const),
      actionTaken: row.action_taken as "pending" | "accepted" | "declined",
      status: row.status as string,
      vehicle,
      plate: row.vehicle_plate ?? "",
      issue: row.issue_description ?? "",
      partsList: (row.parts_list ?? []) as PartItem[],
      partsTotal,
      labourCost: Number(row.labor_cost) || 0,
      total: Number(row.cost) || partsTotal + (Number(row.labor_cost) || 0),
      declineReasons: DECLINE_REASONS,
    };
  });

async function loadByToken(token: string, field: "accept_token" | "decline_token") {
  const { data: row } = await db
    .from("maintenance")
    .select("id, action_taken, vehicle_id, mechanic_name, mechanic_phone, issue_description, service_type, parts_list, parts_cost, labor_cost, cost")
    .eq(field, token)
    .maybeSingle();
  return row;
}

async function vehicleLabel(vehicleId: string | null): Promise<{ label: string; plate: string }> {
  if (!vehicleId) return { label: "vehicle", plate: "" };
  const { data: v } = await db
    .from("vehicles")
    .select("year, make, model, plate")
    .eq("id", vehicleId)
    .maybeSingle();
  if (!v) return { label: "vehicle", plate: "" };
  return {
    label: `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "vehicle",
    plate: v.plate ?? "",
  };
}

/** Public: admin one-tap accept of mechanic diagnosis. */
export const acceptRepairAction = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const row = await loadByToken(data.token, "accept_token");
    if (!row) throw new Error("This link is no longer valid.");
    if (row.action_taken !== "pending") throw new Error(`This diagnosis was already ${row.action_taken}.`);

    const total = Number(row.cost) || 0;
    const { error } = await db
      .from("maintenance")
      .update({
        action_taken: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: "Admin",
        status: "pending_complete",
        accept_token: null,
        decline_token: null,
      })
      .eq("id", row.id)
      .eq("action_taken", "pending");
    if (error) throw new Error(error.message);

    const { label, plate } = await vehicleLabel(row.vehicle_id);
    const issue = row.issue_description || row.service_type || "repair";
    if (row.mechanic_phone) {
      try {
        await sendSms(
          row.mechanic_phone,
          `✓ Approved! Start service on ${label}.\n${label}${plate ? ` (Plate: ${plate})` : ""}\nIssue: ${issue}\nTotal approved: ${money(total)}\nUpdate us when complete: ${MECHANIC_CALLBACK}`,
          row.mechanic_name || "Mechanic",
        );
      } catch (e) {
        console.error("accept mechanic SMS failed", e);
      }
    }
    return { ok: true as const };
  });

/** Public: admin decline of mechanic diagnosis (stays in Phase 2). */
export const declineRepairAction = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; reason: string; notes?: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    const reason = (d.reason ?? "").trim().slice(0, 120);
    if (!reason) throw new Error("Please select a reason");
    return { token: d.token, reason, notes: (d.notes ?? "").trim().slice(0, 1000) };
  })
  .handler(async ({ data }) => {
    const row = await loadByToken(data.token, "decline_token");
    if (!row) throw new Error("This link is no longer valid.");
    if (row.action_taken !== "pending") throw new Error(`This diagnosis was already ${row.action_taken}.`);

    const { error } = await db
      .from("maintenance")
      .update({
        action_taken: "declined",
        declined_at: new Date().toISOString(),
        declined_by: "Admin",
        decline_reason: data.reason,
        decline_notes: data.notes || null,
        status: "diagnosing",
        accept_token: null,
        decline_token: null,
      })
      .eq("id", row.id)
      .eq("action_taken", "pending");
    if (error) throw new Error(error.message);

    const { label } = await vehicleLabel(row.vehicle_id);
    if (row.mechanic_phone) {
      try {
        await sendSms(
          row.mechanic_phone,
          `❌ Pricing declined for ${label}\nReason: ${data.reason}${data.notes ? `\n${data.notes}` : ""}\nContact admin to discuss: ${MECHANIC_CALLBACK}`,
          row.mechanic_name || "Mechanic",
        );
      } catch (e) {
        console.error("decline mechanic SMS failed", e);
      }
    }
    return { ok: true as const };
  });

/** Admin: list repairs awaiting approval > 4 hours (dashboard alert). */
export const listPendingApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from("maintenance")
      .select("id, vehicle_id, issue_description, service_type, cost, updated_at, mechanic_name")
      .eq("action_taken", "pending")
      .eq("status", "diagnosing")
      .not("accept_token", "is", null)
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(100);
    return { pending: data ?? [] };
  });

export { ADMIN_REPAIR_PHONE };
