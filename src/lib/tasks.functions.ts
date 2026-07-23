import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";
import { TASK_TYPE_KEYS } from "@/lib/task-types";
import { syncVehicleAvailabilityToGhl } from "@/lib/ghl-vehicle-sync.server";

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
      try { await syncVehicleAvailabilityToGhl(row.vehicle_id as string); } catch (e) { console.error("[tasks] ghl sync failed", e); }

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

/**
 * Runner: create a repair request from a failed inspection checklist item.
 * Creates an open maintenance ticket with approval_status = "pending" so an
 * admin can approve it into the Repairs board (or reject it).
 */
export const createRunnerRepairRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    vehicleId: string;
    issue: string;
    notes?: string;
    estimatedCost?: number;
    mileage?: number;
    partsCost?: number;
    laborCost?: number;
    inspectionId?: string;
    runnerName?: string;
  }) => {
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.issue || !input.issue.trim()) throw new Error("issue required");
    if (input.issue.length > 300) throw new Error("issue too long");
    if (input.notes && input.notes.length > 2000) throw new Error("notes too long");
    if (input.estimatedCost != null && (typeof input.estimatedCost !== "number" || input.estimatedCost < 0 || input.estimatedCost > 1000000)) {
      throw new Error("Invalid estimated cost");
    }
    for (const c of [input.partsCost, input.laborCost]) {
      if (c != null && (typeof c !== "number" || c < 0 || c > 1000000)) {
        throw new Error("Invalid cost");
      }
    }
    if (input.mileage != null && (!Number.isInteger(input.mileage) || input.mileage < 0)) {
      throw new Error("Invalid mileage");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const issue = data.issue.trim();
    const notes = data.notes?.trim() || "";
    const description = notes ? `${issue} — ${notes}` : issue;
    const mid = "MN-" + Math.random().toString(36).slice(2, 12).toUpperCase();
    const parts = data.partsCost ?? 0;
    const labor = data.laborCost ?? 0;
    const totalCost = parts + labor || (data.estimatedCost ?? 0);

    // RLS "Runners insert maintenance" gates this insert to runners.
    const { error: mErr } = await supabase.from("maintenance").insert({
      id: mid,
      vehicle_id: data.vehicleId,
      service_type: issue,
      issue_description: description,
      status: "reported",
      vendor: "Pending assignment",
      date_completed: null,
      mileage_at_service: data.mileage ?? 0,
      cost: totalCost,
      parts_cost: parts,
      labor_cost: labor,
      next_service_due: new Date().toISOString().slice(0, 10),
      runner_id: context.userId,
      repair_request_notes: notes || null,
      customer_notes: notes || null,
      source: "inspection_fail",
      inspection_id: data.inspectionId ?? null,
      is_rental_blocking: true,
    });
    if (mErr) throw new Error(mErr.message);

    // Flag the vehicle as having an open issue and block rentals.
    await supabase
      .from("vehicles")
      .update({ has_open_issues: true })
      .eq("id", data.vehicleId);

    // Alert admin by SMS (best-effort).
    const { data: veh } = await supabase
      .from("vehicles")
      .select("year, make, model, plate")
      .eq("id", data.vehicleId)
      .maybeSingle();
    const vLabel = veh
      ? `${(veh as any).year} ${(veh as any).make} ${(veh as any).model} (${(veh as any).plate})`
      : data.vehicleId;
    try {
      await sendSms(
        "+12672213977",
        `⚠️ INSPECTION ISSUE: ${vLabel} — ${issue}${data.runnerName ? ` | Runner: ${data.runnerName}` : ""}${totalCost ? ` | est. $${totalCost}` : ""}`,
        "Admin",
      );
    } catch {
      /* SMS failure must not block the request */
    }

    return { ok: true, maintenanceId: mid };
  });

/**
 * Admin: return a vehicle and dispatch a post-return inspection task to a runner.
 * Marks the rental returned and parks the vehicle in "inspection" status until
 * an admin approves the completed inspection (see reviewInspection).
 */
