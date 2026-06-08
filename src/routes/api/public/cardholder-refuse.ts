import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

// Best-effort endpoint hit via navigator.sendBeacon when a cardholder closes
// the verification page without submitting. Marks the rental verification as
// refused so the admin sees a high-risk flag. Payment is never affected.
export const Route = createFileRoute("/api/public/cardholder-refuse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const rentalId = typeof body?.rentalId === "string" ? body.rentalId.slice(0, 64) : "";
          if (!rentalId) return Response.json({ ok: false });

          const { data: rental } = await sb()
            .from("rentals")
            .select("id, name_mismatch_flag, verification_status")
            .eq("id", rentalId)
            .maybeSingle();
          if (
            !rental ||
            rental.name_mismatch_flag !== true ||
            rental.verification_status === "submitted" ||
            rental.verification_status === "verified" ||
            rental.verification_status === "refused"
          ) {
            return Response.json({ ok: true });
          }
          await sb()
            .from("rentals")
            .update({ verification_status: "refused", updated_at: new Date().toISOString() })
            .eq("id", rentalId);
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[cardholder-refuse]", e);
          return Response.json({ ok: false });
        }
      },
    },
  },
});