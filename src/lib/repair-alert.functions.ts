import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_REPAIR_PHONE = "267-221-3977";

/** Real-time alert sent immediately when a NEW repair/issue is created. */
export const sendNewRepairAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { vehicle: string; issue: string }) => {
    if (!input.vehicle || typeof input.vehicle !== "string") throw new Error("vehicle required");
    if (!input.issue || typeof input.issue !== "string") throw new Error("issue required");
    return {
      vehicle: input.vehicle.slice(0, 120),
      issue: input.issue.slice(0, 200),
    };
  })
  .handler(async ({ data }) => {
    const { raiseAlert } = await import("@/lib/alerts.server");
    const res = await raiseAlert(
      {
        section: "repairs",
        alertType: "repair_opened",
        vehicleLabel: data.vehicle,
        headline: data.vehicle,
        detail: `New repair — ${data.issue}`,
        severity: 2,
      },
      { toggleKey: "sms_on_opened" },
    );
    return { ok: true, outcome: res.outcome };
  });