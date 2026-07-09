import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_NOTIFY_PHONE = "267-221-3977";

export interface RmItemInput {
  type: string;
  customId?: string;
  label: string;
  due?: string;
  status?: "Pass" | "Fail" | "";
  notes?: string;
}

function genMaintenanceId(): string {
  const rand = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`)
    .replace(/-/g, "")
    .slice(0, 10)
    .toUpperCase();
  return `MN-${rand}`;
}

/** Replicates store.markScheduledComplete on a plain settings object. */
function clearScheduled(settings: any, type: string, customId: string | undefined, mileage: number) {
  const s = { ...(settings ?? {}) };
  const today = new Date().toISOString().slice(0, 10);
  if (type === "oil") {
    const oc = { ...(s.oilChange ?? { mode: "miles", interval: 0 }) };
    oc.lastMileage = mileage;
    oc.lastDate = today;
    s.oilChange = oc;
  } else if (type === "battery") {
    s.batteryLastDone = today;
  } else if (type === "alternator") {
    s.alternatorLastDone = today;
  } else if (type === "inspection") {
    const n = new Date();
    n.setFullYear(n.getFullYear() + 1);
    s.inspectionExpiry = n.toISOString().slice(0, 10);
  } else if (type === "custom" && customId) {
    s.customAlerts = (s.customAlerts ?? []).map((c: any) =>
      c.id === customId ? { ...c, lastDate: today } : c,
    );
  }
  return s;
}

export interface RmApplyResult {
  vehicleLabel: string;
  passed: string[];
  failed: string[];
  mileage: number;
}

/** Core submit logic shared by admin + public token submissions. */
export async function applyRmSubmission(input: {
  vehicleId: string;
  items: RmItemInput[];
  inspectorName: string;
  inspectorType: string;
  mileage?: number | null;
  overallNotes?: string;
}): Promise<RmApplyResult> {
  const { data: v } = await supabaseAdmin
    .from("vehicles")
    .select("*")
    .eq("id", input.vehicleId)
    .maybeSingle();
  if (!v) throw new Error("Vehicle not found");

  const mileage = input.mileage != null ? input.mileage : (v as any).mileage ?? 0;
  let settings: any = (v as any).maintenance_settings ?? {};
  const passed: string[] = [];
  const failed: string[] = [];

  for (const it of input.items) {
    if (it.status === "Pass") {
      settings = clearScheduled(settings, it.type, it.customId, mileage);
      passed.push(it.label);
    } else if (it.status === "Fail") {
      failed.push(it.label);
      const notesCombined = [it.notes, input.overallNotes].filter(Boolean).join("\n");
      await supabaseAdmin.from("maintenance").insert({
        id: genMaintenanceId(),
        vehicle_id: input.vehicleId,
        service_type: `${it.label} failed RM inspection`,
        issue_description: `${it.label} failed RM inspection`,
        vendor: "Pending assignment",
        mileage_at_service: mileage,
        cost: 0,
        status: "reported",
        source: "rm_card_failure",
        is_rental_blocking: true,
        notes: notesCombined || null,
        next_service_due: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      } as any);
    }
  }

  const historyEntry = {
    date: new Date().toISOString().slice(0, 10),
    inspected_by: input.inspectorName || "Admin",
    inspector_type: input.inspectorType,
    items_checked: input.items.length,
    items_passed: passed.length,
    items_failed: failed.length,
    failures: failed,
    mileage,
    notes: input.overallNotes || "",
  };
  const history = Array.isArray((v as any).rm_history) ? (v as any).rm_history : [];
  const nowIso = new Date().toISOString();

  const vehicleUpdate: any = {
    maintenance_settings: settings,
    rm_history: [...history, historyEntry],
    last_rm_date: nowIso,
    last_rm_mileage: mileage,
  };
  // Roll the vehicle's current odometer forward from this RM reading.
  // Increase-only: only advance when the new reading is higher than on record.
  if (typeof input.mileage === "number" && input.mileage > ((v as any).mileage ?? 0)) {
    vehicleUpdate.mileage = input.mileage;
  }
  if (failed.length > 0) {
    vehicleUpdate.has_open_issues = true;
    vehicleUpdate.status = "maintenance";
  }
  await supabaseAdmin.from("vehicles").update(vehicleUpdate).eq("id", input.vehicleId);

  const vehicleLabel = `${(v as any).year ?? ""} ${(v as any).make ?? ""} ${(v as any).model ?? ""}`.trim() || input.vehicleId;

  // Completion SMS to admin
  try {
    await sendSms(
      ADMIN_NOTIFY_PHONE,
      `✓ RM Card complete: ${vehicleLabel}\nPassed: ${passed.length} | Failed: ${failed.length}` +
        (failed.length ? `\nFailed items: ${failed.join(", ")}` : ""),
      "Camauto Admin",
    );
  } catch (e) {
    console.error("rm admin SMS failed", e);
  }

  // Failure alert (respects Notifications tab toggle)
  if (failed.length > 0) {
    try {
      const { isNotificationEnabled } = await import("@/lib/notifications.server");
      if (await isNotificationEnabled("new_issue_alerts")) {
        await sendSms(
          ADMIN_NOTIFY_PHONE,
          `⚠️ RM Card created new repair issues:\n` +
            failed.map((f) => `- ${vehicleLabel} - ${f}`).join("\n"),
          "Camauto Admin",
        );
      }
    } catch (e) {
      console.error("rm failure alert failed", e);
    }
  }

  return { vehicleLabel, passed, failed, mileage };
}
