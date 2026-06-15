import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface PlateReviewRow {
  id: string;
  renter_name: string | null;
  vehicle: string | null;
  year: number | null;
  color: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
}

/** List legacy rentals flagged for plate review (the ambiguous 2015 Malibus). */
export const listPlateReviewRentals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PlateReviewRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, vehicle, year, color, start_datetime, end_datetime")
      .eq("plate_needs_review", true)
      .order("start_datetime", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlateReviewRow[];
  });

/** Assign a chosen plate to a flagged legacy rental and clear the review flag. */
export const resolvePlateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        plate: z.enum(["N90VCG", "MVP8071"]),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const color = data.plate === "N90VCG" ? "Red" : "Blue";
    const { error } = await supabaseAdmin
      .from("legacy_rentals")
      .update({
        plate: data.plate,
        color,
        plate_needs_review: false,
        plate_inferred_from_vehicle: true,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
