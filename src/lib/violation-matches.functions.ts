import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface ViolationMatchRow {
  id: string;
  violation_id: string;
  reservation_id: string;
  override_start_date: string | null;
  override_end_date: string | null;
  created_at: string;
}

export interface ReservationMatchStat {
  reservationId: string;
  count: number;
  violationIds: string[];
  lastOverrideStart: string | null;
  lastOverrideEnd: string | null;
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

/** Record (or update) which reservation a violation was matched to. */
export const saveViolationMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1),
        reservationId: z.string().min(1),
        overrideStartDate: dateStr,
        overrideEndDate: dateStr,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("violation_matches").upsert(
      {
        violation_id: data.violationId,
        reservation_id: data.reservationId,
        override_start_date: data.overrideStartDate || null,
        override_end_date: data.overrideEndDate || null,
        created_by: context.userId ?? null,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "violation_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cached matches grouped by reservation, so the UI can badge reused rentals. */
export const listReservationMatchStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReservationMatchStat[]> => {
    const { data, error } = await context.supabase
      .from("violation_matches")
      .select("violation_id, reservation_id, override_start_date, override_end_date, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const map = new Map<string, ReservationMatchStat>();
    for (const row of data ?? []) {
      const key = row.reservation_id as string;
      let stat = map.get(key);
      if (!stat) {
        stat = {
          reservationId: key,
          count: 0,
          violationIds: [],
          lastOverrideStart: (row.override_start_date as string | null) ?? null,
          lastOverrideEnd: (row.override_end_date as string | null) ?? null,
        };
        map.set(key, stat);
      }
      stat.count += 1;
      stat.violationIds.push(row.violation_id as string);
    }
    return Array.from(map.values());
  });

/** The cached match (if any) for a single violation. */
export const getViolationMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ violationId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<ViolationMatchRow | null> => {
    const { data: row, error } = await context.supabase
      .from("violation_matches")
      .select("id, violation_id, reservation_id, override_start_date, override_end_date, created_at")
      .eq("violation_id", data.violationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as ViolationMatchRow | null) ?? null;
  });
