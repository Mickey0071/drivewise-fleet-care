import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

export type VerifyReminderType =
  | "cardholder_verify_initial"
  | "cardholder_verify_1h"
  | "cardholder_verify_daily";

const DEFAULT_TEMPLATES: Record<VerifyReminderType, string> = {
  cardholder_verify_initial:
    "Action needed: Please verify your card payment for your rental. Verify here: [link]",
  cardholder_verify_1h:
    "Reminder: Your rental requires card verification. Verify here: [link]",
  cardholder_verify_daily:
    "Card verification still needed. Please complete to avoid a potential payment dispute. [link]",
};

/** Read the admin-controlled toggle + custom templates for verification reminders. */
export async function getVerifyReminderSetting(): Promise<{
  enabled: boolean;
  recipientType: string;
  messageTemplate: string | null;
}> {
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("enabled, recipient_type, message_template")
    .eq("notification_type", "cardholder_verification")
    .maybeSingle();
  return {
    enabled: data?.enabled ?? true,
    recipientType: (data?.recipient_type as string) ?? "customer",
    messageTemplate: (data?.message_template as string) ?? null,
  };
}

/** Stable link to the cardholder verification form for a rental. */
export function buildVerifyLink(rentalId: string): string {
  const origin =
    process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
  return `${origin}/rent/paid?rental_id=${encodeURIComponent(rentalId)}`;
}

function renderMessage(
  type: VerifyReminderType,
  link: string,
  customTemplate: string | null,
): string {
  // The daily cadence uses the admin-editable template; the initial + 1h
  // reminders use their own fixed copy so the messaging escalates correctly.
  const base =
    type === "cardholder_verify_daily" && customTemplate
      ? customTemplate
      : DEFAULT_TEMPLATES[type];
  return base.split("[link]").join(link).split("[verification_link]").join(link);
}

/**
 * Send one verification reminder to the customer and log it. Returns a result
 * describing what happened. Honors the admin toggle and de-dupes via
 * reminder_log. `dedupeDate` keys the daily cadence to one send per day.
 */
export async function sendVerifyReminder(opts: {
  rentalId: string;
  type: VerifyReminderType;
  phone: string | null;
  name: string | null;
  dedupeDate: string;
  globalDedupe?: boolean;
}): Promise<{ rentalId: string; type: VerifyReminderType; status: string }> {
  const setting = await getVerifyReminderSetting();
  if (!setting.enabled) {
    return { rentalId: opts.rentalId, type: opts.type, status: "disabled" };
  }
  if (!opts.phone) {
    return { rentalId: opts.rentalId, type: opts.type, status: "no_phone" };
  }

  // De-dupe: globalDedupe checks for ANY prior log of this type for the rental
  // (used for the one-time 1h follow-up); otherwise key on the dedupeDate.
  if (opts.globalDedupe) {
    const { data: prior } = await supabaseAdmin
      .from("reminder_log")
      .select("id")
      .eq("rental_id", opts.rentalId)
      .eq("reminder_type", opts.type)
      .limit(1);
    if (prior && prior.length) {
      return { rentalId: opts.rentalId, type: opts.type, status: "already_sent" };
    }
  } else {
    const { data: prior } = await supabaseAdmin
      .from("reminder_log")
      .select("id")
      .eq("rental_id", opts.rentalId)
      .eq("reminder_type", opts.type)
      .eq("target_date", opts.dedupeDate)
      .limit(1);
    if (prior && prior.length) {
      return { rentalId: opts.rentalId, type: opts.type, status: "already_sent" };
    }
  }

  const link = buildVerifyLink(opts.rentalId);
  const message = renderMessage(opts.type, link, setting.messageTemplate);
  try {
    await sendSms(opts.phone, message, opts.name);
  } catch (e) {
    console.error("[verify-reminder] SMS failed", e);
    return { rentalId: opts.rentalId, type: opts.type, status: "sms_failed" };
  }
  await supabaseAdmin.from("reminder_log").insert({
    rental_id: opts.rentalId,
    reminder_type: opts.type,
    target_date: opts.dedupeDate,
    phone: opts.phone,
    message,
  });
  return { rentalId: opts.rentalId, type: opts.type, status: "sent" };
}