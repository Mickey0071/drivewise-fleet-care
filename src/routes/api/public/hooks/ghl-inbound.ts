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

        // Marketing consent keywords + campaign reply tracking.
        const word = message.trim().toUpperCase().replace(/[^A-Z]/g, "");
        const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT"];
        const YES_WORDS = ["YES", "START", "UNSTOP", "OPTIN"];
        const now = new Date().toISOString();
        let consent: "opted_out" | "opted_in" | null = null;
        if (STOP_WORDS.includes(word)) consent = "opted_out";
        else if (YES_WORDS.includes(word)) consent = "opted_in";
        if (tail) {
          if (consent) {
            const patch = consent === "opted_out"
              ? { consent_status: "opted_out" as const, consent_at: now, consent_note: `Replied ${word} by text` }
              : { consent_status: "opted_in" as const, consent_source: "reply_YES" as const, consent_at: now, consent_note: `Replied ${word} by text` };
            const { data: drv } = await supabaseAdmin.from("drivers").select("id, phone").not("phone", "is", null).limit(5000);
            const dIds = (drv ?? []).filter((d) => digits(d.phone ?? "") === tail).map((d) => d.id);
            if (dIds.length) await supabaseAdmin.from("drivers").update(patch).in("id", dIds);
            const { data: wl } = await supabaseAdmin.from("waitlist_entries").select("id, phone").not("phone", "is", null).limit(5000);
            const wIds = (wl ?? []).filter((w) => digits(w.phone ?? "") === tail).map((w) => w.id);
            if (wIds.length) await supabaseAdmin.from("waitlist_entries").update(patch).in("id", wIds);
          }
          // Attribute the reply to the most recent campaign text to this number (last 14 days).
          const since = new Date(Date.now() - 14 * 86400000).toISOString();
          const { data: rec } = await supabaseAdmin
            .from("marketing_recipients")
            .select("id")
            .eq("normalized_phone", tail)
            .eq("status", "sent")
            .gte("sent_at", since)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (rec) {
            await supabaseAdmin
              .from("marketing_recipients")
              .update({ replied_at: now, ...(consent === "opted_out" ? { opted_out_at: now } : {}) })
              .eq("id", rec.id);
          }
        }

        return Response.json({ ok: true, matched: Boolean(driverId), consent });
      },
    },
  },
});