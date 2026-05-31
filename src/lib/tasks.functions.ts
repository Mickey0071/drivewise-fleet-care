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
  task_mode: z.enum(["return"]).nullable().optional(),
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
        task_mode: data.task_mode ?? null,
      })
      .select("id")
      .single();
    if (insErr || !created) throw new Error(insErr?.message ?? "Failed to create task");

    // Debug logging for SMS dispatch
    console.log(`[adminCreateTask] task=${created.id} notify_sms=${data.notify_sms} runner_phone=${runner?.phone ?? "(none)"} will_send=${Boolean(data.notify_sms && runner?.phone)}`);

    let smsStatus: "sent" | "failed" | "skipped_no_phone" = "skipped_no_phone";
    let smsError: string | null = null;
    if (data.notify_sms && runner?.phone) {
      const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
      const vehicleForMsg = vehicleLabel || "vehicle";
      const lines = [
        `New task assigned: ${taskTypeLabel(data.task_type)} for ${vehicleForMsg}. Check your app.`,
        data.address ? `Address: ${data.address}` : null,
        data.due_date ? `Due: ${data.due_date}` : null,
        `Open: ${origin}/my-tasks/${id}`,
      ].filter(Boolean) as string[];
      const body = lines.join("\n");
      try {
        await sendSms(runner.phone, body, runnerName);
        smsStatus = "sent";
        console.log(`[adminCreateTask] sendSms OK task=${created.id}`);
      } catch (e) {
        smsStatus = "failed";
        smsError = e instanceof Error ? e.message : String(e);
        console.error(`[adminCreateTask] sendSms FAILED task=${created.id}:`, smsError);
      }
    } else {
      console.log(`[adminCreateTask] sendSms SKIPPED task=${created.id} reason=${!data.notify_sms ? "notify_sms=false" : "no runner phone"}`);
    }

    return { task_id: created.id, runner_name: runnerName, sms_status: smsStatus, sms_error: smsError };
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

    void notifyAdmins(`✅ Task completed`, data.task_id).catch((e) =>
      console.error("[task complete notify] failed:", e instanceof Error ? e.message : e),
    );

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

    // Notify admins that the runner has started the task.
    void notifyAdmins(
      `🟢 Task started`,
      data.task_id,
    ).catch((e) => console.error("[task start notify] failed:", e instanceof Error ? e.message : e));

    return { ok: true };
  });

// Send an SMS to every admin with a phone number on file. Best-effort.
async function notifyAdmins(headline: string, taskId: string) {
  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("task_type, description, year, make, model, plate, runner_name")
    .eq("id", taskId)
    .maybeSingle();
  const vehicleLabel = task?.year
    ? `${task.year} ${task.make ?? ""} ${task.model ?? ""} ${task.plate ?? ""}`.trim()
    : "";
  const lines = [
    headline,
    task ? `Type: ${taskTypeLabel(task.task_type)}` : null,
    task?.runner_name ? `Runner: ${task.runner_name}` : null,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    task?.description ? task.description : null,
    `Task: ${taskId}`,
  ].filter(Boolean) as string[];
  const body = lines.join("\n");

  const { data: adminRoles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  const ids = (adminRoles ?? []).map((r) => r.user_id);
  if (ids.length === 0) return;
  const { data: admins } = await supabaseAdmin
    .from("profiles")
    .select("phone, full_name, first_name, last_name")
    .in("id", ids);
  const seen = new Set<string>();
  for (const a of admins ?? []) {
    if (!a.phone || seen.has(a.phone)) continue;
    seen.add(a.phone);
    const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.full_name || "Admin";
    void sendSms(a.phone, body, name).catch((e) =>
      console.error("[admin notify] failed:", e instanceof Error ? e.message : e),
    );
  }
}

const DmvDocsInput = z.object({
  task_id: z.string().min(1).max(80).optional(),
  documents: z.record(z.string().max(80), z.boolean()).default({}),
  notes: z.string().max(4000).default(""),
  vehicle_id: z.string().min(1).max(80).optional(),
});

export const completeDmvTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DmvDocsInput.parse(input))
  .handler(async ({ data, context }) => {
    const checkedLabels = Object.entries(data.documents)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const summary =
      `DMV run completed at ${new Date().toISOString()}. ` +
      `Documents handled: ${checkedLabels.length ? checkedLabels.join(", ") : "(none marked)"}. ` +
      `Notes: ${data.notes.trim() || "(none)"}.`;

    if (data.task_id) {
      const { error } = await context.supabase
        .from("tasks")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          runner_notes: summary,
        })
        .eq("id", data.task_id);
      if (error) throw new Error(error.message);

      void notifyAdmins(`✅ DMV task completed`, data.task_id).catch((e) =>
        console.error("[dmv complete notify] failed:", e instanceof Error ? e.message : e),
      );
    } else {
      // Standalone DMV run (no task assigned) — broadcast a custom summary to admins.
      void notifyAdminsRaw(`✅ DMV run completed (standalone)\n${summary}${data.vehicle_id ? `\nVehicle: ${data.vehicle_id}` : ""}`)
        .catch((e) => console.error("[dmv standalone notify] failed:", e instanceof Error ? e.message : e));
    }

    return { ok: true };
  });

