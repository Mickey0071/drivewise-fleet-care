import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PHOTO_BUCKET = "runner-task-photos";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin access required");
}

export interface RunnerTaskSummary {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  runnerName: string | null;
  runnerPhone: string | null;
  vehicleLabel: string | null;
  customerName: string | null;
  location: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  photoCount: number;
}

export interface RunnerTaskReport extends RunnerTaskSummary {
  instructions: string | null;
  customerPhone: string | null;
  checklistResults: { item: string; status: string; notes?: string }[];
  runnerNotes: string | null;
  photoUrls: string[];
  rm: {
    vehicleId: string;
    mileage: number | null;
    items: { type: string; customId?: string | null; label: string; due?: string | null }[];
    applied: boolean;
  } | null;
}

function summarize(row: any): RunnerTaskSummary {
  const details = (row.details ?? {}) as Record<string, any>;
  return {
    id: row.id,
    title: row.title ?? "Task",
    type: row.type ?? "custom",
    priority: row.priority ?? "medium",
    status: row.status ?? "sent",
    runnerName: row.runner_name ?? null,
    runnerPhone: row.runner_phone ?? null,
    vehicleLabel: details.vehicleLabel ?? null,
    customerName: details.customerName ?? null,
    location: row.location ?? null,
    scheduledAt: row.scheduled_at ?? null,
    sentAt: row.sent_at ?? null,
    submittedAt: row.submitted_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
    photoCount: Array.isArray(row.photo_urls) ? row.photo_urls.length : 0,
  };
}

/** Admin: list all link-based runner tasks (most recent first). */
export const listRunnerTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RunnerTaskSummary[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("runner_tasks")
      .select("*")
      .not("token", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map(summarize);
  });

/** Admin: full report for a single task, with signed photo URLs. */
export const getRunnerTaskReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id || id.length > 80) throw new Error("Invalid task id");
    return { id };
  })
  .handler(async ({ data, context }): Promise<RunnerTaskReport> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: row, error } = await supabase
      .from("runner_tasks")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Task not found");

    const details = (row.details ?? {}) as Record<string, any>;
    const paths: string[] = Array.isArray(row.photo_urls) ? row.photo_urls : [];
    let photoUrls: string[] = [];
    if (paths.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: signed } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(paths, 60 * 60);
      photoUrls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    }

    return {
      ...summarize(row),
      instructions: row.instructions ?? null,
      customerPhone: details.customerPhone ?? null,
      checklistResults: (Array.isArray(row.checklist_results)
        ? row.checklist_results
        : []) as RunnerTaskReport["checklistResults"],
      runnerNotes: row.runner_notes ?? null,
      photoUrls,
      rm: details.rm?.vehicleId
        ? {
            vehicleId: details.rm.vehicleId,
            mileage: details.rm.mileage ?? null,
            items: Array.isArray(details.rm.items) ? details.rm.items : [],
            applied: !!details.rm.applied,
          }
        : null,
    };
  });

