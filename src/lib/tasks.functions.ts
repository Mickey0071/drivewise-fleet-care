import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const TaskType = z.enum([
  "transport", "dmv", "repo", "parts", "inspection", "mechanic_run", "other",
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
  mr_vendor_name: z.string().trim().max(200).nullable().optional(),
  mr_contact_phone: z.string().trim().max(40).nullable().optional(),
  mr_work_order: z.string().trim().max(120).nullable().optional(),
  pr_vendor_name: z.string().trim().max(200).nullable().optional(),
  pr_contact_phone: z.string().trim().max(40).nullable().optional(),
  pr_parts_needed: z.string().trim().max(2000).nullable().optional(),
  pr_destination: z.string().trim().max(500).nullable().optional(),
  rp_reason: z.string().trim().max(200).nullable().optional(),
  rp_customer_name: z.string().trim().max(200).nullable().optional(),
  rp_customer_phone: z.string().trim().max(40).nullable().optional(),
  rp_tow_authorized: z.boolean().default(false),
  dr_service: z.string().trim().max(120).nullable().optional(),
  dr_documents_needed: z.record(z.string().max(120), z.boolean()).default({}),
  dr_location: z.string().trim().max(500).nullable().optional(),
  dr_expected_cost: z.number().min(0).max(100000).nullable().optional(),
  tr_from_address: z.string().trim().max(500).nullable().optional(),
  tr_to_address: z.string().trim().max(500).nullable().optional(),
  tr_reason: z.string().trim().max(120).nullable().optional(),
  tr_instructions: z.string().trim().max(2000).nullable().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!(data ?? []).some((r: { role: string }) => r.role === "admin")) throw new Error("Admins only");
}

function taskTypeLabel(t: string): string {
  const map: Record<string, string> = {
    transport: "🚚 Transport",
    dmv: "📋 DMV",
    repo: "🚨 Repo",
    parts: "🏷️ Parts",
    inspection: "✅ Inspection",
    mechanic_run: "🔧 Mechanic Run",
    other: "📌 Other",
  };
  return map[t] ?? "📌 Task";
}

/** Build the direct workflow URL for a task so the SMS link opens the runner
 *  straight into the right form (no task-list view in between). */
function taskWorkflowPath(
  taskType: string,
  taskId: string,
  opts?: { task_mode?: string | null; linked_rental_id?: string | null },
): string {
  const tid = encodeURIComponent(taskId);
  // Explicit return mode goes to the checklist in return mode.
  if (opts?.task_mode === "return") {
    const rental = opts?.linked_rental_id ? `&rental_id=${encodeURIComponent(opts.linked_rental_id)}` : "";
    return `/checklist?task_id=${tid}&mode=return${rental}`;
  }
  switch (taskType) {
    case "dmv": return `/dmv-run-task?task_id=${tid}`;
    case "mechanic_run": return `/mechanic-run-task?task_id=${tid}`;
    case "parts": return `/parts-run-task?task_id=${tid}`;
    case "repo": return `/repo-task?task_id=${tid}`;
    case "transport": return `/transport-task?task_id=${tid}`;
    case "inspection":
    case "other":
    default: return `/checklist?task_id=${tid}`;
  }
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
        mr_vendor_name: data.mr_vendor_name ?? null,
        mr_contact_phone: data.mr_contact_phone ?? null,
        mr_work_order: data.mr_work_order ?? null,
        pr_vendor_name: data.pr_vendor_name ?? null,
        pr_contact_phone: data.pr_contact_phone ?? null,
        pr_parts_needed: data.pr_parts_needed ?? null,
        pr_destination: data.pr_destination ?? null,
        rp_reason: data.rp_reason ?? null,
        rp_customer_name: data.rp_customer_name ?? null,
        rp_customer_phone: data.rp_customer_phone ?? null,
        rp_tow_authorized: data.rp_tow_authorized ?? false,
        dr_service: data.dr_service ?? null,
        dr_documents_needed: data.dr_documents_needed ?? {},
        dr_location: data.dr_location ?? null,
        dr_expected_cost: data.dr_expected_cost ?? null,
        tr_from_address: data.tr_from_address ?? null,
        tr_to_address: data.tr_to_address ?? null,
        tr_reason: data.tr_reason ?? null,
        tr_instructions: data.tr_instructions ?? null,
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
        `Open: ${origin}${taskWorkflowPath(data.task_type, id, { task_mode: data.task_mode, linked_rental_id: data.linked_rental_id })}`,
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
      .select("id, task_type, description, address, due_date, assigned_to_user_id, year, make, model, plate, runner_name, task_mode, linked_rental_id")
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
      `Open: ${origin}${taskWorkflowPath(task.task_type, task.id, { task_mode: task.task_mode, linked_rental_id: task.linked_rental_id })}`,
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

// Runner: complete a mechanic-run task (drop-off recorded in the field).
export const completeMechanicRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      task_id: z.string().min(1).max(80),
      mileage: z.number().int().min(0).max(2_000_000),
      mechanic_notes: z.string().max(4000).default(""),
      photos: z.array(z.string().url().max(1000)).max(20).default([]),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const nowIso = new Date().toISOString();

    const summary = [
      `Mechanic run drop-off completed at ${nowIso}.`,
      `Mileage at drop-off: ${data.mileage}.`,
      data.mechanic_notes.trim() ? `Mechanic notes: ${data.mechanic_notes.trim()}` : null,
      data.photos.length ? `Photos: ${data.photos.length} attached.` : null,
    ].filter(Boolean).join("\n");

    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: nowIso,
        mr_dropoff_mileage: data.mileage,
        mr_dropoff_at: nowIso,
        mr_mechanic_notes: data.mechanic_notes.trim() || null,
        mr_photos: data.photos,
        runner_notes: summary,
      })
      .eq("id", data.task_id);
    if (updErr) throw new Error(updErr.message);

    void notifyAdmins(`✅ Mechanic run completed`, data.task_id).catch((e) =>
      console.error("[mechanic run complete notify] failed:", e instanceof Error ? e.message : e),
    );

    return { ok: true };
  });

