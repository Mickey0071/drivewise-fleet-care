import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

/**
 * Public (no auth): fetch a work order + its vehicle by field-access token so a
 * mechanic can view it on their phone.
 */
export const getWorkOrderFieldPublic = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: wo } = await supabaseAdmin
      .from("work_orders")
      .select(
        "id, vehicle_id, service_type, scheduled_date, estimated_cost, description, assigned_to, priority, status, completed_date, actual_cost, parts_used, completion_notes, mechanic_signature, mechanic_signed_at, field_submitted_at",
      )
      .eq("field_token", data.token)
      .maybeSingle();
    if (!wo) return { found: false as const };

    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("year, make, model, plate, vin")
      .eq("id", wo.vehicle_id)
      .maybeSingle();

    return {
      found: true as const,
      workOrder: {
        id: wo.id,
        serviceType: wo.service_type,
        scheduledDate: wo.scheduled_date,
        estimatedCost: Number(wo.estimated_cost ?? 0),
        description: wo.description ?? "",
        assignedTo: wo.assigned_to ?? "",
        priority: wo.priority,
        status: wo.status,
        completedDate: wo.completed_date ?? "",
        actualCost: wo.actual_cost != null ? Number(wo.actual_cost) : null,
        partsUsed: wo.parts_used ?? "",
        completionNotes: wo.completion_notes ?? "",
        mechanicSignedAt: wo.mechanic_signed_at ?? null,
        fieldSubmittedAt: wo.field_submitted_at ?? null,
      },
      vehicle: {
        year: v?.year ?? "",
        make: v?.make ?? "",
        model: v?.model ?? "",
        plate: v?.plate ?? "",
        vin: v?.vin ?? "",
      },
    };
  });

/**
 * Public (no auth): a mechanic submits the completed work order from the field.
 */
export const submitWorkOrderField = createServerFn({ method: "POST" })
  .inputValidator((d: {
    token: string;
    mechanicName: string;
    completedDate?: string;
    actualCost?: number | null;
    partsUsed?: string;
    completionNotes?: string;
    mechanicSignature: string;
  }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    const name = (d.mechanicName ?? "").trim();
    if (!name || name.length > 120) throw new Error("Please enter your full name");
    if (!d.mechanicSignature || !d.mechanicSignature.startsWith("data:image")) {
      throw new Error("Signature is required");
    }
    if (d.mechanicSignature.length > 600000) throw new Error("Signature too large");
    const cost = d.actualCost == null ? null : Number(d.actualCost);
    if (cost != null && (!Number.isFinite(cost) || cost < 0 || cost > 1000000)) {
      throw new Error("Invalid cost");
    }
    const date = (d.completedDate ?? "").trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
    return {
      token: d.token,
      mechanicName: name,
      completedDate: date || null,
      actualCost: cost,
      partsUsed: (d.partsUsed ?? "").slice(0, 2000),
      completionNotes: (d.completionNotes ?? "").slice(0, 2000),
      mechanicSignature: d.mechanicSignature,
    };
  })
  .handler(async ({ data }) => {
    const { data: wo } = await supabaseAdmin
      .from("work_orders")
      .select("id, status")
      .eq("field_token", data.token)
      .maybeSingle();
    if (!wo) throw new Error("Work order not found");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("work_orders")
      .update({
        assigned_to: data.mechanicName,
        completed_date: data.completedDate,
        actual_cost: data.actualCost,
        parts_used: data.partsUsed || null,
        completion_notes: data.completionNotes || null,
        mechanic_signature: data.mechanicSignature,
        mechanic_signed_at: now,
        field_submitted_at: now,
        status: data.completedDate ? "completed" : "in_progress",
      })
      .eq("id", wo.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });