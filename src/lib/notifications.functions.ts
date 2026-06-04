import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_PHONE = "267-221-3977";

/** List all notification settings (admin only). */
export const listNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("notification_settings")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { settings: data ?? [] };
  });

const updateSchema = z.object({
  notification_type: z.string().min(1).max(64),
  enabled: z.boolean(),
  send_time: z.string().max(8).nullable().optional(),
  recipient_type: z.enum(["admin", "customer", "both"]),
  recipient_number: z.string().max(40).nullable().optional(),
  message_template: z.string().max(2000).nullable().optional(),
  link_template: z.string().max(1000).nullable().optional(),
});

/** Persist changes to one notification setting (admin only). */
export const updateNotificationSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("notification_settings")
      .update({
        enabled: data.enabled,
        send_time: data.send_time || null,
        recipient_type: data.recipient_type,
        recipient_number: data.recipient_number || null,
        message_template: data.message_template ?? null,
        link_template: data.link_template ?? null,
      })
      .eq("notification_type", data.notification_type);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const testSchema = z.object({
  notification_type: z.string().min(1).max(64),
  message_template: z.string().max(2000).nullable().optional(),
  link_template: z.string().max(1000).nullable().optional(),
});

/** Send a sample SMS of this notification to the admin number (admin only). */
export const testSendNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testSchema.parse(input))
  .handler(async ({ data }) => {
    const { sendSms } = await import("@/lib/ghl.server");
    const sampleData: Record<string, string> = {
      "[customers]": "John D., Maria S.",
      "[customer]": "John D.",
      "[count]": "3",
      "[list]": "2015 Malibu — Won't start, 2014 Ford — AC issue",
      "[vehicle]": "2015 Chevy Malibu",
      "[issue]": "Won't start",
      "[customers, amounts]": "John D. ($350), Maria S. ($200)",
      "[amount]": "350.00",
      "[link]": "https://camautorentals.lovable.app/",
    };
    let body = data.message_template || "Test notification";
    for (const [k, v] of Object.entries(sampleData)) {
      body = body.split(k).join(v);
    }
    const msg = `TEST: ${body}`;
    await sendSms(ADMIN_PHONE, msg, "Admin");
    return { ok: true };
  });