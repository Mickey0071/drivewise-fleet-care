import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface MigratedReservation {
  id: string;
  source: string | null;
  order_number: string | null;
  vehicle: string | null;
  year: string | null;
  color: string | null;
  plate: string | null;
  renter_name: string | null;
  pickup_location: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
}

export const listMigratedReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MigratedReservation[]> => {
    const { data, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, source, order_number, vehicle, year, color, plate, renter_name, pickup_location, start_datetime, end_datetime, status, notes, created_at",
      )
      .order("start_datetime", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as MigratedReservation[];
  });

type CreateInput = {
  renter_name: string;
  plate?: string | null;
  vehicle?: string | null;
  year?: string | null;
  color?: string | null;
  order_number?: string | null;
  pickup_location?: string | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
  status?: string | null;
  notes?: string | null;
};

export const createMigratedReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateInput) => {
    const renter = (input.renter_name || "").trim();
    if (!renter) throw new Error("Renter name is required");
    const clean = (v?: string | null) => {
      const s = (v ?? "").toString().trim();
      return s === "" ? null : s;
    };
    return {
      source: "migrated",
      renter_name: renter,
      plate: clean(input.plate),
      vehicle: clean(input.vehicle),
      year: clean(input.year),
      color: clean(input.color),
      order_number: clean(input.order_number),
      pickup_location: clean(input.pickup_location),
      start_datetime: clean(input.start_datetime),
      end_datetime: clean(input.end_datetime),
      status: clean(input.status) ?? "migrated",
      notes: clean(input.notes),
    };
  })
  .handler(async ({ data }): Promise<MigratedReservation> => {
    const { data: row, error } = await supabaseAdmin
      .from("legacy_rentals")
      .insert(data as never)
      .select(
        "id, source, order_number, vehicle, year, color, plate, renter_name, pickup_location, start_datetime, end_datetime, status, notes, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return row as MigratedReservation;
  });

export const deleteMigratedReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = (input.id || "").trim();
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("legacy_rentals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });