import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

/** Sections shown on /admin/alert-settings. */
export type AlertSection = "maintenance" | "repairs" | "violations" | "payments" | "runner_tasks";

export type AlertFrequency = "immediate" | "daily" | "weekly" | "off";

export interface AlertGlobalConfig {
  masterSmsEnabled: boolean;
  adminPhone: string;
  quietStart: string | null;
  quietEnd: string | null;
  linkBaseUrl: string | null;
}

export interface AlertSectionConfig {
  section: AlertSection;
  smsEnabled: boolean;
  appEnabled: boolean;
  frequency: AlertFrequency;
  sendTime: string | null;
  sendDay: string | null;
  toggles: Record<string, boolean>;
}

const DEFAULT_ADMIN_PHONE = "267-221-3977";
const MAX_SMS_CHARS = 1200;

/** One item in a grouped alert message. */
export interface AlertItem {
  section: AlertSection;
  alertType: string;
  vehicleId?: string | null;
  plate?: string | null;
  vehicleLabel?: string | null;
  /** Group header for non-vehicle alerts (e.g. "Beth Cruz — R-602"). */
  headline?: string | null;
  /** The bullet text, e.g. "Oil change overdue 12d". */
  detail: string;
  /** Optional sub-line under the group, e.g. "Mechanic: Mike's Auto". */
  subLine?: string | null;
  /** Higher = worse; used for worst-first ordering. */
  severity?: number;
  linkPath?: string | null;
}

/* ------------------------------------------------------------------ config */

export async function getAlertGlobalConfig(): Promise<AlertGlobalConfig> {
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("master_sms_enabled, admin_phone, quiet_hours_start, quiet_hours_end, link_base_url")
    .eq("notification_type", "__global__")
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  return {
    masterSmsEnabled: Boolean(row?.["master_sms_enabled"]),
    adminPhone: (row?.["admin_phone"] as string) || DEFAULT_ADMIN_PHONE,
    quietStart: (row?.["quiet_hours_start"] as string) ?? null,
    quietEnd: (row?.["quiet_hours_end"] as string) ?? null,
    linkBaseUrl: (row?.["link_base_url"] as string) || null,
  };
}

export async function getAlertSectionConfig(section: AlertSection): Promise<AlertSectionConfig> {
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("sms_enabled, app_enabled, frequency, send_time, send_day, toggles")
    .eq("notification_type", section)
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  return {
    section,
    smsEnabled: Boolean(row?.["sms_enabled"]),
    appEnabled: row?.["app_enabled"] !== false,
    frequency: ((row?.["frequency"] as AlertFrequency) || "off"),
    sendTime: (row?.["send_time"] as string) ?? null,
    sendDay: (row?.["send_day"] as string) ?? null,
    toggles: ((row?.["toggles"] as Record<string, boolean>) || {}),
  };
}

/* ------------------------------------------------------------- quiet hours */

