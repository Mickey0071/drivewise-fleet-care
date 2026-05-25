import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Lightweight feed of agreements awaiting staff review. Admin/runner/VA only.
 *  Returns only non-sensitive labels so it's safe to poll frequently. */
export const getPendingAgreementAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: any) => r.role as string);
    const allowed = roles.some((r) => r === "admin" || r === "runner" || r === "va");
    if (!allowed) return { items: [] as Array<{ rentalId: string; driverName: string; vehicleLabel: string; signedAt: string | null }> };

    const { data: rentals, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, client_signed_at, signed_at, staff_review_status")
      .eq("staff_review_status", "pending")
      .order("client_signed_at", { ascending: false })
      .limit(50);
    if (error || !rentals?.length) return { items: [] };

    const driverIds = Array.from(new Set(rentals.map((r) => r.driver_id).filter(Boolean)));
    const vehicleIds = Array.from(new Set(rentals.map((r) => r.vehicle_id).filter(Boolean)));
    const [{ data: drivers }, { data: vehicles }] = await Promise.all([
      driverIds.length
        ? supabaseAdmin.from("drivers").select("id, full_name, first_name, last_name").in("id", driverIds)
        : Promise.resolve({ data: [] as any[] }),
      vehicleIds.length
        ? supabaseAdmin.from("vehicles").select("id, year, make, model, plate").in("id", vehicleIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const dMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
    const vMap = new Map((vehicles ?? []).map((v: any) => [v.id, v]));

    const items = rentals.map((r) => {
      const d: any = dMap.get(r.driver_id);
      const v: any = vMap.get(r.vehicle_id);
      const driverName = d?.full_name
        || [d?.first_name, d?.last_name].filter(Boolean).join(" ")
        || r.driver_id;
      const vehicleLabel = v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}${v.plate ? ` · ${v.plate}` : ""}`.trim() : r.vehicle_id;
      return {
        rentalId: r.id,
        driverName,
        vehicleLabel,
        signedAt: (r.client_signed_at ?? r.signed_at ?? null) as string | null,
      };
    });
    return { items };
  });