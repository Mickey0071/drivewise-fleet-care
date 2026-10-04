import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type AudienceCustomer,
  type ConsentStatus,
  type LeadSource,
  mergeVars,
  renderTemplate,
  withStopFooter,
} from "@/lib/marketing-shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export function appOrigin() {
  return (process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app").replace(/\/$/, "");
}

export function digits10(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "").slice(-10);
}

/** Tracked-link token for a customer: drivers have a stored token; waitlist entries use "w" + uuid hex. */
export function trackingTokenFor(c: { id: string; kind: "driver" | "waitlist" }, driverToken?: string | null) {
  if (c.kind === "waitlist") return "w" + c.id.slice(3).replace(/-/g, "");
  return driverToken || "";
}

export function trackedLink(token: string, campaignId?: string | null) {
  if (!token) return `${appOrigin()}/waitlist`;
  return `${appOrigin()}/api/public/r/${token}${campaignId ? `?c=${campaignId}` : ""}`;
}

export async function resolveTrackingToken(token: string): Promise<string | null> {
  const t = token.trim();
  if (/^w[0-9a-f]{32}$/i.test(t)) {
    const h = t.slice(1);
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    return `wl:${uuid}`;
  }
  if (!/^[0-9a-f]{32}$/i.test(t)) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("marketing_token", t).maybeSingle();
  return data?.id ?? null;
}

/** When a visitor submits a form, tie their earlier visits on this device to the new customer. */
export async function linkVisitsToCustomer(visitorId: string | null | undefined, customerId: string, formName: string) {
  if (!visitorId) return;
  try {
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("form_visits")
      .update({ customer_id: customerId })
      .eq("visitor_id", visitorId)
      .is("customer_id", null);
    await supabaseAdmin
      .from("form_visits")
      .update({ submitted: true, submitted_at: now, customer_id: customerId })
      .eq("visitor_id", visitorId)
      .eq("form_name", formName)
      .eq("submitted", false);
  } catch (e) {
    console.error("[form-visit link]", e);
  }
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface AudienceRow extends AudienceCustomer {
  trackingToken: string;
}

/** Every customer (drivers + unconverted waitlist entries) with marketing attributes. */
export async function loadAudience(db: AnyClient): Promise<AudienceRow[]> {
  type D = {
    id: string; full_name: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null;
    created_at: string; lead_source: LeadSource | null; source_detail: string | null; consent_status: ConsentStatus;
    consent_note: string | null; consent_at: string | null; do_not_text: boolean; marketing_token: string | null;
  };
  type W = {
    id: string; name: string; phone: string | null; email: string | null; created_at: string; status: string | null;
    converted_rental_id: string | null; lead_source: LeadSource | null; source_detail: string | null; consent_status: ConsentStatus;
    consent_note: string | null; consent_at: string | null; do_not_text: boolean; normalized_phone: string | null;
  };
  const [drivers, waitlist, rentals, payments, vehicles, visits] = await Promise.all([
    fetchAll<D>((a, b) => db.from("drivers").select("id, full_name, first_name, last_name, phone, email, created_at, lead_source, source_detail, consent_status, consent_note, consent_at, do_not_text, marketing_token").range(a, b)),
    fetchAll<W>((a, b) => db.from("waitlist_entries").select("id, name, phone, email, created_at, status, converted_rental_id, lead_source, source_detail, consent_status, consent_note, consent_at, do_not_text, normalized_phone").range(a, b)),
    fetchAll<{ id: string; driver_id: string; vehicle_id: string; reservation_status: string | null; start_date: string | null }>((a, b) =>
      db.from("rentals").select("id, driver_id, vehicle_id, reservation_status, start_date").range(a, b)),
    fetchAll<{ driver_id: string | null; amount: number | null; status: string | null }>((a, b) =>
      db.from("payments").select("driver_id, amount, status").eq("status", "late").range(a, b)),
    fetchAll<{ id: string; make: string | null; model: string | null; year: number | null; plate: string | null }>((a, b) =>
      db.from("vehicles").select("id, make, model, year, plate").range(a, b)),
    fetchAll<{ customer_id: string | null; submitted: boolean }>((a, b) =>
      db.from("form_visits").select("customer_id, submitted").not("customer_id", "is", null).range(a, b)),
  ]);

  const vehById = new Map(vehicles.map((v) => [v.id, v]));
  const rentalsByDriver = new Map<string, typeof rentals>();
  for (const r of rentals) {
    const list = rentalsByDriver.get(r.driver_id) ?? [];
    list.push(r);
    rentalsByDriver.set(r.driver_id, list);
  }
  const balance = new Map<string, number>();
  for (const p of payments) if (p.driver_id) balance.set(p.driver_id, (balance.get(p.driver_id) ?? 0) + Number(p.amount ?? 0));
  const visitInfo = new Map<string, { visited: boolean; submitted: boolean }>();
  for (const v of visits) {
    const k = v.customer_id!;
    const cur = visitInfo.get(k) ?? { visited: false, submitted: false };
    cur.visited = true;
    if (v.submitted) cur.submitted = true;
    visitInfo.set(k, cur);
  }
  const waitlistPhones = new Set(waitlist.map((w) => digits10(w.normalized_phone || w.phone)).filter((p) => p.length === 10));

  const out: AudienceRow[] = [];
  for (const d of drivers) {
    const rs = (rentalsByDriver.get(d.id) ?? []).sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
    const active = rs.find((r) => (r.reservation_status ?? "active") === "active");
    const latest = active ?? rs[0];
    const veh = latest ? vehById.get(latest.vehicle_id) : undefined;
    const parts = (d.full_name || "").trim().split(/\s+/);
    const vi = visitInfo.get(d.id);
    out.push({
      id: d.id,
      kind: "driver",
      name: d.full_name || "",
      firstName: d.first_name || parts[0] || "",
      lastName: d.last_name || parts.slice(1).join(" "),
      phone: d.phone,
      email: d.email,
      createdAt: d.created_at,
      leadSource: d.lead_source ?? "manual_entry",
      sourceDetail: d.source_detail,
      consentStatus: d.consent_status ?? "unknown",
      consentNote: d.consent_note,
      consentAt: d.consent_at,
      doNotText: !!d.do_not_text,
      isCurrent: !!active,
      isPast: !active && rs.length > 0,
      isWaitlist: d.lead_source === "waitlist" || waitlistPhones.has(digits10(d.phone)),
      visitedForm: !!vi?.visited,
      visitedNotSubmitted: !!vi?.visited && !vi.submitted,
      vehicle: veh ? [veh.year, veh.make, veh.model].filter(Boolean).join(" ") : null,
      plate: veh?.plate ?? null,
      balanceDue: balance.get(d.id) ?? 0,
      trackingToken: d.marketing_token ?? "",
    });
  }
  const driverPhones = new Set(drivers.map((d) => digits10(d.phone)).filter((p) => p.length === 10));
  for (const w of waitlist) {
    if (w.converted_rental_id || (w.status ?? "").toLowerCase() === "converted") continue;
    const ph = digits10(w.normalized_phone || w.phone);
    if (ph.length === 10 && driverPhones.has(ph)) continue; // already a customer
    const id = `wl:${w.id}`;
    const parts = (w.name || "").trim().split(/\s+/);
    const vi = visitInfo.get(id);
    out.push({
      id,
      kind: "waitlist",
      name: w.name || "",
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" "),
      phone: w.phone,
      email: w.email,
      createdAt: w.created_at,
      leadSource: w.lead_source ?? "waitlist",
      sourceDetail: w.source_detail,
      consentStatus: w.consent_status ?? "unknown",
      consentNote: w.consent_note,
      consentAt: w.consent_at,
      doNotText: !!w.do_not_text,
      isCurrent: false,
      isPast: false,
      isWaitlist: true,
      visitedForm: !!vi?.visited,
      visitedNotSubmitted: !!vi?.visited && !vi.submitted,
      vehicle: null,
      plate: null,
      balanceDue: 0,
      trackingToken: trackingTokenFor({ id, kind: "waitlist" }),
    });
  }
  return out;
}

