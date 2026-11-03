import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isReturningRentalEligible } from "./returning-renter";

export async function findSigningReturningRenter(driverId: string, currentRentalId: string) {
  const { data: driver, error: driverError } = await supabaseAdmin.from("drivers")
    .select("id, status, license_number, license_expiry").eq("id", driverId).maybeSingle();
  if (driverError) throw new Error("Could not check your saved verification. Please try again.");
  if (!driver) return null;
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: rentals, error } = await supabaseAdmin.from("rentals")
    .select("id, driver_id, start_date, end_date, reservation_status, staff_review_status, license_image_url, selfie_image_url, name_mismatch_flag")
    .eq("driver_id", driverId).neq("id", currentRentalId)
    .eq("staff_review_status", "reviewed")
    .or(`end_date.gte.${since},reservation_status.eq.active`)
    .order("end_date", { ascending: false });
  if (error) throw new Error("Could not check your saved verification. Please try again.");
  return (rentals ?? []).find((rental) => isReturningRentalEligible(driver, rental)) ?? null;
}