// Broadcast a free-form message to every admin's phone. Best-effort.
async function notifyAdminsRaw(body: string) {
  const { data: adminRoles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  const ids = (adminRoles ?? []).map((r) => r.user_id);
  if (ids.length === 0) return;
  const { data: admins } = await supabaseAdmin
    .from("profiles")
    .select("phone, full_name, first_name, last_name")
    .in("id", ids);
  const seen = new Set<string>();
  for (const a of admins ?? []) {
    if (!a.phone || seen.has(a.phone)) continue;
    seen.add(a.phone);
    const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.full_name || "Admin";
    void sendSms(a.phone, body, name).catch((e) =>
      console.error("[admin notify raw] failed:", e instanceof Error ? e.message : e),
    );
  }
}

const MechanicDropoffInput = z.object({
  vehicle_id: z.string().min(1).max(80),
  mechanic_type: z.string().min(1).max(120),
  reason: z.string().min(1).max(2000),
  notes: z.string().max(2000).default(""),
});

export const createMechanicDropoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => MechanicDropoffInput.parse(input))
  .handler(async ({ data, context }) => {
    // Look up vehicle for SMS context + mileage default
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("year, make, model, plate, mileage")
      .eq("id", data.vehicle_id)
      .maybeSingle();
    const vehicleLabel = vehicle
      ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""} ${vehicle.plate ?? ""}`.trim()
      : data.vehicle_id;

    const id = `MN-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const composedNotes = [
      `Mechanic type: ${data.mechanic_type}`,
      `Reason for drop off: ${data.reason}`,
      data.notes.trim() ? `Notes: ${data.notes.trim()}` : null,
    ].filter(Boolean).join("\n");

    // Use the user-scoped client so RLS enforces runner/admin insert policy.
    const { error } = await context.supabase
      .from("maintenance")
      .insert({
        id,
        vehicle_id: data.vehicle_id,
        service_type: `Mechanic drop-off: ${data.mechanic_type}`,
        vendor: data.mechanic_type,
        date_completed: null,
        mileage_at_service: vehicle?.mileage ?? 0,
        cost: 0,
        notes: composedNotes,
        next_service_due: new Date().toISOString().slice(0, 10),
      });
    if (error) throw new Error(error.message);

    // Flip the vehicle's open-issue flag so it shows the warning.
    await supabaseAdmin.from("vehicles").update({ has_open_issues: true }).eq("id", data.vehicle_id);

    void notifyAdminsRaw(
      `🔧 Vehicle dropped at mechanic\nVehicle: ${vehicleLabel}\n${composedNotes}\nMaintenance: ${id}`,
    ).catch((e) => console.error("[mechanic dropoff notify] failed:", e instanceof Error ? e.message : e));

    return { ok: true, maintenance_id: id };
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
      `New task assigned (resend): ${taskTypeLabelExport(task.task_type)} for ${vehicleLabel || "vehicle"}. Check your app.`,
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
    let profiles: Array<{ id: string; first_name: string | null; last_name: string | null; username: string | null; phone: string | null }> = [];
    if (ids.length > 0) {
      const { data, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, username, phone")
        .in("id", ids);
      if (pErr) throw new Error(pErr.message);
      profiles = data ?? [];
    }
    // Also surface staff entries with role='runner' that don't have an auth account yet.
    const { data: staffRows } = await supabaseAdmin
      .from("staff")
      .select("id, full_name, phone, role, status")
      .eq("status", "active");
    const havePhones = new Set(profiles.map((p) => (p.phone ?? "").replace(/\D/g, "")).filter(Boolean));
    const extraFromStaff = (staffRows ?? [])
      .filter((s) => (s.role ?? "").toLowerCase().includes("runner"))
      .filter((s) => !havePhones.has((s.phone ?? "").replace(/\D/g, "")))
      .map((s) => ({
        id: `staff:${s.id}`,
        first_name: s.full_name,
        last_name: null,
        username: null,
        phone: s.phone ?? null,
      }));
    return { runners: [...profiles, ...extraFromStaff] };
  });

// Admin: approve a completed inspection task and push the recorded mileage +
// inspection date back onto the linked vehicle's fleet record.
export const approveInspectionTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, task_type, linked_vehicle_id, completed_inspection_id, status")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");
    if (task.status !== "completed") throw new Error("Task is not completed yet");

    // Pull the recorded mileage from the linked inspection (if any).
    let mileage: number | null = null;
    if (task.completed_inspection_id) {
      const { data: insp } = await supabaseAdmin
        .from("inspections")
        .select("mileage")
        .eq("id", task.completed_inspection_id)
        .maybeSingle();
      if (insp && typeof insp.mileage === "number") mileage = insp.mileage;
    }

    const nowIso = new Date().toISOString();

    // Update the vehicle's fleet record: last inspection date + mileage.
    if (task.linked_vehicle_id) {
      const update: {
        last_inspection_at: string;
        last_inspection_mileage?: number;
        mileage?: number;
      } = {
        last_inspection_at: nowIso,
      };
      if (mileage != null) {
        update.last_inspection_mileage = mileage;
        // Only advance odometer forward.
        const { data: veh } = await supabaseAdmin
          .from("vehicles")
          .select("mileage")
          .eq("id", task.linked_vehicle_id)
          .maybeSingle();
        if (!veh || mileage >= (veh.mileage ?? 0)) update.mileage = mileage;
      }
      const { error: vErr } = await supabaseAdmin
        .from("vehicles")
        .update(update)
        .eq("id", task.linked_vehicle_id);
      if (vErr) throw new Error(vErr.message);
    }

    // Mark the task approved.
    const { error: aErr } = await supabaseAdmin
      .from("tasks")
      .update({ approved_at: nowIso })
      .eq("id", task.id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, mileage, last_inspection_at: nowIso, vehicle_id: task.linked_vehicle_id };
  });