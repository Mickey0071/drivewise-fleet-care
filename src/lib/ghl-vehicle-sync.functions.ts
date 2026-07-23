import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Client-callable wrapper around the server-only GHL vehicle sync engine.
 * Used from UI paths that mutate vehicle status directly (e.g. Edit Vehicle
 * dialog), which do not otherwise pass through a server function.
 */
export const syncVehicleAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleId: string }) => {
    if (!d?.vehicleId) throw new Error("vehicleId required");
    return { vehicleId: d.vehicleId };
  })
  .handler(async ({ data }) => {
    const { syncVehicleAvailabilityToGhl } = await import(
      "@/lib/ghl-vehicle-sync.server"
    );
    return syncVehicleAvailabilityToGhl(data.vehicleId);
  });