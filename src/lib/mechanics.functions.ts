import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SavedMechanic {
  id: string;
  name: string;
  phone: string;
  shop: string | null;
  isActive: boolean;
}

/** List saved mechanics (active first, alphabetical). */
export const listMechanics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedMechanic[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("mechanics")
      .select("id, name, phone, shop, is_active")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      shop: r.shop ?? null,
      isActive: !!r.is_active,
    }));
  });

/** Add or update a saved mechanic. Pass `id` to update. */
export const saveMechanic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; phone: string; shop?: string; isActive?: boolean }) => {
    const name = String(d?.name ?? "").trim();
    if (!name || name.length > 120) throw new Error("Mechanic name is required");
    const phone = String(d?.phone ?? "").trim();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid mechanic phone number");
    const shop = String(d?.shop ?? "").trim().slice(0, 200) || null;
    return {
      id: d?.id ? String(d.id) : undefined,
      name,
      phone,
      shop,
      isActive: d?.isActive !== false,
    };
  })
  .handler(async ({ data, context }): Promise<SavedMechanic> => {
    const { supabase } = context;
    const payload = { name: data.name, phone: data.phone, shop: data.shop, is_active: data.isActive };
    const q = data.id
      ? supabase.from("mechanics").update(payload).eq("id", data.id).select("id, name, phone, shop, is_active").single()
      : supabase.from("mechanics").insert(payload).select("id, name, phone, shop, is_active").single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return { id: row.id, name: row.name, phone: row.phone, shop: row.shop ?? null, isActive: !!row.is_active };
  });

/** Delete a saved mechanic. */
export const deleteMechanic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id) throw new Error("Invalid mechanic id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("mechanics").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Set (or clear) a vehicle's preferred mechanic. */
export const setPreferredMechanic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string; mechanicId: string | null }) => {
    const vehicleId = String(d?.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("vehicleId required");
    return { vehicleId, mechanicId: d?.mechanicId ? String(d.mechanicId) : null };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("vehicles")
      .update({ preferred_mechanic_id: data.mechanicId })
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });