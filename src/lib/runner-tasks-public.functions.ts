import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_NOTIFY_PHONE = "267-221-3977";
const PHOTO_BUCKET = "runner-task-photos";

export interface PublicRunnerTask {
  state: "ok" | "submitted" | "complete" | "cancelled" | "expired" | "invalid";
  task?: {
    id: string;
    title: string;
    type: string;
    instructions: string | null;
    priority: string;
    location: string | null;
    scheduledAt: string | null;
    runnerName: string | null;
    vehicleLabel: string | null;
    customerName: string | null;
    customerPhone: string | null;
    checklist: { id: string; label: string }[];
    requiresPhotos: boolean;
    photosCountRequired: number;
    submittedAt: string | null;
    status: string;
    acceptedAt: string | null;
    completedAt: string | null;
    runnerPay: number | null;
  };
}

function mapTask(row: any): PublicRunnerTask["task"] {
  const details = (row.details ?? {}) as Record<string, any>;
  return {
    id: row.id,
    title: row.title ?? "Task",
    type: row.type ?? "custom",
    instructions: row.instructions ?? null,
    priority: row.priority ?? "medium",
    location: row.location ?? null,
    scheduledAt: row.scheduled_at ?? null,
    runnerName: row.runner_name ?? null,
    vehicleLabel: details.vehicleLabel ?? null,
    customerName: details.customerName ?? null,
    customerPhone: details.customerPhone ?? null,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    requiresPhotos: !!row.requires_photos,
    photosCountRequired: row.photos_count_required ?? 0,
    submittedAt: row.submitted_at ?? null,
    status: row.status ?? "sent",
    acceptedAt: row.accepted_at ?? null,
    completedAt: row.completed_at ?? null,
    runnerPay: row.runner_pay != null ? Number(row.runner_pay) : null,
  };
}

/** Public: fetch a runner task by token. No auth required. */
export const getRunnerTaskByToken = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    const token = (d?.token ?? "").trim();
    if (!token || token.length > 80 || !/^[a-f0-9]+$/i.test(token)) {
      throw new Error("Invalid token");
    }
    return { token };
  })
  .handler(async ({ data }): Promise<PublicRunnerTask> => {
    const { data: row } = await supabaseAdmin
      .from("runner_tasks")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { state: "invalid" };
    if (row.status === "submitted") return { state: "submitted", task: mapTask(row) };
    if (row.status === "complete") return { state: "complete", task: mapTask(row) };
    if (row.status === "cancelled" || row.status === "archived")
      return { state: "cancelled", task: mapTask(row) };
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())
      return { state: "expired" };
    return { state: "ok", task: mapTask(row) };
  });

/** Public: runner taps the accept link to confirm the task. No auth required. */
export const acceptRunnerTask = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    const token = (d?.token ?? "").trim();
    if (!token || token.length > 80 || !/^[a-f0-9]+$/i.test(token)) throw new Error("Invalid token");
    return { token };
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("runner_tasks")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This task link is no longer valid.");
    if (row.status === "cancelled" || row.status === "archived")
      throw new Error("This task has been cancelled.");
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())
      throw new Error("This task link has expired.");

    // Idempotent: only move forward from a not-yet-accepted state.
    const newlyAccepted = !row.accepted_at && !["submitted", "complete"].includes(row.status);
    if (newlyAccepted) {
      const acceptedAt = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from("runner_tasks")
        .update({ status: "accepted", accepted_at: acceptedAt })
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);

      // Notify admin that the runner accepted the task.
      try {
        await sendSms(
          ADMIN_NOTIFY_PHONE,
          `Task accepted: ${row.title} — ${row.runner_name}`,
          "Camauto Admin",
        );
      } catch (e) {
        console.error("admin accept-notify SMS failed", e);
      }
    }
    return { ok: true as const, runnerName: row.runner_name as string };
  });

