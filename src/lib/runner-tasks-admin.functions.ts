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
      checklistResults: Array.isArray(row.checklist_results) ? row.checklist_results : [],
      runnerNotes: row.runner_notes ?? null,
      photoUrls,
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