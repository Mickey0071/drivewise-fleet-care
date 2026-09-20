import { createServerFn } from "@tanstack/react-start";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_NOTIFY_PHONE = "267-221-3977";

function validToken(raw: unknown): string {
  const token = String(raw ?? "").trim();
  if (!token || token.length > 80 || !/^[a-f0-9]+$/i.test(token)) throw new Error("Invalid link");
  return token;
}

export interface PublicChecklistItem {
  id: string;
  category: string;
  itemName: string;
  status: string;
  notes: string | null;
}

export interface PublicChecklist {
  state: "ok" | "completed" | "expired" | "invalid";
  checklist?: {
    id: string;
    plate: string;
    vehicleLabel: string;
    runnerName: string | null;
    status: string;
    notes: string | null;
    completedByName: string | null;
    completedAt: string | null;
    items: PublicChecklistItem[];
  };
}

/** Public: load a checklist by its SMS link token. */
export const getChecklistByToken = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => ({ token: validToken(d?.token) }))
  .handler(async ({ data }): Promise<PublicChecklist> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("vehicle_checklists")
      .select("*, vehicles(plate, year, make, model)")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { state: "invalid" };
    const { data: items } = await supabaseAdmin
      .from("checklist_items")
      .select("*")
      .eq("checklist_id", row.id)
      .order("sort_order", { ascending: true });
    const v: any = (row as any).vehicles;
    const payload = {
      id: row.id as string,
      plate: v?.plate ?? "",
      vehicleLabel: `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim(),
      runnerName: row.assigned_runner_name ?? null,
      status: row.status as string,
      notes: row.notes ?? null,
      completedByName: row.completed_by_name ?? null,
      completedAt: row.completed_at ?? null,
      items: (items ?? []).map((i: any) => ({
        id: i.id,
        category: i.category,
        itemName: i.item_name,
        status: i.status,
        notes: i.notes ?? null,
      })),
    };
    if (row.status === "completed") return { state: "completed", checklist: payload };
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())
      return { state: "expired" };
    return { state: "ok", checklist: payload };
  });

/** Public: auto-save one checklist item as the runner works. */
export const saveChecklistItem = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; itemId: string; status?: string; notes?: string }) => {
    const token = validToken(d?.token);
    const itemId = String(d?.itemId ?? "").trim();
    if (!itemId) throw new Error("Missing item");
    const status = d.status ? String(d.status) : undefined;
    if (status && !["pending", "pass", "fail", "n/a"].includes(status)) throw new Error("Invalid status");
    return { token, itemId, status, notes: d.notes != null ? String(d.notes).slice(0, 1000) : undefined };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cl } = await supabaseAdmin
      .from("vehicle_checklists")
      .select("id, status")
      .eq("token", data.token)
      .maybeSingle();
    if (!cl) throw new Error("Invalid link");
    if (cl.status === "completed") throw new Error("This checklist is already submitted");

    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.checked_at = new Date().toISOString();
    }
    if (data.notes !== undefined) patch.notes = data.notes || null;
    const { error } = await supabaseAdmin
      .from("checklist_items")
      .update(patch)
      .eq("id", data.itemId)
      .eq("checklist_id", cl.id);
    if (error) throw new Error(error.message);

    if (cl.status === "pending") {
      await supabaseAdmin.from("vehicle_checklists").update({ status: "in_progress" }).eq("id", cl.id);
    }
    return { ok: true as const };
  });

/** Public: runner submits the finished checklist. */
export const submitChecklist = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; runnerName: string; signature?: string; notes?: string }) => {
    const token = validToken(d?.token);
    const runnerName = String(d?.runnerName ?? "").trim();
    if (!runnerName || runnerName.length > 120) throw new Error("Enter your name");
    return {
      token,
      runnerName,
      signature: (d.signature ?? "").slice(0, 200) || null,
      notes: (d.notes ?? "").slice(0, 2000) || null,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cl } = await supabaseAdmin
      .from("vehicle_checklists")
      .select("id, status, vehicle_id, vehicles(plate)")
      .eq("token", data.token)
      .maybeSingle();
    if (!cl) throw new Error("Invalid link");
    if (cl.status === "completed") throw new Error("Already submitted");

    const { data: items } = await supabaseAdmin
      .from("checklist_items")
      .select("id, item_name, status, notes")
      .eq("checklist_id", cl.id);
    const list = items ?? [];
    const pending = list.filter((i: any) => i.status === "pending");
    if (pending.length) throw new Error(`${pending.length} item(s) still need Pass / Fail / N/A`);
    const failed = list.filter((i: any) => i.status === "fail");
    const missingNotes = failed.filter((i: any) => !(i.notes ?? "").trim());
    if (missingNotes.length) {
      throw new Error(`Add notes for every failed item: ${missingNotes.map((i: any) => i.item_name).join(", ")}`);
    }
    const passed = list.filter((i: any) => i.status === "pass").length;
    const na = list.filter((i: any) => i.status === "n/a").length;

    const { error } = await supabaseAdmin
      .from("vehicle_checklists")
      .update({
        status: "completed",
        vehicle_can_list: true,
        completed_at: new Date().toISOString(),
        completed_by_name: data.runnerName,
        signature: data.signature,
        notes: data.notes,
      })
      .eq("id", cl.id);
    if (error) throw new Error(error.message);

    const plate = (cl as any).vehicles?.plate ?? cl.vehicle_id;
    try {
      await sendSms(
        ADMIN_NOTIFY_PHONE,
        `Checklist complete for ${plate}. ${passed} items passed, ${failed.length} failed. Ready to list.`,
        "Camauto Admin",
      );
    } catch (e) {
      console.error("checklist completion SMS failed", e);
    }
    return { ok: true as const, passed, failed: failed.length, na };
  });