/** Public: runner marks the task complete with required notes + photos. Sends an SMS alert to admin. No auth required. */
export const completeRunnerTask = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; runnerNotes?: string; photos?: { dataUrl: string }[] }) => {
    const token = (d?.token ?? "").trim();
    if (!token || token.length > 80 || !/^[a-f0-9]+$/i.test(token)) throw new Error("Invalid token");
    const runnerNotes = String(d?.runnerNotes ?? "").trim().slice(0, 4000);
    if (!runnerNotes) throw new Error("Notes are required to complete the task.");
    const photos = (Array.isArray(d?.photos) ? d.photos : [])
      .filter((p) => typeof p?.dataUrl === "string" && p.dataUrl.startsWith("data:image/"))
      .slice(0, 20);
    if (photos.length < 1) throw new Error("At least one photo is required to complete the task.");
    return { token, runnerNotes, photos };
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("runner_tasks")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This task link is no longer valid.");
    if (row.status === "cancelled" || row.status === "archived")
      throw new Error("This task has been cancelled.");
    if (row.status === "complete") throw new Error("This task is already complete.");
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())
      throw new Error("This task link has expired.");

    // Upload completion photos via admin client.
    const existingPaths: string[] = Array.isArray(row.photo_urls) ? row.photo_urls : [];
    const photoPaths: string[] = [...existingPaths];
    for (let i = 0; i < data.photos.length; i++) {
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(data.photos[i].dataUrl);
      if (!m) continue;
      const mime = m[1];
      const ext = mime.split("/")[1].replace("jpeg", "jpg");
      const bytes = Buffer.from(m[2], "base64");
      const path = `${row.id}/${Date.now()}_${i}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
      photoPaths.push(path);
    }

    const completedAt = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("runner_tasks")
      .update({
        status: "complete",
        completed_at: completedAt,
        submitted_at: row.submitted_at ?? completedAt,
        completion_ack_at: null,
        runner_notes: data.runnerNotes,
        photo_urls: photoPaths,
      })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);

    // Notify admin: SMS + dashboard alert (alert is read from the unacknowledged row).
    try {
      const details = (row.details ?? {}) as Record<string, any>;
      const vehicle = details.vehicleLabel ? ` — ${details.vehicleLabel}` : "";
      await sendSms(
        ADMIN_NOTIFY_PHONE,
        `Task complete: ${row.title} — ${row.runner_name}${vehicle} (photos & notes attached)`,
        "Camauto Admin",
      );
    } catch (e) {
      console.error("admin complete-notify SMS failed", e);
    }

    return { ok: true as const, runnerName: row.runner_name as string };
  });

/** Public: submit a runner task. No auth required. */
export const submitRunnerTask = createServerFn({ method: "POST" })
  .inputValidator((d: {
    token: string;
    checklistResults: { item: string; status: string; notes?: string }[];
    runnerNotes?: string;
    photos?: { dataUrl: string }[];
  }) => {
    const token = (d?.token ?? "").trim();
    if (!token || token.length > 80 || !/^[a-f0-9]+$/i.test(token)) throw new Error("Invalid token");
    const checklistResults = (Array.isArray(d.checklistResults) ? d.checklistResults : [])
      .map((r) => ({
        item: String(r.item ?? "").slice(0, 200),
        status: String(r.status ?? "").slice(0, 20),
        notes: String(r.notes ?? "").slice(0, 500),
      }))
      .slice(0, 60);
    const photos = (Array.isArray(d.photos) ? d.photos : [])
      .filter((p) => typeof p?.dataUrl === "string" && p.dataUrl.startsWith("data:image/"))
      .slice(0, 20);
    return {
      token,
      checklistResults,
      runnerNotes: String(d.runnerNotes ?? "").slice(0, 4000),
      photos,
    };
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("runner_tasks")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This task link is no longer valid.");
    if (row.status === "submitted") throw new Error("This task has already been submitted.");
    if (row.status === "cancelled" || row.status === "archived")
      throw new Error("This task has been cancelled.");
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())
      throw new Error("This task link has expired.");

    // Validate checklist completeness
    const checklist = Array.isArray(row.checklist) ? (row.checklist as any[]) : [];
    if (data.checklistResults.length < checklist.length) {
      throw new Error("Please set a status for every checklist item.");
    }
    if (data.checklistResults.some((r) => !r.status)) {
      throw new Error("Please set a status for every checklist item.");
    }
    const needed = row.photos_count_required ?? 0;
    if (row.requires_photos && data.photos.length < needed) {
      throw new Error(`Please add at least ${needed} photo(s).`);
    }

    // Upload photos via admin client
    const photoPaths: string[] = [];
    for (let i = 0; i < data.photos.length; i++) {
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(data.photos[i].dataUrl);
      if (!m) continue;
      const mime = m[1];
      const ext = mime.split("/")[1].replace("jpeg", "jpg");
      const bytes = Buffer.from(m[2], "base64");
      const path = `${row.id}/${Date.now()}_${i}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
      photoPaths.push(path);
    }

    const submittedAt = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("runner_tasks")
      .update({
        checklist_results: data.checklistResults as any,
        photo_urls: photoPaths,
        runner_notes: data.runnerNotes || null,
        completed_at: submittedAt,
        submitted_at: submittedAt,
        status: "submitted",
      })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);

    // Notify admin
    try {
      const details = (row.details ?? {}) as Record<string, any>;
      const vehicleLine = details.vehicleLabel ? `\n${details.vehicleLabel}` : "";
      await sendSms(
        ADMIN_NOTIFY_PHONE,
        `✓ ${row.runner_name} completed task: ${row.title}${vehicleLine}\nView report in dashboard.`,
        "Camauto Admin",
      );
    } catch (e) {
      console.error("admin notify SMS failed", e);
    }

    return { ok: true as const, runnerName: row.runner_name as string };
  });