/** Minutes since midnight, New York time (the shop's local time). */
function nowMinutesNY(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hh = Number(h);
  const mm = Number(m ?? "0");
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

export function inQuietHours(cfg: AlertGlobalConfig, atMinutes = nowMinutesNY()): boolean {
  const start = toMinutes(cfg.quietStart);
  const end = toMinutes(cfg.quietEnd);
  if (start == null || end == null || start === end) return false;
  // Overnight window (e.g. 21:00 → 08:00).
  if (start > end) return atMinutes >= start || atMinutes < end;
  return atMinutes >= start && atMinutes < end;
}

/* -------------------------------------------------------------- formatting */

function groupKey(i: AlertItem): string {
  return i.plate || i.headline || i.vehicleLabel || "Other";
}

function groupHeader(i: AlertItem): string {
  if (i.plate) {
    return i.vehicleLabel ? `${i.plate} · ${i.vehicleLabel}` : i.plate;
  }
  return i.headline || i.vehicleLabel || "Other";
}

interface Block {
  text: string;
  severity: number;
}

function buildBlocks(items: AlertItem[], unitNoun: string): Block[] {
  const groups = new Map<string, AlertItem[]>();
  for (const it of items) {
    const k = groupKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  const blocks: Block[] = [];
  for (const list of groups.values()) {
    // Within a group: worst-first (overdue before due-soon).
    const sorted = [...list].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
    const first = sorted[0]!;
    const lines: string[] = [groupHeader(first)];
    lines.push(`${sorted.length} ${sorted.length === 1 ? unitNoun : `${unitNoun}s`}`);
    for (const it of sorted) lines.push(` · ${it.detail}`);
    const sub = sorted.map((s) => s.subLine).find(Boolean);
    if (sub) lines.push(sub as string);
    blocks.push({
      text: lines.join("\n"),
      severity: Math.max(...sorted.map((s) => s.severity ?? 0)),
    });
  }
  // Worst-first ordering of vehicles.
  return blocks.sort((a, b) => b.severity - a.severity);
}

const SECTION_META: Record<AlertSection, { title: (n: number) => string; noun: string; path: string }> = {
  maintenance: { title: (n) => `Camauto alerts — ${n} vehicle${n === 1 ? "" : "s"}`, noun: "issue", path: "/maintenance" },
  repairs: { title: (n) => `Camauto — ${n} vehicle${n === 1 ? "" : "s"} in repair`, noun: "repair", path: "/repairs" },
  violations: { title: (n) => `Camauto — ${n} violation group${n === 1 ? "" : "s"}`, noun: "violation", path: "/violations" },
  payments: { title: (n) => `Camauto — ${n} payment${n === 1 ? "" : "s"} overdue`, noun: "item", path: "/payments" },
  runner_tasks: { title: (n) => `Camauto — ${n} runner task update${n === 1 ? "" : "s"}`, noun: "task", path: "/admin/tasks" },
};

/**
 * Build one or more SMS bodies, grouped by vehicle (or renter).
 * A single vehicle block is never split across two messages.
 */
export function buildGroupedMessages(
  section: AlertSection,
  items: AlertItem[],
  linkBaseUrl: string | null,
  titleOverride?: string,
): string[] {
  if (items.length === 0) return [];
  const meta = SECTION_META[section];
  const blocks = buildBlocks(items, meta.noun);
  const linkPath = items.find((i) => i.linkPath)?.linkPath ?? meta.path;
  const link = linkBaseUrl ? `\n\n${linkBaseUrl.replace(/\/+$/, "")}${linkPath}` : "";
  const title = titleOverride ?? meta.title(blocks.length);

  const messages: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    messages.push(`${title}\n\n${current.join("\n\n")}${link}`);
    current = [];
  };
  for (const b of blocks) {
    const candidate = `${title}\n\n${[...current, b.text].join("\n\n")}${link}`;
    if (current.length > 0 && candidate.length > MAX_SMS_CHARS) {
      flush();
    }
    current.push(b.text);
  }
  flush();
  return messages;
}

/* ------------------------------------------------------------------ queue */

async function enqueue(items: AlertItem[]): Promise<void> {
  if (items.length === 0) return;
  await supabaseAdmin.from("alert_queue").insert(
    items.map((i) => ({
      section: i.section,
      alert_type: i.alertType,
      vehicle_id: i.vehicleId ?? null,
      plate: i.plate ?? null,
      vehicle_label: i.vehicleLabel ?? null,
      headline: i.headline ?? null,
      detail: i.detail,
      sub_line: i.subLine ?? null,
      severity: i.severity ?? 0,
      link_path: i.linkPath ?? null,
    })),
  );
}

async function deliver(phone: string, messages: string[]): Promise<number> {
  let sent = 0;
  for (const m of messages) {
    await sendSms(phone, m, "Admin");
    sent++;
  }
  return sent;
}

export interface RaiseResult {
  ok: true;
  outcome: "sent" | "queued" | "skipped";
  reason?: string;
  count?: number;
}

/**
 * Single gate every admin-facing alert SMS must pass through.
 * 1) master switch, 2) section/toggle enabled, 3) quiet hours, 4) frequency.
 */
export async function raiseAlert(
  items: AlertItem | AlertItem[],
  opts?: { toggleKey?: string },
): Promise<RaiseResult> {
  const list = Array.isArray(items) ? items : [items];
  if (list.length === 0) return { ok: true, outcome: "skipped", reason: "empty" };
  const section = list[0]!.section;

  const [global, sectionCfg] = await Promise.all([
    getAlertGlobalConfig(),
    getAlertSectionConfig(section),
  ]);

  if (sectionCfg.frequency === "off") return { ok: true, outcome: "skipped", reason: "section_off" };
  if (opts?.toggleKey && sectionCfg.toggles[opts.toggleKey] === false) {
    return { ok: true, outcome: "skipped", reason: "type_off" };
  }
  if (!global.masterSmsEnabled || !sectionCfg.smsEnabled) {
    return { ok: true, outcome: "skipped", reason: "sms_disabled" };
  }
  if (sectionCfg.frequency !== "immediate") {
    await enqueue(list);
    return { ok: true, outcome: "queued", reason: "digest" };
  }
  if (inQuietHours(global)) {
    await enqueue(list);
    return { ok: true, outcome: "queued", reason: "quiet_hours" };
  }

  const messages = buildGroupedMessages(section, list, global.linkBaseUrl);
  const count = await deliver(global.adminPhone, messages);
  return { ok: true, outcome: "sent", count };
}

/** Send everything queued for a section as one grouped digest. */
export async function flushSectionQueue(
  section: AlertSection,
  opts?: { ignoreQuietHours?: boolean },
): Promise<RaiseResult> {
  const [global, sectionCfg] = await Promise.all([
    getAlertGlobalConfig(),
    getAlertSectionConfig(section),
  ]);
  if (!global.masterSmsEnabled || !sectionCfg.smsEnabled || sectionCfg.frequency === "off") {
    return { ok: true, outcome: "skipped", reason: "sms_disabled" };
  }
  if (!opts?.ignoreQuietHours && inQuietHours(global)) {
    return { ok: true, outcome: "skipped", reason: "quiet_hours" };
  }

  const { data } = await supabaseAdmin
    .from("alert_queue")
    .select("*")
    .eq("section", section)
    .is("sent_at", null)
    .order("severity", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { ok: true, outcome: "skipped", reason: "empty" };

  const items: AlertItem[] = rows.map((r) => ({
    section,
    alertType: String(r["alert_type"] ?? ""),
    vehicleId: (r["vehicle_id"] as string) ?? null,
    plate: (r["plate"] as string) ?? null,
    vehicleLabel: (r["vehicle_label"] as string) ?? null,
    headline: (r["headline"] as string) ?? null,
    detail: String(r["detail"] ?? ""),
    subLine: (r["sub_line"] as string) ?? null,
    severity: Number(r["severity"] ?? 0),
    linkPath: (r["link_path"] as string) ?? null,
  }));

  const messages = buildGroupedMessages(section, items, global.linkBaseUrl);
  const count = await deliver(global.adminPhone, messages);
  await supabaseAdmin
    .from("alert_queue")
    .update({ sent_at: new Date().toISOString() })
    .in("id", rows.map((r) => String(r["id"])));
  return { ok: true, outcome: "sent", count };
}

/** True when the section's digest is due at the current NY day/time (±10 min). */
export async function isDigestDue(section: AlertSection): Promise<boolean> {
  const cfg = await getAlertSectionConfig(section);
  if (cfg.frequency !== "daily" && cfg.frequency !== "weekly") return false;
  const target = toMinutes(cfg.sendTime ?? "08:00");
  if (target == null) return false;
  const now = nowMinutesNY();
  if (Math.abs(now - target) > 10) return false;
  if (cfg.frequency === "weekly") {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" })
      .format(new Date())
      .toLowerCase();
    if ((cfg.sendDay ?? "monday").toLowerCase() !== day) return false;
  }
  return true;
}

/**
 * Escape hatch for admin-only alerts that don't belong to one of the five
 * sections. Still respects the master switch and quiet hours.
 * Customer-facing SMS must NOT use this — it always sends via sendSms.
 */
export async function sendAdminSmsIfEnabled(message: string): Promise<boolean> {
  const global = await getAlertGlobalConfig();
  if (!global.masterSmsEnabled) return false;
  if (inQuietHours(global)) return false;
  await sendSms(global.adminPhone, message, "Admin");
  return true;
}

/**
 * Send a ready-made list of items as one grouped digest right now,
 * bypassing the queue (used by scheduled digest hooks).
 */
export async function sendSectionDigestNow(
  section: AlertSection,
  items: AlertItem[],
  titleOverride?: string,
): Promise<RaiseResult> {
  if (items.length === 0) return { ok: true, outcome: "skipped", reason: "empty" };
  const [global, cfg] = await Promise.all([getAlertGlobalConfig(), getAlertSectionConfig(section)]);
  if (!global.masterSmsEnabled || !cfg.smsEnabled || cfg.frequency === "off") {
    return { ok: true, outcome: "skipped", reason: "sms_disabled" };
  }
  if (inQuietHours(global)) return { ok: true, outcome: "skipped", reason: "quiet_hours" };
  const messages = buildGroupedMessages(section, items, global.linkBaseUrl, titleOverride);
  const count = await deliver(global.adminPhone, messages);
  return { ok: true, outcome: "sent", count };
}
