import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NotificationType =
  | "pending_agreements"
  | "extension_pending"
  | "admin_morning_text"
  | "new_issue_alerts"
  | "past_due_payments"
  | "auto_extension_links"
  | "autopay_reminders";

export interface NotificationSettingRow {
  notification_type: string;
  enabled: boolean;
  send_time: string | null;
  recipient_type: string;
  recipient_number: string | null;
  message_template: string | null;
  link_template: string | null;
}

/**
 * Server-side check used by hooks/server fns before sending any SMS/email.
 * Missing row => treated as enabled (fail open) so unconfigured types still work.
 * An explicit `enabled = false` blocks sending.
 */
export async function getNotificationSetting(
  type: NotificationType,
): Promise<NotificationSettingRow | null> {
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select(
      "notification_type, enabled, send_time, recipient_type, recipient_number, message_template, link_template",
    )
    .eq("notification_type", type)
    .maybeSingle();
  return (data as NotificationSettingRow | null) ?? null;
}

export async function isNotificationEnabled(type: NotificationType): Promise<boolean> {
  const row = await getNotificationSetting(type);
  return row ? row.enabled !== false : true;
}