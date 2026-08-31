import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ALERT_SECTIONS = [
  "maintenance",
  "repairs",
  "violations",
  "payments",
  "runner_tasks",
] as const;

export interface AlertSettingsRow {
  notification_type: string;
  enabled: boolean;
  sms_enabled: boolean;
  app_enabled: boolean;
  frequency: string;
  send_time: string | null;
  send_day: string | null;
  master_sms_enabled: boolean;
  admin_phone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  link_base_url: string | null;
  toggles: Record<string, boolean>;
}

const SELECT =
  "notification_type, enabled, sms_enabled, app_enabled, frequency, send_time, send_day, master_sms_enabled, admin_phone, quiet_hours_start, quiet_hours_end, link_base_url, toggles";

/** Global row + one row per section. */
export const getAlertSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notification_settings")
      .select(SELECT)
      .in("notification_type", ["__global__", ...ALERT_SECTIONS]);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as unknown as AlertSettingsRow[] };
  });

const globalSchema = z.object({
  master_sms_enabled: z.boolean(),
  admin_phone: z.string().max(40).nullable(),
  quiet_hours_start: z.string().max(8).nullable(),
  quiet_hours_end: z.string().max(8).nullable(),
  link_base_url: z.string().max(300).nullable(),
});

export const updateAlertGlobal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => globalSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_settings")
      .update({
        master_sms_enabled: data.master_sms_enabled,
        admin_phone: data.admin_phone || null,
        quiet_hours_start: data.quiet_hours_start || null,
        quiet_hours_end: data.quiet_hours_end || null,
        link_base_url: data.link_base_url || null,
      })
      .eq("notification_type", "__global__");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const sectionSchema = z.object({
  notification_type: z.enum(ALERT_SECTIONS),
  sms_enabled: z.boolean(),
  app_enabled: z.boolean(),
  frequency: z.enum(["immediate", "daily", "weekly", "off"]),
  send_time: z.string().max(8).nullable(),
  send_day: z.string().max(16).nullable(),
  toggles: z.record(z.string(), z.boolean()),
});

export const updateAlertSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => sectionSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_settings")
      .update({
        sms_enabled: data.sms_enabled,
        app_enabled: data.app_enabled,
        frequency: data.frequency,
        enabled: data.frequency !== "off",
        send_time: data.send_time || null,
        send_day: data.send_day || null,
        toggles: data.toggles,
      })
      .eq("notification_type", data.notification_type);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Send a sample grouped alert to the configured admin phone. */
export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ section: z.enum(ALERT_SECTIONS) }).parse(i))
  .handler(async ({ data }) => {
    const { getAlertGlobalConfig, buildGroupedMessages } = await import("@/lib/alerts.server");
    const { sendSms } = await import("@/lib/ghl.server");
    const global = await getAlertGlobalConfig();
    const messages = buildGroupedMessages(
      data.section,
      [
        {
          section: data.section,
          alertType: "test",
          plate: "K34LPZ",
          vehicleLabel: "2015 Chevy Malibu",
          detail: "Oil change overdue 12d",
          severity: 3,
        },
        {
          section: data.section,
          alertType: "test",
          plate: "K34LPZ",
          vehicleLabel: "2015 Chevy Malibu",
          detail: "Brakes inspection due in 3d",
          severity: 1,
        },
        {
          section: data.section,
          alertType: "test",
          plate: "T88QRM",
          vehicleLabel: "2014 Ford Fusion",
          detail: "NJ Inspection overdue 4d",
          severity: 3,
        },
      ],
      global.linkBaseUrl,
    );
    for (const m of messages) await sendSms(global.adminPhone, `TEST\n${m}`, "Admin");
    return { ok: true, messages };
  });
