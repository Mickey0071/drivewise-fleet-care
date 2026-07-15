import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_REPAIR_PHONE = "267-221-3977";
const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

function originFromEnv(): string {
  return process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
}

function genToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ChecklistItem {
  id: string;
  label: string;
}
export interface ChecklistResult {
  id: string;
  label: string;
  result: "pass" | "fail" | "na";
  notes?: string;
}
export interface PartItem {
  name: string;
  qty?: number;
  price: number;
  labor?: number;
}

export interface MechanicJobRow {
  id: string;
  maintenance_id: string;
  vehicle_id: string | null;
  mechanic_name: string;
  mechanic_phone: string;
  mechanic_shop: string | null;
  issue_description: string | null;
  additional_context: string | null;
  checklist_items: ChecklistItem[];
  checklist_results: ChecklistResult[] | null;
  parts_list: PartItem[] | null;
  labour_cost: number;
  estimated_hours: number | null;
  mechanic_notes: string | null;
  mechanic_recommendations: string | null;
  completed_by_kind: "mechanic" | "admin" | null;
  completed_by_name: string | null;
  token: string;
  status: "sent" | "submitted" | "cancelled";
  sent_at: string;
  submitted_at: string | null;
  created_by_admin: string | null;
  created_at: string;
}

/** Admin (Phase 1): create a mechanic diagnosis request + SMS the mechanic. */
export const createMechanicJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    maintenanceId: string;
    vehicleId?: string | null;
    mechanicName: string;
    mechanicPhone: string;
    mechanicShop?: string;
    issueDescription?: string;
    additionalContext?: string;
    checklistItems: ChecklistItem[];
    vehicleLabel?: string;
    plate?: string;
    createdByAdmin?: string;
  }) => {
    const maintenanceId = (d.maintenanceId ?? "").trim();
    if (!maintenanceId) throw new Error("maintenance id required");
    const name = (d.mechanicName ?? "").trim();
    if (!name || name.length > 120) throw new Error("Mechanic name required");
    const phone = (d.mechanicPhone ?? "").trim();
    if (!phone || phone.length > 40) throw new Error("Mechanic phone required");
    const items = (Array.isArray(d.checklistItems) ? d.checklistItems : [])
      .map((i) => ({ id: String(i.id).slice(0, 40), label: String(i.label ?? "").slice(0, 200) }))
      .filter((i) => i.label.trim().length > 0)
      .slice(0, 40);
    return {
      maintenanceId,
      vehicleId: d.vehicleId ?? null,
      mechanicName: name,
      mechanicPhone: phone,
      mechanicShop: (d.mechanicShop ?? "").slice(0, 200) || null,
      issueDescription: (d.issueDescription ?? "").slice(0, 1000) || null,
      additionalContext: (d.additionalContext ?? "").slice(0, 2000) || null,
      checklistItems: items,
      vehicleLabel: (d.vehicleLabel ?? "").slice(0, 120),
      plate: (d.plate ?? "").slice(0, 40),
      createdByAdmin: (d.createdByAdmin ?? "").slice(0, 120) || null,
    };
  })
  .handler(async ({ data }) => {
    const token = genToken();
    const { data: row, error } = await supabaseAdmin
      .from("mechanic_jobs")
      .insert({
        maintenance_id: data.maintenanceId,
        vehicle_id: data.vehicleId,
        mechanic_name: data.mechanicName,
        mechanic_phone: data.mechanicPhone,
        mechanic_shop: data.mechanicShop,
        issue_description: data.issueDescription,
        additional_context: data.additionalContext,
        checklist_items: data.checklistItems,
        token,
        status: "sent",
        created_by_admin: data.createdByAdmin,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const link = `${originFromEnv()}/mechanic-job/${token}`;
    const action = data.checklistItems.length > 0 ? "Complete the checklist here" : "Submit your diagnosis here";
    const msg =
      `Hi ${data.mechanicName}, Camauto Rentals needs your diagnosis on a vehicle.\n\n` +
      `Vehicle: ${data.vehicleLabel || "—"}${data.plate ? ` (Plate: ${data.plate})` : ""}\n` +
      `Issue: ${data.issueDescription || "—"}\n\n` +
      `${action}: ${link}\n\nReply when done.`;
    try {
      await sendSms(data.mechanicPhone, msg, data.mechanicName);
    } catch (e) {
      console.error("mechanic SMS failed", e);
    }
    return { ok: true as const, id: row.id, token };
  });

/** Admin: resend the SMS link for an existing job (same token). */
export const resendMechanicJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; vehicleLabel?: string; plate?: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: d.id, vehicleLabel: (d.vehicleLabel ?? "").slice(0, 120), plate: (d.plate ?? "").slice(0, 40) };
  })
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("mechanic_jobs")
      .select("token, status, mechanic_name, mechanic_phone, issue_description")
      .eq("id", data.id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (job.status !== "sent") throw new Error("This request can no longer be resent");
    const link = `${originFromEnv()}/mechanic-job/${job.token}`;
    const msg =
      `Hi ${job.mechanic_name}, reminder from Camauto Rentals — please complete the vehicle diagnosis.\n\n` +
      `Vehicle: ${data.vehicleLabel || "—"}${data.plate ? ` (Plate: ${data.plate})` : ""}\n` +
      `Issue: ${job.issue_description || "—"}\n\n` +
      `Complete the checklist here: ${link}`;
    await sendSms(job.mechanic_phone, msg, job.mechanic_name);
    return { ok: true as const };
  });

