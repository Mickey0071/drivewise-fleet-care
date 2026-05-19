import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const TaskType = z.enum([
  "pickup", "dropoff", "dmv", "repo", "parts", "inspection", "mechanic_run", "other",
]);
const Priority = z.enum(["urgent", "normal", "flexible"]);

const CreateInput = z.object({
  assigned_to_user_id: z.string().uuid(),
  task_type: TaskType,
  linked_vehicle_id: z.string().min(1).max(80).nullable().optional(),
  linked_rental_id: z.string().min(1).max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: Priority.default("normal"),
  notify_sms: z.boolean().default(true),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!(data ?? []).some((r: { role: string }) => r.role === "admin")) throw new Error("Admins only");
}

function taskTypeLabel(t: string): string {
  const map: Record<string, string> = {
    pickup: "🔑 Pickup",
    dropoff: "🚗 Dropoff",
    dmv: "📋 DMV",
    repo: "🚨 Repo",
    parts: "🏷️ Parts",
    inspection: "✅ Inspection",
    mechanic_run: "🔧 Mechanic Run",
    other: "📌 Other",
  };
  return map[t] ?? "📌 Task";
}

export const adminCreateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Lookup runner profile (for SMS phone + display name)
    const { data: runner, error: runnerErr } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, full_name, username, phone")
      .eq("id", data.assigned_to_user_id)
      .maybeSingle();
    if (runnerErr) throw new Error(runnerErr.message);
    const runnerName = [runner?.first_name, runner?.last_name].filter(Boolean).join(" ")
      || runner?.full_name || runner?.username || "Runner";

    // Lookup vehicle for SMS context + denormalized columns
    let vehicleLabel = "";
    let vehiclePlate: string | null = null;
    let vehicleMake: string | null = null;
    let vehicleModel: string | null = null;
    let vehicleYear: number | null = null;
    if (data.linked_vehicle_id) {
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("year, make, model, plate")
        .eq("id", data.linked_vehicle_id)
        .maybeSingle();
      if (v) {
        vehicleLabel = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.plate ?? ""}`.trim();
        vehiclePlate = v.plate ?? null;
        vehicleMake = v.make ?? null;
        vehicleModel = v.model ?? null;
        vehicleYear = v.year ?? null;
      }
    }

    const id = `tsk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const { data: created, error: insErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        id,
        assigned_to_user_id: data.assigned_to_user_id,
        task_type: data.task_type,
        linked_vehicle_id: data.linked_vehicle_id ?? null,
        linked_rental_id: data.linked_rental_id ?? null,
        description: data.description ?? null,
        address: data.address ?? null,
        due_date: data.due_date ?? null,
        priority_level: data.priority,
        status: "pending",
        runner_name: runnerName,
        plate: vehiclePlate,
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear,
      })
      .select("id")
      .single();
    if (insErr || !created) throw new Error(insErr?.message ?? "Failed to create task");

    // Fire-and-forget SMS so a slow/failed GHL call never blocks task creation.
    let smsStatus: "queued" | "skipped_no_phone" = "skipped_no_phone";
    if (data.notify_sms && runner?.phone) {
      smsStatus = "queued";
      const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
      const lines = [
        `Camauto Task: ${taskTypeLabel(data.task_type)}`,
        vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
        data.description ? data.description : null,
        data.address ? `Address: ${data.address}` : null,
        data.due_date ? `Due: ${data.due_date}` : null,
        `Open: ${origin}/my-tasks/${id}`,
      ].filter(Boolean) as string[];
      const body = lines.join("\n");
      // Intentionally not awaited — best-effort background send.
      void sendSms(runner.phone, body, runnerName)
        .then(() => console.log(`[task sms] sent task=${created.id}`))
        .catch((e) => console.error(`[task sms] failed task=${created.id}:`, e instanceof Error ? e.message : e));
    }

    return { task_id: created.id, runner_name: runnerName, sms_status: smsStatus, sms_error: null };
  });

export const completeTaskFromInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      task_id: z.string().min(1).max(80),
      inspection_id: z.string().min(1).max(80),
      runner_notes: z.string().max(4000),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    // Use the user-scoped client so RLS enforces ownership (runner) or admin override.
    const { supabase } = context;

    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_inspection_id: data.inspection_id,
        runner_notes: data.runner_notes,
      })
      .eq("id", data.task_id);
    if (updErr) throw new Error(updErr.message);

    // Find any maintenance row that the inspections_auto_maintenance trigger created
    // and append the runner notes summary. Admin client because runners can't read maintenance.
    const { data: maint } = await supabaseAdmin
      .from("maintenance")
      .select("id, notes")
      .eq("source_inspection_id", data.inspection_id)
      .maybeSingle();
    let maintenance_id: string | null = null;
    if (maint) {
      const appended = [maint.notes, `--- Runner task notes ---\n${data.runner_notes}`]
        .filter(Boolean).join("\n\n");
      const { error: mErr } = await supabaseAdmin
        .from("maintenance")
        .update({ notes: appended })
        .eq("id", maint.id);
      if (mErr) throw new Error(mErr.message);
      maintenance_id = maint.id;
    }

    return { ok: true, maintenance_id };
  });

export const startTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks")
      .update({ status: "in_progress" })
      .eq("id", data.task_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function taskTypeLabelExport(t: string): string {
  return taskTypeLabel(t);
}

export const resendTaskSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, task_type, description, address, due_date, assigned_to_user_id, year, make, model, plate, runner_name")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");

    if (!task.assigned_to_user_id) {
      return { ok: false, sms_status: "skipped_no_phone" as const };
    }
    const { data: runner } = await supabaseAdmin
      .from("profiles")
      .select("phone, first_name, last_name, full_name, username")
      .eq("id", task.assigned_to_user_id)
      .maybeSingle();
    if (!runner?.phone) {
      return { ok: false, sms_status: "skipped_no_phone" as const };
    }
    const runnerName = [runner.first_name, runner.last_name].filter(Boolean).join(" ")
      || runner.full_name || runner.username || task.runner_name || "Runner";

    const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
    const vehicleLabel = task.year ? `${task.year} ${task.make ?? ""} ${task.model ?? ""} ${task.plate ?? ""}`.trim() : "";
    const lines = [
      `Camauto Task (resend): ${taskTypeLabelExport(task.task_type)}`,
      vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
      task.description ? task.description : null,
      task.address ? `Address: ${task.address}` : null,
      task.due_date ? `Due: ${task.due_date}` : null,
      `Open: ${origin}/my-tasks/${task.id}`,
    ].filter(Boolean) as string[];

    try {
      await sendSms(runner.phone, lines.join("\n"), runnerName);
      return { ok: true, sms_status: "sent" as const };
    } catch (e) {
      return { ok: false, sms_status: "failed" as const, error: e instanceof Error ? e.message : "SMS failed" };
    }
  });

export const listAssignableRunners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["runner", "driver"]);
    if (rErr) throw new Error(rErr.message);
    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return { runners: [] as Array<{ id: string; first_name: string | null; last_name: string | null; username: string | null; phone: string | null }> };
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, username, phone")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    return { runners: profiles ?? [] };
  });