// Admin: approve a completed mechanic-run task and mark the vehicle as in-shop.
export const approveMechanicRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, status, linked_vehicle_id, mr_vendor_name, mr_dropoff_mileage, mr_dropoff_at")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");
    if (task.status !== "completed") throw new Error("Task is not completed yet");

    const nowIso = new Date().toISOString();
    const vendor = task.mr_vendor_name ?? "shop";

    if (task.linked_vehicle_id) {
      const update: {
        status: string;
        shop_vendor: string | null;
        shop_dropoff_at: string;
        has_open_issues: boolean;
        mileage?: number;
      } = {
        status: `In shop at ${vendor}`,
        shop_vendor: task.mr_vendor_name ?? null,
        shop_dropoff_at: task.mr_dropoff_at ?? nowIso,
        has_open_issues: true,
      };
      if (task.mr_dropoff_mileage != null) {
        const { data: veh } = await supabaseAdmin
          .from("vehicles")
          .select("mileage")
          .eq("id", task.linked_vehicle_id)
          .maybeSingle();
        if (!veh || task.mr_dropoff_mileage >= (veh.mileage ?? 0)) update.mileage = task.mr_dropoff_mileage;
      }
      const { error: vErr } = await supabaseAdmin
        .from("vehicles")
        .update(update)
        .eq("id", task.linked_vehicle_id);
      if (vErr) throw new Error(vErr.message);
    }

    const { error: aErr } = await supabaseAdmin
      .from("tasks")
      .update({ approved_at: nowIso })
      .eq("id", task.id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, approved_at: nowIso, vendor, mileage: task.mr_dropoff_mileage, vehicle_id: task.linked_vehicle_id };
  });

