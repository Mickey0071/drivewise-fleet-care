import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";
import { PRERENTAL_CHECKLIST } from "@/lib/prerental-checklist-items";

const TOKEN_TTL_DAYS = 14;

function originFromEnv(): string {
  return process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
}

function genToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ChecklistSummaryRow {
  id: string;
  vehicleId: string;
  vehicleLabel: string;
  plate: string;
  status: string;
  assignedRunnerName: string | null;
  createdAt: string;
  completedAt: string | null;
  vehicleCanList: boolean;
  token: string | null;
  sentAt: string | null;
  passed: number;
  failed: number;
  na: number;
  pending: number;
}

export interface ChecklistItemRow {
  id: string;
  category: string;
  itemName: string;
  status: string;
  notes: string | null;
  checkedAt: string | null;
  sortOrder: number;
}

export interface ChecklistDetail extends ChecklistSummaryRow {
  notes: string | null;
  completedByName: string | null;
  signature: string | null;
  items: ChecklistItemRow[];
}

function vehLabel(v: any): string {
  if (!v) return "";
  return `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
}

/** Admin: all checklists, newest first, with pass/fail counts. */
export const listVehicleChecklists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChecklistSummaryRow[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("vehicle_checklists")
      .select("*, vehicles(plate, year, make, model), checklist_items(status)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => {
      const items: { status: string }[] = r.checklist_items ?? [];
      return {
        id: r.id,
        vehicleId: r.vehicle_id,
        vehicleLabel: vehLabel(r.vehicles),
        plate: r.vehicles?.plate ?? "",
        status: r.status,
        assignedRunnerName: r.assigned_runner_name ?? null,
        createdAt: r.created_at,
        completedAt: r.completed_at ?? null,
        vehicleCanList: !!r.vehicle_can_list,
        token: r.token ?? null,
        sentAt: r.sent_at ?? null,
        passed: items.filter((i) => i.status === "pass").length,
        failed: items.filter((i) => i.status === "fail").length,
        na: items.filter((i) => i.status === "n/a").length,
        pending: items.filter((i) => i.status === "pending").length,
      };
    });
  });

/** Admin: full checklist with items. */
export const getChecklistDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id) throw new Error("Missing checklist id");
    return { id };
  })
  .handler(async ({ data, context }): Promise<ChecklistDetail> => {
    const { supabase } = context;
    const { data: r, error } = await supabase
      .from("vehicle_checklists")
      .select("*, vehicles(plate, year, make, model)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Checklist not found");
    const { data: items, error: itErr } = await supabase
      .from("checklist_items")
      .select("*")
      .eq("checklist_id", data.id)
      .order("sort_order", { ascending: true });
    if (itErr) throw new Error(itErr.message);
    const mapped: ChecklistItemRow[] = (items ?? []).map((i: any) => ({
      id: i.id,
      category: i.category,
      itemName: i.item_name,
      status: i.status,
      notes: i.notes ?? null,
      checkedAt: i.checked_at ?? null,
      sortOrder: i.sort_order ?? 0,
    }));
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      vehicleLabel: vehLabel((r as any).vehicles),
      plate: (r as any).vehicles?.plate ?? "",
      status: r.status,
      assignedRunnerName: r.assigned_runner_name ?? null,
      createdAt: r.created_at,
      completedAt: r.completed_at ?? null,
      vehicleCanList: !!r.vehicle_can_list,
      token: r.token ?? null,
      sentAt: r.sent_at ?? null,
      notes: r.notes ?? null,
      completedByName: r.completed_by_name ?? null,
      signature: r.signature ?? null,
      passed: mapped.filter((i) => i.status === "pass").length,
      failed: mapped.filter((i) => i.status === "fail").length,
      na: mapped.filter((i) => i.status === "n/a").length,
      pending: mapped.filter((i) => i.status === "pending").length,
      items: mapped,
    };
  });

/** Admin: start a new pre-rental checklist for a vehicle (all 8 categories). */
export const startVehicleChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string }) => {
    const vehicleId = String(d?.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("Pick a vehicle");
    return { vehicleId };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const token = genToken();
    const { data: row, error } = await supabase
      .from("vehicle_checklists")
      .insert({
        vehicle_id: data.vehicleId,
        status: "pending",
        token,
        token_expires_at: new Date(Date.now() + TOKEN_TTL_DAYS * 864e5).toISOString(),
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    let sort = 0;
    const items = PRERENTAL_CHECKLIST.flatMap((section) =>
      section.items.map((name) => ({
        checklist_id: row.id,
        category: section.category,
        item_name: name,
        status: "pending",
        sort_order: sort++,
      })),
    );
    const { error: itErr } = await supabase.from("checklist_items").insert(items);
    if (itErr) throw new Error(itErr.message);
    return { ok: true as const, id: row.id as string, token };
  });

/** Admin: assign a runner and text them the checklist link. */
export const sendChecklistTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    checklistId: string;
    runnerId?: string | null;
    runnerName: string;
    runnerPhone: string;
    adminName?: string;
  }) => {
    const checklistId = String(d?.checklistId ?? "").trim();
    if (!checklistId) throw new Error("Missing checklist");
    const runnerName = String(d?.runnerName ?? "").trim();
    if (!runnerName) throw new Error("Pick a runner");
    const runnerPhone = String(d?.runnerPhone ?? "").trim();
    const digits = runnerPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw new Error("Runner has no valid phone number");
    return {
      checklistId,
      runnerId: d.runnerId ? String(d.runnerId) : null,
      runnerName,
      runnerPhone,
      adminName: (d.adminName ?? "Camauto").slice(0, 80),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: cl, error } = await supabase
      .from("vehicle_checklists")
      .select("id, token, vehicle_id, vehicles(plate)")
      .eq("id", data.checklistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cl) throw new Error("Checklist not found");

    const token = cl.token || genToken();
    const { error: upErr } = await supabase
      .from("vehicle_checklists")
      .update({
        assigned_runner_id: data.runnerId,
        assigned_runner_name: data.runnerName,
        assigned_runner_phone: data.runnerPhone,
        status: "pending",
        token,
        token_expires_at: new Date(Date.now() + TOKEN_TTL_DAYS * 864e5).toISOString(),
        sent_at: new Date().toISOString(),
      })
      .eq("id", data.checklistId);
    if (upErr) throw new Error(upErr.message);

    const plate = (cl as any).vehicles?.plate ?? cl.vehicle_id;
    const link = `${originFromEnv()}/runner/checklist/${token}`;
    const msg =
      `${data.adminName} assigned pre-rental checklist for ${plate}. ` +
      `Complete here: ${link}. Reply DONE when finished.`;
    let smsStatus: "sent" | "failed" = "sent";
    try {
      await sendSms(data.runnerPhone, msg, data.runnerName);
    } catch (e) {
      console.error("checklist SMS failed", e);
      smsStatus = "failed";
    }
    return { ok: true as const, token, link, smsStatus };
  });

/** Admin: reopen a completed checklist so the runner re-inspects. */
export const reopenChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id) throw new Error("Missing checklist id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("vehicle_checklists")
      .update({
        status: "in_progress",
        vehicle_can_list: false,
        completed_at: null,
        completed_by_name: null,
        signature: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: lock the vehicle — blocks listing until a fresh checklist passes. */
export const lockVehicleForChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id) throw new Error("Missing checklist id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("vehicle_checklists")
      .update({ status: "failed", vehicle_can_list: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Can this vehicle be listed as available? */
export const getVehicleChecklistGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string }) => ({ vehicleId: String(d?.vehicleId ?? "") }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: veh } = await supabase
      .from("vehicles")
      .select("checklist_required")
      .eq("id", data.vehicleId)
      .maybeSingle();
    const required = veh ? (veh as any).checklist_required !== false : true;
    if (!required) return { required: false, canList: true, latestStatus: null as string | null };
    const { data: cl } = await supabase
      .from("vehicle_checklists")
      .select("status, vehicle_can_list")
      .eq("vehicle_id", data.vehicleId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = cl?.[0];
    const canList = !!(latest && latest.status === "completed" && latest.vehicle_can_list);
    return { required: true, canList, latestStatus: latest?.status ?? null };
  });

/** Admin: toggle whether a vehicle needs a checklist before it can be listed. */
export const setChecklistRequired = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string; required: boolean }) => ({
    vehicleId: String(d?.vehicleId ?? ""),
    required: !!d?.required,
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("vehicles")
      .update({ checklist_required: data.required })
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Tracker items (maintenance installed)
// ---------------------------------------------------------------------------

export interface TrackerRow {
  id: string;
  vehicleId: string;
  trackerType: string;
  description: string | null;
  partsInstalled: string | null;
  installedDate: string;
  installedBy: string | null;
  cost: number | null;
  nextServiceDue: string | null;
  createdAt: string;
}

export const listTrackerItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string }) => ({ vehicleId: String(d?.vehicleId ?? "") }))
  .handler(async ({ data, context }): Promise<TrackerRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("tracker_items")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .order("installed_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      trackerType: r.tracker_type,
      description: r.description ?? null,
      partsInstalled: r.parts_installed ?? null,
      installedDate: r.installed_date,
      installedBy: r.installed_by ?? null,
      cost: r.cost != null ? Number(r.cost) : null,
      nextServiceDue: r.next_service_due ?? null,
      createdAt: r.created_at,
    }));
  });

export const addTrackerItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    vehicleId: string;
    trackerType: string;
    description?: string;
    partsInstalled?: string;
    installedDate: string;
    installedBy?: string;
    cost?: number | null;
    nextServiceDue?: string | null;
  }) => {
    const vehicleId = String(d?.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("Missing vehicle");
    const trackerType = String(d?.trackerType ?? "").trim();
    if (!trackerType) throw new Error("Pick a tracker type");
    const installedDate = String(d?.installedDate ?? "").trim();
    if (!installedDate || Number.isNaN(Date.parse(installedDate))) throw new Error("Pick an installation date");
    let cost: number | null = null;
    if (d.cost != null && String(d.cost) !== "") {
      const n = Number(d.cost);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid cost");
      cost = Math.round(n * 100) / 100;
    }
    return {
      vehicleId,
      trackerType,
      description: (d.description ?? "").slice(0, 600) || null,
      partsInstalled: (d.partsInstalled ?? "").slice(0, 600) || null,
      installedDate,
      installedBy: (d.installedBy ?? "").slice(0, 160) || null,
      cost,
      nextServiceDue: d.nextServiceDue || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tracker_items")
      .insert({
        vehicle_id: data.vehicleId,
        tracker_type: data.trackerType,
        description: data.description,
        parts_installed: data.partsInstalled,
        installed_date: data.installedDate,
        installed_by: data.installedBy,
        cost: data.cost,
        next_service_due: data.nextServiceDue,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: row.id as string };
  });

export const deleteTrackerItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => ({ id: String(d?.id ?? "") }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tracker_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Save a vehicle's purchase price / date. */
export const setVehiclePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string; price: number | null; date?: string | null }) => {
    const vehicleId = String(d?.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("Missing vehicle");
    let price: number | null = null;
    if (d.price != null && String(d.price) !== "") {
      const n = Number(d.price);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid purchase price");
      price = Math.round(n * 100) / 100;
    }
    return { vehicleId, price, date: d.date || null };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("vehicles")
      .update({ purchase_price: data.price, purchase_date: data.date })
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getVehiclePurchase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string }) => ({ vehicleId: String(d?.vehicleId ?? "") }))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("vehicles")
      .select("purchase_price, purchase_date, checklist_required, checklist_status")
      .eq("id", data.vehicleId)
      .maybeSingle();
    return {
      price: row && (row as any).purchase_price != null ? Number((row as any).purchase_price) : null,
      date: (row as any)?.purchase_date ?? null,
      checklistRequired: row ? (row as any).checklist_required !== false : true,
      checklistStatus: (row as any)?.checklist_status ?? null,
    };
  });
