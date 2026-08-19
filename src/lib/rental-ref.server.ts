import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface RentalRef {
  rental_id: string | null;
  legacy_rental_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Violations.rental_id has a FK to rentals(id). Matchers can hand us a
 * legacy_rentals UUID (migrated reservation) which would blow up that FK.
 * This resolves any incoming reference into the correct pair of columns:
 *  - live rental              -> { rental_id, legacy_rental_id: null }
 *  - promoted legacy rental   -> { rental_id: promoted_rental_id, legacy_rental_id }
 *  - unpromoted legacy rental -> { rental_id: null, legacy_rental_id }
 *  - unknown id               -> { null, null }
 */
export async function resolveRentalRef(raw: string | null | undefined): Promise<RentalRef> {
  const id = (raw ?? "").trim().replace(/^LEGACY:/i, "");
  if (!id) return { rental_id: null, legacy_rental_id: null };

  if (UUID_RE.test(id)) {
    const { data: lr } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, promoted_rental_id")
      .eq("id", id)
      .maybeSingle();
    if (lr) {
      const promoted = (lr as { promoted_rental_id?: string | null }).promoted_rental_id ?? null;
      if (promoted) {
        const { data: r } = await supabaseAdmin
          .from("rentals")
          .select("id")
          .eq("id", promoted)
          .maybeSingle();
        if (r) return { rental_id: promoted, legacy_rental_id: id };
      }
      return { rental_id: null, legacy_rental_id: id };
    }
  }

  const { data: r } = await supabaseAdmin
    .from("rentals")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return { rental_id: r ? id : null, legacy_rental_id: null };
}