// Runner: complete a parts-run task (parts picked up + delivered in the field).
export const completePartsRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      task_id: z.string().min(1).max(80),
      parts_picked_up: z.array(z.object({
        label: z.string().trim().min(1).max(300),
        checked: z.boolean(),
      })).max(50).default([]),
      cost: z.number().min(0).max(1_000_000).nullable().default(null),
      photos: z.array(z.string().url().max(1000)).max(20).default([]),
      delivered: z.boolean(),
      delivery_notes: z.string().max(4000).default(""),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (!data.delivered) throw new Error("Delivery must be confirmed before completing");
    const nowIso = new Date().toISOString();

    const pickedLabels = data.parts_picked_up.filter((p) => p.checked).map((p) => p.label);
    const summary = [
      `Parts run completed at ${nowIso}.`,
      `Parts picked up: ${pickedLabels.length ? pickedLabels.join(", ") : "(none marked)"}.`,
      data.cost != null ? `Cost: $${data.cost.toFixed(2)}.` : null,
      data.photos.length ? `Photos: ${data.photos.length} attached.` : null,
      data.delivery_notes.trim() ? `Delivery notes: ${data.delivery_notes.trim()}` : null,
    ].filter(Boolean).join("\n");

    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: nowIso,
        pr_parts_picked_up: data.parts_picked_up,
        pr_cost: data.cost,
        pr_photos: data.photos,
        pr_pickup_at: nowIso,
        pr_delivered_at: nowIso,
        pr_delivery_notes: data.delivery_notes.trim() || null,
        runner_notes: summary,
      })
      .eq("id", data.task_id);
    if (updErr) throw new Error(updErr.message);

    void notifyAdmins(`✅ Parts run completed`, data.task_id).catch((e) =>
      console.error("[parts run complete notify] failed:", e instanceof Error ? e.message : e),
    );

    return { ok: true };
  });

