import { createFileRoute } from "@tanstack/react-router";

/** Throttled marketing SMS sender. Only scheduled while a campaign is sending. */
export const Route = createFileRoute("/api/public/hooks/marketing-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = request.headers.get("x-cron-secret");
        const apiKey = request.headers.get("apikey");
        const valid =
          (!!cronSecret && cronSecret === process.env.CRON_SECRET) ||
          (!!apiKey && apiKey === process.env.SUPABASE_PUBLISHABLE_KEY);
        if (!valid) return new Response("Unauthorized", { status: 401 });
        const { processSendBatch } = await import("@/lib/marketing.server");
        const res = await processSendBatch();
        return Response.json({ ok: true, ...res });
      },
    },
  },
});
