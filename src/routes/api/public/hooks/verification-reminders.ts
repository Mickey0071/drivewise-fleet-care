import { createFileRoute } from "@tanstack/react-router";

/**
 * RETIRED: automated cardholder verification reminder loops (1-hour follow-up
 * and daily reminders) have been replaced by in-app alerts plus a manual
 * admin-triggered verification link. The single initial mismatch SMS is still
 * sent once from the payment webhook. This endpoint is now a no-op so any
 * lingering pg_cron schedule does nothing.
 */
export const Route = createFileRoute("/api/public/hooks/verification-reminders")({
  server: {
    handlers: {
      POST: async () => Response.json({ ok: true, disabled: true }),
    },
  },
});
