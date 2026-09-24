import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/ghl.server";
import type { Json } from "@/integrations/supabase/types";

export type WaitlistSource = "agency" | "facebook" | "manual" | "direct";
export type WaitlistTier = "qualified" | "low_go" | "unvetted";

export interface WaitlistIntakeData {
  name: string;
  phone: string;
  email?: string;
  drives_rideshare?: boolean;
  accepts_deposit?: boolean;
  accepts_daily_rate?: boolean;
  preferred_start?: string;
  src: WaitlistSource;
  campaign?: string;
  raw: Record<string, unknown>;
}

function safeKeyMatches(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const receivedHash = createHash("sha256").update(received).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

export function authorizeWaitlistIntake(received: string | null): boolean {
  return safeKeyMatches(received, process.env["WAITLIST_INTAKE_KEY"]);
}

export function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

export function normalizeIntakePhone(value: string): string {
  const normalized = normalizePhone(value);
  if (!/^\+1\d{10}$/.test(normalized)) throw new Error("phone must be a valid 10-digit US number");
  return normalized;
}

export async function consumeIntakeRateLimit(key: string): Promise<boolean> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabaseAdmin.rpc("consume_waitlist_intake_rate_limit", {
    _key_hash: keyHash,
    _window_seconds: 60,
    _max_requests: 30,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data === true;
}

function tierFor(data: WaitlistIntakeData): WaitlistTier {
  if (data.accepts_deposit === undefined && data.accepts_daily_rate === undefined) return "unvetted";
  return data.accepts_deposit === true || data.accepts_daily_rate === true ? "qualified" : "low_go";
}

export async function processWaitlistIntake(data: WaitlistIntakeData) {
  const normalizedPhone = normalizeIntakePhone(data.phone);
  const tier = tierFor(data);
  const qualifiesForLink = tier !== "low_go";
  const now = new Date().toISOString();
  const { data: matches, error: findError } = await supabaseAdmin
    .from("waitlist_entries")
    .select("id, status, upload_token, qualification_sms_sent_at, courtesy_sms_sent_at, converted_at")
    .eq("normalized_phone", normalizedPhone)
    .order("created_at", { ascending: true })
    .limit(1);
  if (findError) throw new Error(findError.message);
  const existing = matches?.[0];
  const status = existing?.status === "Converted"
    ? "Converted"
    : qualifiesForLink ? "Link sent" : "Waitlisted";
  const patch = {
    name: data.name,
    phone: normalizedPhone,
    normalized_phone: normalizedPhone,
    ...(data.email !== undefined ? { email: data.email } : {}),
    drives_rideshare: data.drives_rideshare ?? null,
    rideshare_checkbox: data.drives_rideshare ?? false,
    priority: data.drives_rideshare === true ? "high" : "normal",
    accepts_deposit: data.accepts_deposit ?? null,
    accepts_daily_rate: data.accepts_daily_rate ?? null,
    preferred_start: data.preferred_start ?? null,
    source_param: data.src,
    source: data.src,
    campaign_param: data.campaign ?? null,
    intake_payload: data.raw as Json,
    vetting_tier: tier,
    status,
    admin_seen_at: null,
    ...(qualifiesForLink && status !== "Converted" ? { link_sent_at: now } : {}),
  };

  let row: { id: string; upload_token: string | null; qualification_sms_sent_at: string | null; courtesy_sms_sent_at: string | null };
  let created = false;
  if (existing) {
    const { data: updated, error } = await supabaseAdmin
      .from("waitlist_entries")
      .update(patch)
      .eq("id", existing.id)
      .select("id, upload_token, qualification_sms_sent_at, courtesy_sms_sent_at")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "Could not update waitlist entry");
    row = updated;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("waitlist_entries")
      .insert({ ...patch, email: data.email ?? "" })
      .select("id, upload_token, qualification_sms_sent_at, courtesy_sms_sent_at")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not create waitlist entry");
    row = inserted;
    created = true;
  }

  let smsSent = false;
  const shouldSendQualified = qualifiesForLink && !row.qualification_sms_sent_at && status !== "Converted";
  const shouldSendCourtesy = tier === "low_go" && !row.courtesy_sms_sent_at && status !== "Converted";
  if (shouldSendQualified || shouldSendCourtesy) {
    const { sendSms } = await import("@/lib/ghl.server");
    const firstName = data.name.split(/\s+/)[0] ?? "";
    const origin = (process.env["PUBLIC_APP_ORIGIN"] || "https://camautorentals.lovable.app").replace(/\/$/, "");
    const message = shouldSendQualified
      ? `Camauto Rentals: Hi${firstName ? ` ${firstName}` : ""}, please upload your driver's license and selfie here: ${origin}/waitlist/upload/${row.upload_token}`
      : "Thanks for your interest in Camauto Rentals. Someone from our team will be in touch shortly.";
    try {
      await sendSms(normalizedPhone, message, data.name);
      smsSent = true;
      await supabaseAdmin
        .from("waitlist_entries")
        .update(shouldSendQualified ? { qualification_sms_sent_at: now } : { courtesy_sms_sent_at: now })
        .eq("id", row.id);
    } catch (error) {
      console.error("[waitlist-intake] SMS failed", error);
    }
  }

  if (tier === "qualified" && (created || existing?.status === "Waitlisted")) {
    try {
      const [{ sendSms }, { getAlertGlobalConfig }] = await Promise.all([
        import("@/lib/ghl.server"),
        import("@/lib/alerts.server"),
      ]);
      const config = await getAlertGlobalConfig();
      if (config.masterSmsEnabled && config.adminPhone) {
        const origin = (process.env["PUBLIC_APP_ORIGIN"] || "https://camautorentals.lovable.app").replace(/\/$/, "");
        await sendSms(config.adminPhone, `New qualified waitlist entry: ${data.name} · ${normalizedPhone}. Review: ${origin}/admin/waitlist`, "Camauto Staff");
      }
    } catch (error) {
      console.error("[waitlist-intake] staff notification failed", error);
    }
  }

  return { created, tier, status, smsSent };
}