import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasPhone, isExcluded } from "@/lib/marketing-shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error || data !== true) throw new Error("Admins only");
}

export const getMarketingAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { loadAudience } = await import("@/lib/marketing.server");
    const rows = await loadAudience(context.supabase);
    return { customers: rows.map(({ trackingToken: _t, ...c }) => c) };
  });

const consentSchema = z.object({
  customerId: z.string().min(1).max(80),
  status: z.enum(["unknown", "opted_in", "opted_out"]),
  note: z.string().max(500).optional().nullable(),
  doNotText: z.boolean().optional(),
});

export const setCustomerConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => consentSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { setConsentById } = await import("@/lib/marketing.server");
    const patch: Record<string, unknown> = {
      consent_status: data.status,
      consent_note: data.note?.trim() || null,
      consent_at: data.status === "unknown" ? null : new Date().toISOString(),
      consent_source: data.status === "opted_in" ? "manual_note" : null,
    };
    if (data.doNotText !== undefined) patch.do_not_text = data.doNotText;
    await setConsentById(context.supabase, data.customerId, patch);
    return { ok: true };
  });

/* ---------- Segments ---------- */
export const listSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("marketing_segments").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      filters: z.record(z.string(), z.unknown()),
      customerIds: z.array(z.string().max(80)).max(20000),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const row = { name: data.name, filters: data.filters as never, customer_ids: data.customerIds as never, created_by: context.userId };
    const res = data.id
      ? await context.supabase.from("marketing_segments").update(row).eq("id", data.id)
      : await context.supabase.from("marketing_segments").insert(row);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const deleteSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("marketing_segments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Templates ---------- */
export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("marketing_templates").select("*").order("category").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      category: z.string().min(1).max(60),
      channel: z.enum(["sms", "email"]),
      subject: z.string().max(200).optional().nullable(),
      body: z.string().min(1).max(5000),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const row = { name: data.name, category: data.category, channel: data.channel, subject: data.subject ?? null, body: data.body };
    const res = data.id
      ? await context.supabase.from("marketing_templates").update(row).eq("id", data.id)
      : await context.supabase.from("marketing_templates").insert(row);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("marketing_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Sending ---------- */
export const sendTestText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ phone: z.string().min(7).max(40), body: z.string().min(1).max(1600), sampleCustomerId: z.string().max(80).optional().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { loadAudience, renderForCustomer } = await import("@/lib/marketing.server");
    const { renderTemplate, withStopFooter, COMPANY_NAME } = await import("@/lib/marketing-shared");
    let msg: string;
    const all = data.sampleCustomerId ? await loadAudience(context.supabase) : [];
    const sample = all.find((c) => c.id === data.sampleCustomerId);
    if (sample) msg = renderForCustomer(data.body, sample);
    else msg = withStopFooter(renderTemplate(data.body, { first_name: "Test", last_name: "Customer", vehicle: "2018 Toyota Camry", plate: "ABC1234", balance_due: "$0.00", company_name: COMPANY_NAME, link: "https://camautorentals.lovable.app/waitlist" }));
    const { sendSms } = await import("@/lib/ghl.server");
    await sendSms(data.phone, `TEST: ${msg}`, "Admin");
    return { ok: true };
  });

const createSchema = z.object({
  channel: z.literal("sms"),
  body: z.string().min(1).max(1600),
  audienceLabel: z.string().max(200),
  customerIds: z.array(z.string().max(80)).min(1).max(20000),
  scheduleAt: z.string().datetime().optional().nullable(),
});