export const createReturnInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    rentalId: string;
    runnerName: string;
    runnerPhone: string;
    origin: string;
    vehicleLabel?: string;
  }) => {
    if (!input.rentalId) throw new Error("rentalId required");
    const name = String(input.runnerName ?? "").trim();
    if (!name || name.length > 120) throw new Error("runnerName required");
    const phone = String(input.runnerPhone ?? "").trim();
    if (phone.replace(/\D/g, "").length < 10) throw new Error("valid runnerPhone required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    return { ...input, runnerName: name, runnerPhone: phone };
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
    try { await syncVehicleAvailabilityToGhl(rental.vehicle_id as string); } catch (e) { console.error("[tasks] ghl sync failed", e); }

    const { data: taskRow, error: tErr } = await supabase
      .from("runner_tasks")
      .insert({
        type: "inspection",
        vehicle_id: rental.vehicle_id as string,
        runner_id: null,
        assigned_by: context.userId,
        details: {
          return_inspection: true,
          rental_id: rental.id,
          runner_name: data.runnerName,
          runner_phone: data.runnerPhone,
          instructions: "Post-return inspection — check the vehicle before it goes back on the lot.",
        } as any,
        status: "assigned",
      })
      .select("id")
      .single();
    if (tErr) throw new Error(tErr.message);

    const taskId = taskRow.id as string;
    const url = `${data.origin.replace(/\/$/, "")}/runner/task/${encodeURIComponent(taskId)}`;
    const label = data.vehicleLabel || (rental.vehicle_id as string);
    let smsStatus: "sent" | "skipped_no_phone" = "skipped_no_phone";
    if (data.runnerPhone) {
      await sendSms(
        data.runnerPhone,
        `Camauto: Inspection needed — ${label}. Open on your phone: ${url}`,
        data.runnerName || "Runner",
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
      .select("id, type, vehicle_id, runner_id, completion, notes, mileage, details, photo_urls, completed_at")
      .eq("id", data.taskId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");

    const completion = (task.completion as Record<string, unknown>) || {};
    const issues = Array.isArray((completion as any).issues)
      ? ((completion as any).issues as string[]).filter((s) => typeof s === "string" && s.trim())
      : [];
    const nowIso = new Date().toISOString();

    // Resolve a human label + runner name for SMS / audit.
    const { data: veh } = await supabase
      .from("vehicles")
      .select("year, make, model, plate, mileage, maintenance_settings")
      .eq("id", task.vehicle_id as string)
      .maybeSingle();
    const vLabel = veh
      ? `${(veh as any).year} ${(veh as any).make} ${(veh as any).model} (${(veh as any).plate})`
      : (task.vehicle_id as string);
    const { data: runnerP } = await supabase
      .from("profiles")
      .select("full_name, first_name, phone")
      .eq("id", task.runner_id as string)
      .maybeSingle();
    const runnerName = runnerP?.full_name || runnerP?.first_name || "Runner";
    const ADMIN_PHONE = "+12672213977";

    if (data.action === "reject") {
      const noteParts = [task.notes, data.reason?.trim() ? `Rejected: ${data.reason.trim()}` : "Rejected"].filter(Boolean);
      if (data.reopen) {
        // Reopen for the runner to redo. Vehicle stays in inspection.
        await supabase
          .from("runner_tasks")
          .update({
            status: "assigned",
            completed_at: null,
            notes: noteParts.join(" | "),
            reviewed_at: nowIso,
            reviewed_by: context.userId,
            review_action: "rejected_reinspect",
          })
          .eq("id", task.id);
        if (runnerP?.phone && runnerP.phone.length >= 7 && data.origin) {
          const url = `${data.origin.replace(/\/$/, "")}/runner/task/${encodeURIComponent(task.id as string)}`;
          try {
            await sendSms(
              runnerP.phone,
              `Camauto: Re-inspection needed${data.reason?.trim() ? ` — ${data.reason.trim()}` : ""}. ${url}`,
              runnerName,
            );
          } catch { /* ignore */ }
        }
      } else {
        await supabase
          .from("runner_tasks")
          .update({
            status: "rejected",
            notes: noteParts.join(" | "),
            reviewed_at: nowIso,
            reviewed_by: context.userId,
            review_action: "rejected_manual",
          })
          .eq("id", task.id);
      }
      return { ok: true, action: "reject" as const, reopened: !!data.reopen };
    }

    // FORCE AVAILABLE → vehicle becomes available immediately, NOTHING logged to inspections.
    if (data.action === "force_available") {
      await supabase
        .from("vehicles")
        .update({ status: "available" })
        .eq("id", task.vehicle_id as string);
      try { await syncVehicleAvailabilityToGhl(task.vehicle_id as string); } catch (e) { console.error("[tasks] ghl sync failed", e); }
      const auditNote = [task.notes, `Override at ${nowIso} by admin - inspection skipped`]
        .filter(Boolean)
        .join(" | ");
      await supabase
        .from("runner_tasks")
        .update({
          status: "forced",
          forced: true,
          notes: auditNote,
          reviewed_at: nowIso,
          reviewed_by: context.userId,
          review_action: "forced",
        })
        .eq("id", task.id);
      try {
        await sendSms(
          ADMIN_PHONE,
          `Camauto: Vehicle forced available — ${vLabel}. No inspection logged.`,
          "Admin",
        );
      } catch { /* SMS failure must not block */ }
      return { ok: true, action: "force_available" as const, maintenanceCreated: false };
    }

    // APPROVE → log inspection, create maintenance for issues, mark vehicle available.
    let maintenanceCreated = false;
    if (issues.length > 0) {
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

    // Log the approved inspection to the inspections table (audit trail).
    const checklist = ((completion as any).checklist as Record<string, boolean>) || {};
    const inspId = "INS-" + Math.random().toString(36).slice(2, 12).toUpperCase();
    await supabase.from("inspections").insert({
      id: inspId,
      vehicle_id: task.vehicle_id as string,
      rental_id: ((task.details as any)?.rental_id as string) || null,
      type: "return",
      is_return_inspection: true,
      date: nowIso.slice(0, 10),
      mileage: (task.mileage as number) ?? 0,
      fuel_level: ((completion as any).fuel_level as string) || "unknown",
      damage_noted: issues.length > 0,
      ready_to_rent: true,
      completed_by: runnerName,
      inspector_name: runnerName,
      notes: (task.notes as string) || null,
      checklist_items: checklist as any,
      checklist_data: completion as any,
      issues_found: issues as any,
      task_id: task.id as string,
      runner_id: task.runner_id as string,
      submitted_at: (task.completed_at as string) || nowIso,
    });

    // Update the vehicle record with the latest inspection data + make available.
    const vehUpdate: Record<string, unknown> = {
      status: "available",
      last_inspection_at: nowIso,
      last_inspection_mileage: (task.mileage as number) ?? null,
    };
    // Clean approval (no issues found) clears the recurring scheduled alerts
    // (oil / battery / alternator / inspection) by resetting their markers.
    if (issues.length === 0) {
      const settings = ((veh as any)?.maintenance_settings as Record<string, any>) || {};
      const today = nowIso.slice(0, 10);
      const mileage = (task.mileage as number) ?? (veh as any)?.mileage ?? 0;
      if (settings.oilChange) {
        settings.oilChange = { ...settings.oilChange, lastMileage: mileage, lastDate: today };
      }
      settings.batteryLastDone = today;
      settings.alternatorLastDone = today;
      const nextYear = new Date(nowIso);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      settings.inspectionExpiry = nextYear.toISOString().slice(0, 10);
      vehUpdate.maintenance_settings = settings;
    }
    await supabase
      .from("vehicles")
      .update(vehUpdate as never)
      .eq("id", task.vehicle_id as string);
    try { await syncVehicleAvailabilityToGhl(task.vehicle_id as string); } catch (e) { console.error("[tasks] ghl sync failed", e); }

    // If tied to a rental return, finalize it so P&L treats it as closed.
    const rentalId = (task.details as any)?.rental_id as string | undefined;
    if (rentalId) {
      await supabase
        .from("rentals")
        .update({ return_inspection_id: inspId, reservation_status: "completed" })
        .eq("id", rentalId);
    }

    await supabase
      .from("runner_tasks")
      .update({
        status: "approved",
        reviewed_at: nowIso,
        reviewed_by: context.userId,
        review_action: "approved",
      })
      .eq("id", task.id);

    // Alert admin that the inspection was approved.
    try {
      await sendSms(
        ADMIN_PHONE,
        `Camauto: ✓ Inspection approved — ${vLabel} by ${runnerName}.`,
        "Admin",
      );
    } catch { /* SMS failure must not block */ }

    return { ok: true, action: "approve" as const, maintenanceCreated };
  });
/**
 * Admin: notify the runner who reported a repair that it has been completed.
 * Best-effort SMS to the runner's phone. No-op if the maintenance record has
 * no associated runner.
 */
export const notifyRunnerRepairComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    maintenanceId: string;
    issue: string;
    completedBy: string;
    mechanicNotes?: string;
    total: number;
  }) => {
    if (!input.maintenanceId) throw new Error("maintenanceId required");
    if (input.issue && input.issue.length > 300) throw new Error("issue too long");
    if (input.mechanicNotes && input.mechanicNotes.length > 2000) throw new Error("notes too long");
    if (typeof input.total !== "number" || input.total < 0 || input.total > 1000000) {
      throw new Error("Invalid total");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: m } = await supabase
      .from("maintenance")
      .select("runner_id, vehicle_id, service_type, issue_description")
      .eq("id", data.maintenanceId)
      .maybeSingle();

    const runnerId = (m as any)?.runner_id as string | undefined;
    if (!runnerId) return { ok: true, notified: false as const, reason: "no_runner" };

    const { data: runner } = await supabase
      .from("profiles")
      .select("phone, full_name, first_name")
      .eq("id", runnerId)
      .maybeSingle();

    const phone = (runner as any)?.phone as string | undefined;
    if (!phone) return { ok: true, notified: false as const, reason: "no_phone" };

    const { data: veh } = await supabase
      .from("vehicles")
      .select("year, make, model, plate")
      .eq("id", (m as any)?.vehicle_id)
      .maybeSingle();
    const vLabel = veh
      ? `${(veh as any).year} ${(veh as any).make} ${(veh as any).model} (${(veh as any).plate})`
      : (m as any)?.vehicle_id;

    const work = data.mechanicNotes?.trim() ? ` What was done: ${data.mechanicNotes.trim()}.` : "";
    const msg = `Camauto: ✓ COMPLETED — ${vLabel}. Issue you reported: ${data.issue}. Completed by ${data.completedBy}.${work} Cost $${data.total.toFixed(2)}.`;

    try {
      await sendSms(phone, msg, (runner as any)?.full_name || (runner as any)?.first_name || "Runner");
      return { ok: true, notified: true as const };
    } catch {
      return { ok: true, notified: false as const, reason: "sms_failed" };
    }
  });