// Admin: approve a completed parts-run task and log the cost to the vehicle's maintenance.
export const approvePartsRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, status, linked_vehicle_id, pr_vendor_name, pr_parts_needed, pr_destination, pr_cost, pr_parts_picked_up")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");
    if (task.status !== "completed") throw new Error("Task is not completed yet");

    const nowIso = new Date().toISOString();
    let maintenance_id: string | null = null;

    // Log the parts pickup to a maintenance entry for the linked vehicle.
    if (task.linked_vehicle_id) {
      const picked = Array.isArray(task.pr_parts_picked_up)
        ? (task.pr_parts_picked_up as Array<{ label: string; checked: boolean }>)
            .filter((p) => p?.checked).map((p) => p.label)
        : [];
      const partsText = picked.length ? picked.join(", ") : (task.pr_parts_needed ?? "Parts");

      // Prefer appending to an existing open maintenance ticket for this vehicle.
      const { data: openMaint } = await supabaseAdmin
        .from("maintenance")
        .select("id, cost, notes")
        .eq("vehicle_id", task.linked_vehicle_id)
        .is("date_completed", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openMaint) {
        const appended = [
          openMaint.notes,
          `--- Parts run ---\nParts: ${partsText}${task.pr_vendor_name ? `\nVendor: ${task.pr_vendor_name}` : ""}${task.pr_destination ? `\nDelivered to: ${task.pr_destination}` : ""}${task.pr_cost != null ? `\nCost: $${Number(task.pr_cost).toFixed(2)}` : ""}`,
        ].filter(Boolean).join("\n\n");
        const { error: mErr } = await supabaseAdmin
          .from("maintenance")
          .update({
            cost: Number(openMaint.cost ?? 0) + Number(task.pr_cost ?? 0),
            notes: appended,
          })
          .eq("id", openMaint.id);
        if (mErr) throw new Error(mErr.message);
        maintenance_id = openMaint.id;
      } else {
        const id = `MN-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
        const { error: mErr } = await supabaseAdmin
          .from("maintenance")
          .insert({
            id,
            vehicle_id: task.linked_vehicle_id,
            service_type: `Parts: ${partsText}`,
            vendor: task.pr_vendor_name ?? "Parts vendor",
            date_completed: nowIso.slice(0, 10),
            mileage_at_service: 0,
            cost: Number(task.pr_cost ?? 0),
            notes: `Parts run delivered${task.pr_destination ? ` to ${task.pr_destination}` : ""}.`,
            next_service_due: nowIso.slice(0, 10),
          });
        if (mErr) throw new Error(mErr.message);
        maintenance_id = id;
      }
    }

    const { error: aErr } = await supabaseAdmin
      .from("tasks")
      .update({ approved_at: nowIso })
      .eq("id", task.id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, approved_at: nowIso, maintenance_id, cost: task.pr_cost, vehicle_id: task.linked_vehicle_id };
  });

// Runner: complete a repo task (vehicle recovered in the field).
export const completeRepoTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      task_id: z.string().min(1).max(80),
      status_checklist: z.record(z.string().max(80), z.boolean()).default({}),
      odometer: z.number().int().min(0).max(2_000_000).nullable().default(null),
      photos: z.array(z.string().url().max(1000)).max(20).default([]),
      location_after: z.string().trim().max(500).default(""),
      notes: z.string().max(4000).default(""),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const nowIso = new Date().toISOString();

    const checkedLabels = Object.entries(data.status_checklist)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const summary = [
      `Repo completed at ${nowIso}.`,
      `Vehicle status: ${checkedLabels.length ? checkedLabels.join(", ") : "(none marked)"}.`,
      data.odometer != null ? `Odometer: ${data.odometer.toLocaleString()} mi.` : null,
      data.location_after.trim() ? `Location after repo: ${data.location_after.trim()}` : null,
      data.photos.length ? `Photos: ${data.photos.length} attached.` : null,
      data.notes.trim() ? `Notes: ${data.notes.trim()}` : null,
    ].filter(Boolean).join("\n");

    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: nowIso,
        rp_status_checklist: data.status_checklist,
        rp_odometer: data.odometer,
        rp_photos: data.photos,
        rp_pickup_at: nowIso,
        rp_location_after: data.location_after.trim() || null,
        rp_notes: data.notes.trim() || null,
        runner_notes: summary,
      })
      .eq("id", data.task_id);
    if (updErr) throw new Error(updErr.message);

    void notifyAdmins(`🚨 Repo completed`, data.task_id).catch((e) =>
      console.error("[repo complete notify] failed:", e instanceof Error ? e.message : e),
    );

    return { ok: true };
  });

// Admin: approve a completed repo task and mark the vehicle as repossessed.
export const approveRepoTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, status, linked_vehicle_id, linked_rental_id, rp_odometer, rp_location_after, rp_pickup_at")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");
    if (task.status !== "completed") throw new Error("Task is not completed yet");

    const nowIso = new Date().toISOString();
    const repoDate = (task.rp_pickup_at ?? nowIso).slice(0, 10);

    // Update the vehicle: REPO'D status, location, repo date, odometer (forward only).
    if (task.linked_vehicle_id) {
      const update: {
        status: string;
        repo_location: string | null;
        repo_date: string;
        has_open_issues: boolean;
        mileage?: number;
      } = {
        status: "REPO'D",
        repo_location: task.rp_location_after ?? null,
        repo_date: repoDate,
        has_open_issues: true,
      };
      if (task.rp_odometer != null) {
        const { data: veh } = await supabaseAdmin
          .from("vehicles")
          .select("mileage")
          .eq("id", task.linked_vehicle_id)
          .maybeSingle();
        if (!veh || task.rp_odometer >= (veh.mileage ?? 0)) update.mileage = task.rp_odometer;
      }
      const { error: vErr } = await supabaseAdmin
        .from("vehicles")
        .update(update)
        .eq("id", task.linked_vehicle_id);
      if (vErr) throw new Error(vErr.message);
    }

    // Close the linked rental (repo'd, not returned).
    if (task.linked_rental_id) {
      const { error: rErr } = await supabaseAdmin
        .from("rentals")
        .update({ reservation_status: "closed", payment_status: "repossessed", returned_at: nowIso })
        .eq("id", task.linked_rental_id);
      if (rErr) throw new Error(rErr.message);
    }

    const { error: aErr } = await supabaseAdmin
      .from("tasks")
      .update({ approved_at: nowIso })
      .eq("id", task.id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, approved_at: nowIso, repo_date: repoDate, location: task.rp_location_after, mileage: task.rp_odometer, vehicle_id: task.linked_vehicle_id };
  });

// Runner: complete a DMV run (service done at the DMV office).
export const completeDmvRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      task_id: z.string().min(1).max(80),
      documents_packed: z.record(z.string().max(120), z.boolean()).default({}),
      arrival_at: z.string().datetime().nullable().default(null),
      service_completed: z.record(z.string().max(120), z.boolean()).default({}),
      actual_cost: z.number().min(0).max(100000).nullable().default(null),
      documents_received: z.record(z.string().max(120), z.boolean()).default({}),
      photos: z.array(z.string().url().max(1000)).max(20).default([]),
      new_reg_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      new_sticker_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      notes: z.string().max(4000).default(""),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const nowIso = new Date().toISOString();

    const packed = Object.entries(data.documents_packed).filter(([, v]) => v).map(([k]) => k);
    const completed = Object.entries(data.service_completed).filter(([, v]) => v).map(([k]) => k);
    const received = Object.entries(data.documents_received).filter(([, v]) => v).map(([k]) => k);
    const summary = [
      `DMV run completed at ${nowIso}.`,
      packed.length ? `Documents packed: ${packed.join(", ")}.` : null,
      completed.length ? `Service completed: ${completed.join(", ")}.` : null,
      data.actual_cost != null ? `Actual cost: $${data.actual_cost.toFixed(2)}.` : null,
      received.length ? `Documents received: ${received.join(", ")}.` : null,
      data.new_reg_expiry ? `New registration expiry: ${data.new_reg_expiry}.` : null,
      data.new_sticker_expiry ? `New sticker expiry: ${data.new_sticker_expiry}.` : null,
      data.photos.length ? `Photos: ${data.photos.length} attached.` : null,
      data.notes.trim() ? `Notes: ${data.notes.trim()}` : null,
    ].filter(Boolean).join("\n");

    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: nowIso,
        dr_documents_packed: data.documents_packed,
        dr_arrival_at: data.arrival_at,
        dr_service_completed: data.service_completed,
        dr_actual_cost: data.actual_cost,
        dr_documents_received: data.documents_received,
        dr_photos: data.photos,
        dr_completion_at: nowIso,
        dr_new_reg_expiry: data.new_reg_expiry,
        dr_new_sticker_expiry: data.new_sticker_expiry,
        dr_notes: data.notes.trim() || null,
        runner_notes: summary,
      })
      .eq("id", data.task_id);
    if (updErr) throw new Error(updErr.message);

    void notifyAdmins(`📋 DMV run completed`, data.task_id).catch((e) =>
      console.error("[dmv run complete notify] failed:", e instanceof Error ? e.message : e),
    );

    return { ok: true };
  });

// Admin: approve a completed DMV run and update the vehicle's registration / sticker dates.
export const approveDmvRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ task_id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: task, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select("id, status, linked_vehicle_id, dr_service, dr_actual_cost, dr_expected_cost, dr_new_reg_expiry, dr_new_sticker_expiry, dr_completion_at")
      .eq("id", data.task_id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");
    if (task.status !== "completed") throw new Error("Task is not completed yet");

    const nowIso = new Date().toISOString();
    const serviceDate = (task.dr_completion_at ?? nowIso).slice(0, 10);
    const cost = Number(task.dr_actual_cost ?? task.dr_expected_cost ?? 0);

    // Update the vehicle: registration/sticker expiry + last DMV service date.
    if (task.linked_vehicle_id) {
      const vUpdate: {
        last_dmv_service_at: string;
        registration_expiry?: string;
        inspection_sticker_expiry?: string;
      } = { last_dmv_service_at: serviceDate };
      if (task.dr_new_reg_expiry) vUpdate.registration_expiry = task.dr_new_reg_expiry;
      if (task.dr_new_sticker_expiry) vUpdate.inspection_sticker_expiry = task.dr_new_sticker_expiry;
      const { error: vErr } = await supabaseAdmin
        .from("vehicles")
        .update(vUpdate)
        .eq("id", task.linked_vehicle_id);
      if (vErr) throw new Error(vErr.message);

      // Log the DMV cost to a maintenance entry for the vehicle.
      if (cost > 0) {
        const id = `MN-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
        const { error: mErr } = await supabaseAdmin
          .from("maintenance")
          .insert({
            id,
            vehicle_id: task.linked_vehicle_id,
            service_type: `DMV: ${task.dr_service ?? "DMV service"}`,
            vendor: "DMV",
            date_completed: serviceDate,
            mileage_at_service: 0,
            cost,
            notes: `DMV run${task.dr_new_reg_expiry ? ` · registration now expires ${task.dr_new_reg_expiry}` : ""}${task.dr_new_sticker_expiry ? ` · sticker now expires ${task.dr_new_sticker_expiry}` : ""}.`,
            next_service_due: serviceDate,
          });
        if (mErr) throw new Error(mErr.message);
      }
    }

    const { error: aErr } = await supabaseAdmin
      .from("tasks")
      .update({ approved_at: nowIso })
      .eq("id", task.id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, approved_at: nowIso, vehicle_id: task.linked_vehicle_id, registration_expiry: task.dr_new_reg_expiry, sticker_expiry: task.dr_new_sticker_expiry, cost };
  });