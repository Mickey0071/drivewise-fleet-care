import { createFileRoute } from "@tanstack/react-router";

function digits(v: string) {
  return (v || "").replace(/\D/g, "").slice(-10);
}

/**
 * GHL inbound-SMS webhook. Configure the workflow to POST here with header
 * `x-webhook-secret: <CRON_SECRET>` and a JSON body containing the contact
 * phone plus the message body.
 */
export const Route = createFileRoute("/api/public/hooks/ghl-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const provided =
          request.headers.get("x-webhook-secret") ?? new URL(request.url).searchParams.get("secret");
        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const phone = String(payload["phone"] ?? payload["from"] ?? payload["contact_phone"] ?? "");
        const message = String(payload["message"] ?? payload["body"] ?? "");
        const ghlId = payload["messageId"] ?? payload["message_id"] ?? payload["id"];
        if (!phone || !message.trim()) {
          return new Response("phone and message required", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tail = digits(phone);
        let driverId: string | null = null;
        if (tail) {
          const { data } = await supabaseAdmin
            .from("drivers")
            .select("id, phone")
            .not("phone", "is", null)
            .limit(1000);
          driverId = (data ?? []).find((d) => digits(d.phone ?? "") === tail)?.id ?? null;
        }

        const { error } = await supabaseAdmin.from("renter_messages").upsert(
          {
            driver_id: driverId,
            phone,
            message: message.trim(),
            direction: "received",
            read: false,
            sent_at: new Date().toISOString(),
            ghl_message_id: ghlId ? String(ghlId) : null,
          },
          { onConflict: "ghl_message_id", ignoreDuplicates: true },
        );
        if (error) return new Response(error.message, { status: 500 });

        return Response.json({ ok: true, matched: Boolean(driverId) });
      },
    },
  },
});