/** Admin: cancel a job (voids the token). */
export const cancelMechanicJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: d.id };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("mechanic_jobs")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("status", "sent");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: list all jobs (for the Mechanic Job History section). */
export const listMechanicJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("mechanic_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

/** Public (no auth): load a job by token for the mechanic's phone. */
export const getMechanicJobPublic = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("mechanic_jobs")
      .select(
        "id, maintenance_id, vehicle_id, mechanic_name, mechanic_shop, issue_description, additional_context, checklist_items, status, submitted_at",
      )
      .eq("token", data.token)
      .maybeSingle();
    if (!job) return { found: false as const };

    let vehicle: { year: string | number; make: string; model: string; plate: string } = {
      year: "",
      make: "",
      model: "",
      plate: "",
    };
    if (job.vehicle_id) {
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("year, make, model, plate")
        .eq("id", job.vehicle_id)
        .maybeSingle();
      if (v) {
        vehicle = {
          year: v.year ?? "",
          make: v.make ?? "",
          model: v.model ?? "",
          plate: v.plate ?? "",
        };
      }
    }
    return {
      found: true as const,
      job: {
        id: job.id,
        mechanicName: job.mechanic_name,
        mechanicShop: job.mechanic_shop ?? "",
        issueDescription: job.issue_description ?? "",
        additionalContext: job.additional_context ?? "",
        checklistItems: (job.checklist_items ?? []) as unknown as ChecklistItem[],
        status: job.status as "sent" | "submitted" | "cancelled",
        submittedAt: job.submitted_at ?? null,
      },
      vehicle,
    };
  });

