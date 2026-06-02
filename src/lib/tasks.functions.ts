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
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Task not found or not assigned to you");
    return { ok: true, taskId: row.id as string };
  });