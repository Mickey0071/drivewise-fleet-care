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
      .select("id, status, type, vehicle_id, details")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Task not found or not assigned to you");

    // Auto-create a maintenance ticket when an inspection turns up issues.
    // Return inspections are gated behind admin approval (see reviewInspection),
    // so they do NOT auto-create maintenance or change vehicle status here.
    const isReturnInspection =
      row.type === "inspection" && (row.details as any)?.return_inspection === true;
    const completion = data.completion as Record<string, unknown>;
    const issues = Array.isArray((completion as any).issues)
      ? ((completion as any).issues as string[]).filter((s) => typeof s === "string" && s.trim())
      : [];
    let maintenanceCreated = false;
    if (row.type === "inspection" && !isReturnInspection && issues.length > 0) {
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

const ADMIN_ALERT_PHONE = "+12672213977";

/**
 * Admin: return a vehicle and dispatch a post-return inspection task to a runner.
 * Marks the rental returned and parks the vehicle in "inspection" status until
 * an admin approves the completed inspection (see reviewInspection).
 */
export const createReturnInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    rentalId: string;
    runnerId: string;
    origin: string;
    vehicleLabel?: string;
  }) => {
    if (!input.rentalId) throw new Error("rentalId required");
    if (!input.runnerId) throw new Error("runnerId required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS gates these writes to admins only.
    const { data: rental, error: rErr } = await supabase
      .from("rentals")
      .select("id, vehicle_id, end_date")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Rental not found");

    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("rentals")
      .update({
        reservation_status: "returned",
        returned_at: nowIso,
        end_date: rental.end_date || nowIso.slice(0, 10),
      })
      .eq("id", rental.id);
    if (upErr) throw new Error(upErr.message);

    // Park the vehicle in inspection (not bookable) until approved.
    await supabase
      .from("vehicles")
      .update({ status: "inspection" })
      .eq("id", rental.vehicle_id as string);

    const { data: taskRow, error: tErr } = await supabase
      .from("runner_tasks")
      .insert({
        type: "inspection",
        vehicle_id: rental.vehicle_id as string,
        runner_id: data.runnerId,
        assigned_by: context.userId,
        details: {
          return_inspection: true,
          rental_id: rental.id,
          instructions: "Post-return inspection — check the vehicle before it goes back on the lot.",
        } as any,
        status: "assigned",
      })
      .select("id")
      .single();
    if (tErr) throw new Error(tErr.message);

    const { data: runner } = await supabase
      .from("profiles")
      .select("full_name, first_name, phone")
      .eq("id", data.runnerId)
      .maybeSingle();

    const taskId = taskRow.id as string;
    const url = `${data.origin.replace(/\/$/, "")}/runner/task/${encodeURIComponent(taskId)}`;
    const label = data.vehicleLabel || (rental.vehicle_id as string);
    let smsStatus: "sent" | "skipped_no_phone" = "skipped_no_phone";
    if (runner?.phone && runner.phone.length >= 7) {
      await sendSms(
        runner.phone,
        `Camauto: Inspection needed — ${label}. Open on your phone: ${url}`,
        runner.full_name || runner.first_name || "Runner",
      );
      smsStatus = "sent";
    }

    return { ok: true, taskId, url, smsStatus };
  });

/**
 * Admin: approve / reject / force-available a completed (return) inspection.
 */
export const reviewInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    taskId: string;
    action: "approve" | "reject" | "force_available";
    reason?: string;
    reopen?: boolean;
    origin?: string;
  }) => {
    if (!input.taskId) throw new Error("taskId required");
    if (!["approve", "reject", "force_available"].includes(input.action)) throw new Error("Invalid action");
    if (input.reason && input.reason.length > 1000) throw new Error("reason too long");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS "Admins manage runner_tasks" gates this to admins only.
    const { data: task, error: tErr } = await supabase
      .from("runner_tasks")
      .select("id, type, vehicle_id, runner_id, completion, notes, mileage")
      .eq("id", data.taskId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");

    const completion = (task.completion as Record<string, unknown>) || {};
    const issues = Array.isArray((completion as any).issues)
      ? ((completion as any).issues as string[]).filter((s) => typeof s === "string" && s.trim())
      : [];

    if (data.action === "reject") {
      const noteParts = [task.notes, data.reason?.trim() ? `Rejected: ${data.reason.trim()}` : "Rejected"].filter(Boolean);
      if (data.reopen) {
        // Reopen for the runner to redo. Vehicle stays in inspection.
        await supabase
          .from("runner_tasks")
          .update({ status: "assigned", completed_at: null, notes: noteParts.join(" | ") })
          .eq("id", task.id);
        const { data: runner } = await supabase
          .from("profiles")
          .select("full_name, first_name, phone")
          .eq("id", task.runner_id as string)
          .maybeSingle();
        if (runner?.phone && runner.phone.length >= 7 && data.origin) {
          const url = `${data.origin.replace(/\/$/, "")}/runner/task/${encodeURIComponent(task.id as string)}`;
          try {
            await sendSms(
              runner.phone,
              `Camauto: Re-inspection needed${data.reason?.trim() ? ` — ${data.reason.trim()}` : ""}. ${url}`,
              runner.full_name || runner.first_name || "Runner",
            );
          } catch { /* ignore */ }
        }
      } else {
        await supabase
          .from("runner_tasks")
          .update({ status: "rejected", notes: noteParts.join(" | ") })
          .eq("id", task.id);
      }
      return { ok: true, action: "reject" as const, reopened: !!data.reopen };
    }

    // approve or force_available → vehicle becomes available.
    let maintenanceCreated = false;
    if (data.action === "approve" && issues.length > 0) {
      const mid = "MN-" + Math.random().toString(36).slice(2, 12).toUpperCase();
      const { error: mErr } = await supabase.from("maintenance").insert({
        id: mid,
        vehicle_id: task.vehicle_id as string,
        service_type: "Inspection issues: " + issues.join(", "),
        vendor: "Pending assignment",
        date_completed: null,
        mileage_at_service: (task.mileage as number) ?? 0,
        cost: 0,
        notes: (task.notes as string) || null,
        next_service_due: new Date().toISOString().slice(0, 10),
      });
      if (mErr) throw new Error(mErr.message);
      maintenanceCreated = true;
    }

    await supabase
      .from("vehicles")
      .update({ status: "available" })
      .eq("id", task.vehicle_id as string);

    await supabase
      .from("runner_tasks")
      .update({ status: "approved" })
      .eq("id", task.id);

    return { ok: true, action: data.action, maintenanceCreated };
  });