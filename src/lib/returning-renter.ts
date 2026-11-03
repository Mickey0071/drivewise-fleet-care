export const RETURNING_RENTER_DAYS = 90;

export type ReturningDriver = { id: string; status: string | null; license_number: string | null; license_expiry: string | null };
export type ReturningRental = {
  id: string; driver_id: string; start_date: string; end_date: string | null;
  reservation_status: string | null; staff_review_status: string | null;
  license_image_url: string | null; selfie_image_url: string | null;
  name_mismatch_flag: boolean;
};

/** Reuse only this driver's reviewed documents from a real, recent rental. */
export function isReturningRentalEligible(driver: ReturningDriver, rental: ReturningRental, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  if (["blacklisted", "banned", "inactive", "flagged"].includes((driver.status ?? "").toLowerCase())) return false;
  if (!driver.license_number?.trim() || !driver.license_expiry || !/^\d{4}-\d{2}-\d{2}$/.test(driver.license_expiry)) return false;
  if (!Number.isFinite(Date.parse(driver.license_expiry)) || driver.license_expiry < today) return false;
  if (rental.driver_id !== driver.id || rental.name_mismatch_flag) return false;
  if (rental.staff_review_status !== "reviewed" || !rental.license_image_url || !rental.selfie_image_url) return false;
  if (!["active", "completed", "returned"].includes(rental.reservation_status ?? "")) return false;
  const start = Date.parse(rental.start_date);
  if (!Number.isFinite(start) || rental.start_date.slice(0, 10) > today) return false;
  const lastDay = rental.reservation_status === "active" ? today : rental.end_date?.slice(0, 10);
  if (!lastDay || lastDay > today || lastDay < rental.start_date.slice(0, 10)) return false;
  const elapsed = Date.parse(today) - Date.parse(lastDay);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= RETURNING_RENTER_DAYS * 86400000;
}