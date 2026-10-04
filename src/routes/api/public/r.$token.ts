import { createFileRoute } from "@tanstack/react-router";

/** Tracked customer link from a marketing text: records the click, then opens the form tied to that customer. */
export const Route = createFileRoute("/api/public/r/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const token = (params.token || "").slice(0, 40);
        const c = url.searchParams.get("c");
        const campaignId = c && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
        const { appOrigin, resolveTrackingToken } = await import("@/lib/marketing.server");
        try {
          const customerId = await resolveTrackingToken(token);
          if (customerId && campaignId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin
              .from("marketing_recipients")
              .update({ clicked_at: new Date().toISOString() })
              .eq("campaign_id", campaignId)
              .eq("customer_id", customerId)
              .is("clicked_at", null);
          }
        } catch (e) {
          console.error("[tracked-link]", e);
        }
        const dest = new URL(`${appOrigin()}/waitlist`);
        if (/^[0-9a-z]{32,33}$/i.test(token)) dest.searchParams.set("mt", token);
        if (campaignId) dest.searchParams.set("c", campaignId);
        dest.searchParams.set("utm_source", "sms");
        dest.searchParams.set("utm_medium", "text");
        return new Response(null, { status: 302, headers: { Location: dest.toString() } });
      },
    },
  },
});