/** Public (no auth): mechanic submits the diagnosis -> auto-populates Phase 2. */
export const submitMechanicJob = createServerFn({ method: "POST" })
  .inputValidator((d: {
    token: string;
    checklistResults: ChecklistResult[];
    partsList: PartItem[];
    labourCost?: number | null;
    estimatedHours?: number | null;
    mechanicNotes?: string;
  }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    const results = (Array.isArray(d.checklistResults) ? d.checklistResults : [])
      .map((r) => ({
        id: String(r.id).slice(0, 40),
        label: String(r.label ?? "").slice(0, 200),
        result: (["pass", "fail", "na"].includes(r.result) ? r.result : "na") as "pass" | "fail" | "na",
        notes: (r.notes ?? "").slice(0, 500),
      }))
      .slice(0, 40);
    const parts = (Array.isArray(d.partsList) ? d.partsList : [])
      .map((p) => ({ name: String(p.name ?? "").slice(0, 200), price: Number(p.price) || 0, labor: Number(p.labor) || 0 }))
      .filter((p) => p.name.trim().length > 0 && p.price >= 0)
      .slice(0, 50);
    const partsLaborTotal = parts.reduce((s, p) => s + (Number(p.labor) || 0), 0);
    const labour = (d.labourCost == null ? 0 : Number(d.labourCost)) + partsLaborTotal;
    if (!Number.isFinite(labour) || labour < 0 || labour > 1000000) throw new Error("Invalid labour cost");
    const hours = d.estimatedHours == null ? null : Number(d.estimatedHours);
    if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 1000)) throw new Error("Invalid hours");
    const partsTotal = parts.reduce((s, p) => s + p.price, 0);
    if (!(partsTotal > 0) && !(labour > 0)) throw new Error("Add parts or a labour estimate");
    return {
      token: d.token,
      checklistResults: results,
      partsList: parts,
      labourCost: labour,
      estimatedHours: hours,
      mechanicNotes: (d.mechanicNotes ?? "").slice(0, 2000),
      partsTotal,
    };
  })
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("mechanic_jobs")
      .select("id, status, maintenance_id, vehicle_id, mechanic_name, mechanic_phone, mechanic_shop, issue_description")
      .eq("token", data.token)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (job.status !== "sent") throw new Error("This diagnosis has already been submitted");

    const now = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("mechanic_jobs")
      .update({
        checklist_results: data.checklistResults,
        parts_list: data.partsList,
        labour_cost: data.labourCost,
        estimated_hours: data.estimatedHours,
        mechanic_notes: data.mechanicNotes,
        submitted_at: now,
        status: "submitted",
      })
      .eq("id", job.id)
      .eq("status", "sent");
    if (upErr) throw new Error(upErr.message);

    // Auto-populate Phase 2 (Diagnose) on the linked maintenance ticket.
    const total = data.partsTotal + data.labourCost;
    const partsLines = data.partsList.map((p) => `• ${p.name} — $${p.price.toFixed(2)}`).join("\n");
    const diagnosisNotes = [
      data.mechanicNotes,
      partsLines ? `\nParts:\n${partsLines}` : "",
      `\nMechanic: ${job.mechanic_name}${job.mechanic_phone ? ` — ${job.mechanic_phone}` : ""}${job.mechanic_shop ? ` (${job.mechanic_shop})` : ""}`,
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    const { data: mnt } = await supabaseAdmin
      .from("maintenance")
      .select("id, amount_paid, vehicle_id")
      .eq("id", job.maintenance_id)
      .maybeSingle();
    const acceptToken = genToken();
    const declineToken = genToken();
    if (mnt) {
      const amountPaid = Number(mnt.amount_paid ?? 0);
      await supabaseAdmin
        .from("maintenance")
        .update({
          status: "diagnosing",
          diagnosis_notes: diagnosisNotes,
          parts_cost: data.partsTotal,
          labor_cost: data.labourCost,
          cost: total,
          balance: Math.max(0, total - amountPaid),
          mechanic_name: job.mechanic_name,
          mechanic_phone: job.mechanic_phone,
          issue_description: job.issue_description,
          parts_list: data.partsList,
          accept_token: acceptToken,
          decline_token: declineToken,
          action_taken: "pending",
        })
        .eq("id", job.maintenance_id);
    }

    // SMS the admin.
    let vehicleLabel = "vehicle";
    let vehiclePlate = "";
    if (job.vehicle_id) {
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("year, make, model, plate")
        .eq("id", job.vehicle_id)
        .maybeSingle();
      if (v) {
        vehicleLabel = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || vehicleLabel;
        vehiclePlate = v.plate ?? "";
      }
    }
    const origin = originFromEnv();
    const partsLinesSms =
      data.partsList.length > 0
        ? `\nParts:\n${data.partsList.map((p) => `• ${p.name} — $${p.price.toFixed(2)}`).join("\n")}\nParts total: $${data.partsTotal.toFixed(2)}`
        : "";
    const adminMsg =
      `✓ ${job.mechanic_name} submitted diagnosis for ${vehicleLabel}${vehiclePlate ? ` (Plate: ${vehiclePlate})` : ""}.\n` +
      `Issue: ${job.issue_description || "repair"}${partsLinesSms}\n` +
      `Labour: $${data.labourCost.toFixed(2)}\nTotal: $${total.toFixed(2)}\n\n` +
      `✅ Accept: ${origin}/repair/accept/${acceptToken}\n` +
      `❌ Decline: ${origin}/repair/decline/${declineToken}`;
    try {
      await sendSms(ADMIN_REPAIR_PHONE, adminMsg, "Admin");
    } catch (e) {
      console.error("admin SMS failed", e);
    }
    return { ok: true as const };
  });