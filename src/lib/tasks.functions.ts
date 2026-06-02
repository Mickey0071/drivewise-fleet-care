import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";
import { TASK_TYPE_KEYS } from "@/lib/task-types";

/** Admin: assign a task to a runner for a vehicle and SMS them the link. */
export const assignTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    type: string;
    vehicleId: string;
    runnerId: string;
    details?: Record<string, unknown>;
    dueDate?: string | null;
    origin: string;
    vehicleLabel?: string;
  }) => {
    if (!input.type || !TASK_TYPE_KEYS.includes(input.type as any)) throw new Error("Invalid task type");
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.runnerId) throw new Error("runnerId required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("Invalid due date");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS "Admins manage runner_tasks" gates this insert to admins only.
    const { data: row, error } = await supabase
      .from("runner_tasks")
      .insert({
        type: data.type,
        vehicle_id: data.vehicleId,
        runner_id: data.runnerId,
        assigned_by: context.userId,
        due_date: data.dueDate || null,
        details: (data.details ?? {}) as any,
        status: "assigned",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Look up runner phone + name to send the SMS.
    const { data: runner } = await supabase
      .from("profiles")
      .select("full_name, first_name, phone")
      .eq("id", data.runnerId)
      .maybeSingle();

    const taskId = row.id as string;
    const url = `${data.origin.replace(/\/$/, "")}/runner/task/${encodeURIComponent(taskId)}`;
    const label = data.vehicleLabel || data.vehicleId;
    const typeLabel = data.type;
    let smsStatus: "sent" | "skipped_no_phone" = "skipped_no_phone";
    if (runner?.phone && runner.phone.length >= 7) {
      const msg = `Camauto: New task — ${typeLabel} on ${label}. Open on your phone: ${url}`;
      await sendSms(runner.phone, msg, runner.full_name || runner.first_name || "Runner");
      smsStatus = "sent";
    }

    return {
      ok: true,
      taskId,
      url,
      smsStatus,
      runnerName: runner?.full_name || runner?.first_name || "runner",
    };
  });

/** Runner: submit a completed task. Timestamps captured server-side. */
export const submitTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    taskId: string;
    mileage: number;
    completion: Record<string, unknown>;
    photoUrls?: string[];
    notes?: string;
  }) => {
    if (!input.taskId) throw new Error("taskId required");
    if (typeof input.mileage !== "number" || !Number.isInteger(input.mileage) || input.mileage < 0) {
      throw new Error("Valid current mileage is required");
    }
    if (!input.completion || typeof input.completion !== "object") throw new Error("completion required");
    if (input.notes && input.notes.length > 2000) throw new Error("notes too long");
    if (input.photoUrls && input.photoUrls.length > 20) throw new Error("too many photos");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS "Runners update own runner_tasks" ensures runners can only submit their own tasks.
    const { data: row, error } = await supabase
      .from("runner_tasks")
      .update({
        status: "completed",
        mileage: data.mileage,
        completion: data.completion as any,
        photo_urls: data.photoUrls ?? [],
        notes: data.notes?.trim() || null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", data.taskId)
      .select("id, status, type, vehicle_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Task not found or not assigned to you");

    // Auto-create a maintenance ticket when an inspection turns up issues.
    const completion = data.completion as Record<string, unknown>;
    const issues = Array.isArray((completion as any).issues)
      ? ((completion as any).issues as string[]).filter((s) => typeof s === "string" && s.trim())
      : [];
    let maintenanceCreated = false;
    if (row.type === "inspection" && issues.length > 0) {
      const mid =
        "MN-" +
        Math.random().toString(36).slice(2, 12).toUpperCase();
      const noteParts: string[] = [];
      if (data.notes?.trim()) noteParts.push(data.notes.trim());
      const { error: mErr } = await supabase.from("maintenance").insert({
        id: mid,
        vehicle_id: row.vehicle_id as string,
        service_type: "Inspection issues: " + issues.join(", "),
        vendor: "Pending assignment",
        date_completed: null,
        mileage_at_service: data.mileage,
        cost: 0,
        notes: noteParts.join(" | ") || null,
        next_service_due: new Date().toISOString().slice(0, 10),
      });
      if (mErr) throw new Error(mErr.message);

      // Mark the vehicle unavailable (and flag open issues).
      await supabase
        .from("vehicles")
        .update({ status: "maintenance", has_open_issues: true })
        .eq("id", row.vehicle_id as string);

      // Alert admin.
      const { data: veh } = await supabase
        .from("vehicles")
        .select("year, make, model, plate")
        .eq("id", row.vehicle_id as string)
        .maybeSingle();
      const vLabel = veh
        ? `${(veh as any).year} ${(veh as any).make} ${(veh as any).model} (${(veh as any).plate})`
        : (row.vehicle_id as string);
      try {
        await sendSms(
          "+12672213977",
          `Camauto: Issues found in inspection — ${vLabel}. ${issues.join(", ")}. Vehicle marked unavailable.`,
          "Admin",
        );
      } catch {
        /* SMS failure must not block the submission */
      }
      maintenanceCreated = true;
    }

    return { ok: true, taskId: row.id as string, maintenanceCreated };
  });