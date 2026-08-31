import { createFileRoute } from "@tanstack/react-router";
import { flushSectionQueue, isDigestDue, type AlertSection } from "@/lib/alerts.server";

const SECTIONS: AlertSection[] = ["maintenance", "repairs", "violations", "payments", "runner_tasks"];

/**
 * Runs every 15 minutes. For each section, sends the queued grouped alerts
 * when that section's digest time has arrived (and quiet hours are over).
 */
export const Route = createFileRoute("/api/public/hooks/alert-flush")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = request.headers.get("x-cron-secret");
        const apiKey = request.headers.get("apikey");
        const valid =
          (!!cronSecret && cronSecret === process.env.CRON_SECRET) ||
          (!!apiKey && apiKey === process.env.SUPABASE_PUBLISHABLE_KEY);
        if (!valid) return new Response("Unauthorized", { status: 401 });

        const results: Record<string, string> = {};
        for (const section of SECTIONS) {
          if (!(await isDigestDue(section))) {
            results[section] = "not_due";
            continue;
          }
          const res = await flushSectionQueue(section);
          results[section] = res.outcome === "sent" ? `sent:${res.count}` : (res.reason ?? "skipped");
        }
        return Response.json({ ok: true, results });
      },
    },
  },
});