/** Summary shown on the confirmation screen. */
export const previewCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createSchema.omit({ scheduleAt: true, channel: true, body: true }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { loadAudience } = await import("@/lib/marketing.server");
    const ids = new Set(data.customerIds);
    const picked = (await loadAudience(context.supabase)).filter((c) => ids.has(c.id));
    const sendable = picked.filter((c) => hasPhone(c) && !isExcluded(c));
    return {
      total: sendable.length,
      unknownConsent: sendable.filter((c) => c.consentStatus === "unknown").length,
      skippedOptedOut: picked.filter((c) => isExcluded(c)).length,
      skippedNoPhone: picked.filter((c) => !hasPhone(c) && !isExcluded(c)).length,
    };
  });

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { loadAudience, renderForCustomer, digits10 } = await import("@/lib/marketing.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = new Set(data.customerIds);
    const picked = (await loadAudience(context.supabase)).filter((c) => ids.has(c.id) && hasPhone(c));
    // de-dupe by phone
    const seen = new Set<string>();
    const unique = picked.filter((c) => {
      const p = digits10(c.phone);
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    const sendable = unique.filter((c) => !isExcluded(c));
    const skipped = unique.filter((c) => isExcluded(c));
    if (sendable.length === 0) throw new Error("No one left to text after skipping opted-out numbers.");

    const scheduleAt = data.scheduleAt ? new Date(data.scheduleAt) : null;
    if (scheduleAt && scheduleAt.getTime() < Date.now() - 60000) throw new Error("Scheduled time is in the past");
    const status = scheduleAt && scheduleAt.getTime() > Date.now() + 60000 ? "scheduled" : "sending";

    const { data: camp, error } = await context.supabase
      .from("marketing_campaigns")
      .insert({
        channel: "sms",
        audience_label: data.audienceLabel,
        body: data.body,
        status,
        scheduled_at: scheduleAt ? scheduleAt.toISOString() : null,
        started_at: status === "sending" ? new Date().toISOString() : null,
        total_recipients: sendable.length,
        unknown_consent_count: sendable.filter((c) => c.consentStatus === "unknown").length,
        skipped_count: skipped.length,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !camp) throw new Error(error?.message ?? "Could not create campaign");

    const rows = [
      ...sendable.map((c) => ({
        campaign_id: camp.id, customer_id: c.id, name: c.name, phone: c.phone, normalized_phone: digits10(c.phone),
        consent_status: c.consentStatus, message: renderForCustomer(data.body, c, camp.id), status: "pending",
      })),
      ...skipped.map((c) => ({
        campaign_id: camp.id, customer_id: c.id, name: c.name, phone: c.phone, normalized_phone: digits10(c.phone),
        consent_status: c.consentStatus, message: null, status: "skipped", error: "Opted out / do not text",
      })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error: rErr } = await context.supabase.from("marketing_recipients").insert(rows.slice(i, i + 500));
      if (rErr) throw new Error(rErr.message);
    }

    if (status === "scheduled") {
      const { error: sErr } = await supabaseAdmin.rpc("marketing_schedule_campaign" as never, { _id: camp.id, _at: scheduleAt!.toISOString() } as never);
      if (sErr) throw new Error(sErr.message);
    } else {
      const { error: aErr } = await supabaseAdmin.rpc("marketing_arm_sender" as never);
      if (aErr) console.error("[marketing arm]", aErr.message);
    }
    return { id: camp.id as string, status, total: sendable.length, skipped: skipped.length };
  });

/** Sends the next throttled batch right away (the background sender continues after). */
export const kickCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { processSendBatch } = await import("@/lib/marketing.server");
    return processSendBatch({ campaignId: data.id, budgetMs: 20000 });
  });

export const cancelCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("marketing_unschedule_campaign" as never, { _id: data.id } as never);
    await context.supabase.from("marketing_campaigns").update({ status: "cancelled" }).eq("id", data.id).in("status", ["scheduled", "sending"]);
    await context.supabase.from("marketing_recipients").update({ status: "cancelled" }).eq("campaign_id", data.id).eq("status", "pending");
    return { ok: true };
  });

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: camps, error } = await context.supabase
      .from("marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const ids = (camps ?? []).map((c) => c.id);
    const stats = new Map<string, { sent: number; failed: number; pending: number; clicks: number; replies: number; optOuts: number }>();
    if (ids.length) {
      for (let from = 0; ; from += 1000) {
        const { data: recs } = await context.supabase
          .from("marketing_recipients").select("campaign_id, status, clicked_at, replied_at, opted_out_at")
          .in("campaign_id", ids).range(from, from + 999);
        for (const r of recs ?? []) {
          const s = stats.get(r.campaign_id) ?? { sent: 0, failed: 0, pending: 0, clicks: 0, replies: 0, optOuts: 0 };
          if (r.status === "sent") s.sent++;
          else if (r.status === "failed") s.failed++;
          else if (r.status === "pending" || r.status === "sending") s.pending++;
          if (r.clicked_at) s.clicks++;
          if (r.replied_at) s.replies++;
          if (r.opted_out_at) s.optOuts++;
          stats.set(r.campaign_id, s);
        }
        if (!recs || recs.length < 1000) break;
      }
    }
    return (camps ?? []).map((c) => ({ ...c, stats: stats.get(c.id) ?? { sent: 0, failed: 0, pending: 0, clicks: 0, replies: 0, optOuts: 0 } }));
  });

export const getCampaignRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("marketing_recipients")
      .select("id, customer_id, name, phone, consent_status, status, error, sent_at, clicked_at, replied_at, opted_out_at, message")
      .eq("campaign_id", data.id).order("name").limit(5000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
