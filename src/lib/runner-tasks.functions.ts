import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";

const PRIORITIES = ["low", "medium", "high"] as const;
const TOKEN_TTL_DAYS = 14;

function originFromEnv(): string {
  return process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
}

function genToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RunnerChecklistItem {
  id: string;
  label: string;
}

export interface RmTaskItem {
  type: string;
  customId?: string | null;
  label: string;
  due?: string | null;
}

/** Admin: create a link-based runner task, generate a token, and SMS the runner. */
export const createRunnerTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    runnerName: string;
    runnerPhone: string;
    title: string;
    priority: string;
    type?: string;
    vehicleId?: string | null;
    customerId?: string | null;
    location?: string;
    scheduledAt?: string | null;
    instructions?: string;
    checklist: RunnerChecklistItem[];
    vehicleLabel?: string;
    customerName?: string;
    customerPhone?: string;
    requiresPhotos?: boolean;
    photosCountRequired?: number;
    rmVehicleId?: string | null;
    rmMileage?: number | null;
    rmItems?: RmTaskItem[];
  }) => {
    const runnerName = (d.runnerName ?? "").trim();
    if (!runnerName || runnerName.length > 120) throw new Error("Runner name is required");
    const runnerPhone = (d.runnerPhone ?? "").trim();
    const digits = runnerPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid runner phone number");
    const title = (d.title ?? "").trim();
    if (!title || title.length > 200) throw new Error("Task title is required");
    const priority = PRIORITIES.includes(d.priority as any) ? d.priority : "medium";
    if (d.scheduledAt && Number.isNaN(Date.parse(d.scheduledAt))) throw new Error("Invalid scheduled date");
    const checklist = (Array.isArray(d.checklist) ? d.checklist : [])
      .map((i) => ({ id: String(i.id).slice(0, 40), label: String(i.label ?? "").slice(0, 200) }))
      .filter((i) => i.label.trim().length > 0)
      .slice(0, 60);
    const requiresPhotos = !!d.requiresPhotos;
    const photosCountRequired = requiresPhotos
      ? Math.min(Math.max(Number(d.photosCountRequired) || 1, 1), 20)
      : 0;
    const rmItems = (Array.isArray(d.rmItems) ? d.rmItems : [])
      .map((i) => ({
        type: String(i.type ?? "").slice(0, 40),
        customId: i.customId ? String(i.customId).slice(0, 80) : null,
        label: String(i.label ?? "").slice(0, 200),
        due: i.due ? String(i.due).slice(0, 40) : null,
      }))
      .filter((i) => i.label.trim().length > 0)
      .slice(0, 60);
    return {
      runnerName,
      runnerPhone,
      title,
      priority,
      type: (d.type ?? "custom").slice(0, 40) || "custom",
      vehicleId: d.vehicleId ? String(d.vehicleId).slice(0, 80) : null,
      customerId: d.customerId ? String(d.customerId).slice(0, 80) : null,
      location: (d.location ?? "").slice(0, 400) || null,
      scheduledAt: d.scheduledAt || null,
      instructions: (d.instructions ?? "").slice(0, 4000) || null,
      checklist,
      vehicleLabel: (d.vehicleLabel ?? "").slice(0, 160),
      customerName: (d.customerName ?? "").slice(0, 160) || null,
      customerPhone: (d.customerPhone ?? "").slice(0, 40) || null,
      requiresPhotos,
      photosCountRequired,
      rmVehicleId: d.rmVehicleId ? String(d.rmVehicleId).slice(0, 80) : null,
      rmMileage: d.rmMileage != null ? Number(d.rmMileage) : null,
      rmItems,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const token = genToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: row, error } = await supabase
      .from("runner_tasks")
      .insert({
        type: data.type,
        title: data.title,
        priority: data.priority,
        vehicle_id: data.vehicleId,
        customer_id: data.customerId,
        runner_name: data.runnerName,
        runner_phone: data.runnerPhone,
        location: data.location,
        scheduled_at: data.scheduledAt,
        instructions: data.instructions,
        checklist: data.checklist as any,
        requires_photos: data.requiresPhotos,
        photos_count_required: data.photosCountRequired,
        details: {
          vehicleLabel: data.vehicleLabel || null,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          rm: data.rmVehicleId
            ? {
                vehicleId: data.rmVehicleId,
                mileage: data.rmMileage,
                items: data.rmItems,
                applied: false,
              }
            : null,
        } as any,
        assigned_by: context.userId,
        status: "sent",
        token,
        token_expires_at: expiresAt,
        sent_at: now,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const link = `${originFromEnv()}/runner-task/${token}`;
    const vehicleLine = data.vehicleLabel ? `\nVehicle: ${data.vehicleLabel}` : "";
    const whenLine = data.scheduledAt
      ? `\nWhen: ${new Date(data.scheduledAt).toLocaleString("en-US")}`
      : "";
    const msg =
      `Hi ${data.runnerName}, Camauto Rentals has a task for you: ${data.title}.` +
      vehicleLine +
      whenLine +
      `\n\nOpen it on your phone: ${link}`;
    let smsStatus: "sent" | "failed" = "sent";
    try {
      await sendSms(data.runnerPhone, msg, data.runnerName);
    } catch (e) {
      console.error("runner task SMS failed", e);
      smsStatus = "failed";
    }
    return { ok: true as const, id: row.id as string, token, smsStatus };
  });