import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const visitSchema = z.object({
  formName: z.string().min(1).max(80),
  visitorId: z.string().min(8).max(80),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmContent: z.string().max(200).optional().nullable(),
  utmTerm: z.string().max(200).optional().nullable(),
  referrer: z.string().max(1000).optional().nullable(),
  pageUrl: z.string().max(1000).optional().nullable(),
  trackingToken: z.string().max(80).optional().nullable(),
  campaignId: z.string().uuid().optional().nullable(),
});

/** Public: log that someone opened an online form. Customer is resolved from a tracked-link token. */
export const recordFormVisit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => visitSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveTrackingToken } = await import("@/lib/marketing.server");
    const customerId = data.trackingToken ? await resolveTrackingToken(data.trackingToken) : null;
    const { error } = await supabaseAdmin.from("form_visits").insert({
      form_name: data.formName,
      visitor_id: data.visitorId,
      utm_source: data.utmSource ?? null,
      utm_medium: data.utmMedium ?? null,
      utm_campaign: data.utmCampaign ?? null,
      utm_content: data.utmContent ?? null,
      utm_term: data.utmTerm ?? null,
      referrer: data.referrer ?? null,
      page_url: data.pageUrl ?? null,
      tracking_token: data.trackingToken ?? null,
      campaign_id: data.campaignId ?? null,
      customer_id: customerId,
    });
    if (error) console.error("[form-visit]", error.message);
    return { ok: true };
  });