/** Admin: mark a submitted task as reviewed. */
export const markRunnerTaskReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id || id.length > 80) throw new Error("Invalid task id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("runner_tasks")
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Map runner checklist results (Pass/Fail) onto stored RM item metadata. */
function buildRmItems(rmMeta: any, checklistResults: any[]) {
  const metaItems: any[] = Array.isArray(rmMeta?.items) ? rmMeta.items : [];
  const results: any[] = Array.isArray(checklistResults) ? checklistResults : [];
  return metaItems.map((m, i) => {
    const r =
      results.find((x) => String(x.item ?? "").trim() === String(m.label ?? "").trim()) ??
      results[i];
    const raw = String(r?.status ?? "").toLowerCase();
    const status: "Pass" | "Fail" | "" =
      raw === "pass" || raw === "done" ? "Pass" : raw === "fail" || raw === "issue" ? "Fail" : "";
    return {
      type: m.type,
      customId: m.customId ?? undefined,
      label: m.label,
      due: m.due ?? undefined,
      status,
      notes: r?.notes ?? undefined,
    };
  });
}

/**
 * Admin: approve a routine-maintenance runner task. Applies the submitted
 * (or admin-overridden) results to the vehicle's scheduled maintenance.
 */
export const approveRmTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    override?: boolean;
    items?: { type: string; customId?: string | null; label: string; status?: string; notes?: string }[];
    mileage?: number | null;
  }) => {
    const id = String(d?.id ?? "").trim();
    if (!id || id.length > 80) throw new Error("Invalid task id");
    return {
      id,
      override: !!d.override,
      items: Array.isArray(d.items) ? d.items.slice(0, 60) : null,
      mileage: d.mileage != null ? Number(d.mileage) : null,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: row, error } = await supabase
      .from("runner_tasks")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Task not found");

    const details = (row.details ?? {}) as Record<string, any>;
    const rmMeta = details.rm;
    if (!rmMeta?.vehicleId) throw new Error("This task is not a routine-maintenance task");
    if (rmMeta.applied) throw new Error("This task's maintenance has already been applied");

    const items =
      data.override && data.items
        ? data.items.map((it) => ({
            type: it.type,
            customId: it.customId ?? undefined,
            label: it.label,
            status: (it.status === "Pass" || it.status === "Fail" ? it.status : "") as "Pass" | "Fail" | "",
            notes: it.notes ?? undefined,
          }))
        : buildRmItems(rmMeta, row.checklist_results as any[]);

    const mileage = data.mileage != null ? data.mileage : rmMeta.mileage ?? null;

    const { applyRmSubmission } = await import("@/lib/rm-cards.server");
    const result = await applyRmSubmission({
      vehicleId: rmMeta.vehicleId,
      items,
      inspectorName: data.override ? "Admin (override)" : row.runner_name || "Runner",
      inspectorType: "runner",
      mileage,
      overallNotes: row.runner_notes || undefined,
    });

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("runner_tasks")
      .update({
        status: "approved",
        reviewed_at: nowIso,
        reviewed_by: userId,
        details: { ...details, rm: { ...rmMeta, applied: true, appliedAt: nowIso, override: !!data.override } } as any,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, passed: result.passed.length, failed: result.failed.length };
  });

/** Admin: reject a routine-maintenance task without touching the vehicle. */
export const rejectRmTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id || id.length > 80) throw new Error("Invalid task id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("runner_tasks")
      .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export interface RunnerHistoryEntry {
  phone: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
  avgCompletionMinutes: number | null;
  lastTaskAt: string | null;
  tasks: RunnerTaskSummary[];
}

/** Admin: runner job history grouped by phone number. */
export const getRunnerHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RunnerHistoryEntry[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("runner_tasks")
      .select("*")
      .not("token", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    const groups = new Map<string, RunnerHistoryEntry>();
    for (const row of data ?? []) {
      const phone = (row.runner_phone ?? "").trim();
      if (!phone) continue;
      const summary = summarize(row);
      let g = groups.get(phone);
      if (!g) {
        g = {
          phone,
          name: summary.runnerName || "Runner",
          totalTasks: 0,
          completedTasks: 0,
          avgCompletionMinutes: null,
          lastTaskAt: null,
          tasks: [],
        };
        groups.set(phone, g);
      }
      g.tasks.push(summary);
      g.totalTasks += 1;
      if (summary.status === "submitted") g.completedTasks += 1;
    }

    for (const g of groups.values()) {
      const durations: number[] = [];
      for (const t of g.tasks) {
        if (t.submittedAt && t.sentAt) {
          const d = new Date(t.submittedAt).getTime() - new Date(t.sentAt).getTime();
          if (d > 0) durations.push(d);
        }
      }
      if (durations.length > 0) {
        const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
        g.avgCompletionMinutes = Math.round(avgMs / 60000);
      }
      g.lastTaskAt = g.tasks[0]?.sentAt ?? g.tasks[0]?.scheduledAt ?? null;
    }

    return Array.from(groups.values()).sort((a, b) => b.totalTasks - a.totalTasks);
  });