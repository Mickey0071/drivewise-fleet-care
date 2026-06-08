import { createFileRoute } from "@tanstack/react-router";
import { runBackup, retryPendingBackupEmails, previousMonthPeriod } from "@/lib/backups.server";

export const Route = createFileRoute("/api/public/hooks/monthly-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = request.headers.get("x-cron-secret");
        const apiKey = request.headers.get("apikey");
        const validCronSecret = !!cronSecret && cronSecret === process.env.CRON_SECRET;
        const validApiKey = !!apiKey && apiKey === process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!validCronSecret && !validApiKey) {
          return new Response("Unauthorized", { status: 401 });
        }

        let mode = "generate";
        try {
          const body = (await request.json()) as { mode?: string } | null;
          if (body?.mode) mode = body.mode;
        } catch {
          // no body — default to generate
        }

        if (mode === "retry") {
          const res = await retryPendingBackupEmails();
          return Response.json({ ok: true, mode, ...res });
        }

        const period = previousMonthPeriod();
        const result = await runBackup({ period, triggeredBy: "cron" });
        return Response.json({
          ok: result.ok,
          period: result.period,
          email_status: result.emailStatus,
          files: result.files.length,
          stats: result.stats,
          error: result.error,
        });
      },
    },
  },
});