export function renderForCustomer(body: string, c: AudienceRow, campaignId?: string | null) {
  return withStopFooter(renderTemplate(body, mergeVars(c, trackedLink(c.trackingToken, campaignId))));
}

/** Update consent for a driver ("D…") or waitlist entry ("wl:<uuid>") by id. */
export async function setConsentById(
  db: AnyClient,
  customerId: string,
  patch: Record<string, unknown>,
) {
  if (customerId.startsWith("wl:")) {
    const { error } = await db.from("waitlist_entries").update(patch).eq("id", customerId.slice(3));
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("drivers").update(patch).eq("id", customerId);
    if (error) throw new Error(error.message);
  }
}

const SEND_GAP_MS = 1500; // ~40 texts/min keeps us well under carrier flagging thresholds
const BATCH_BUDGET_MS = 45000;

/** Send pending recipients for campaigns that are sending, throttled. Disarms the sender when drained. */
export async function processSendBatch(opts?: { campaignId?: string; budgetMs?: number }) {
  const { sendSms } = await import("@/lib/ghl.server");
  const started = Date.now();
  const budget = opts?.budgetMs ?? BATCH_BUDGET_MS;
  let sent = 0;
  let failed = 0;

  let q = supabaseAdmin.from("marketing_campaigns").select("id").eq("status", "sending").order("started_at", { ascending: true });
  if (opts?.campaignId) q = q.eq("id", opts.campaignId);
  const { data: campaigns } = await q;

  for (const camp of campaigns ?? []) {
    while (Date.now() - started < budget) {
      const { data: batch } = await supabaseAdmin
        .from("marketing_recipients")
        .select("id, phone, name, message")
        .eq("campaign_id", camp.id)
        .eq("status", "pending")
        .limit(10);
      if (!batch || batch.length === 0) {
        await supabaseAdmin.from("marketing_campaigns").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", camp.id);
        break;
      }
      for (const r of batch) {
        if (Date.now() - started >= budget) break;
        // claim the row so overlapping runs never double-send
        const { data: claimed } = await supabaseAdmin
          .from("marketing_recipients")
          .update({ status: "sending" })
          .eq("id", r.id)
          .eq("status", "pending")
          .select("id");
        if (!claimed || claimed.length === 0) continue;
        try {
          await sendSms(r.phone ?? "", r.message ?? "", r.name);
          await supabaseAdmin.from("marketing_recipients").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
          sent++;
        } catch (e) {
          await supabaseAdmin.from("marketing_recipients").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : String(e) }).eq("id", r.id);
          failed++;
        }
        await new Promise((res) => setTimeout(res, SEND_GAP_MS));
      }
    }
  }

  const { count } = await supabaseAdmin.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "sending");
  if (!count) await supabaseAdmin.rpc("marketing_disarm_sender" as never);
  return { sent, failed, stillSending: count ?? 0 };
}
