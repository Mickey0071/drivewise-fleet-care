import { describe, expect, it } from "vitest";
import { isReturningRentalEligible, type ReturningDriver, type ReturningRental } from "./returning-renter";

const now = new Date("2026-11-03T15:24:00Z");
const driver: ReturningDriver = { id: "D1", status: "active", license_number: "ABC123", license_expiry: "2027-01-01" };
const rental: ReturningRental = { id: "R1", driver_id: "D1", start_date: "2026-08-01", end_date: "2026-08-05", reservation_status: "completed", staff_review_status: "reviewed", license_image_url: "saved-license", selfie_image_url: "saved-selfie", name_mismatch_flag: false };
describe("returning renter verification", () => {
  it("accepts approved documents from a recent rental", () => expect(isReturningRentalEligible(driver, rental, now)).toBe(true));
  it("accepts old rentals while license is valid", () => expect(isReturningRentalEligible(driver, { ...rental, start_date: "2024-01-01", end_date: "2024-01-05" }, now)).toBe(true));
  it("accepts an active rental already underway", () => expect(isReturningRentalEligible(driver, { ...rental, reservation_status: "active", end_date: "2026-11-10" }, now)).toBe(true));
  it("rejects expired licenses", () => expect(isReturningRentalEligible({ ...driver, license_expiry: "2026-11-02" }, rental, now)).toBe(false));
  it("rejects missing license details", () => expect(isReturningRentalEligible({ ...driver, license_expiry: null }, rental, now)).toBe(false));
  it.each(["blacklisted", "banned", "inactive", "flagged"])("rejects %s renters", (status) => expect(isReturningRentalEligible({ ...driver, status }, rental, now)).toBe(false));
  it("requires approved review", () => expect(isReturningRentalEligible(driver, { ...rental, staff_review_status: "pending" }, now)).toBe(false));
  it("requires both photos", () => expect(isReturningRentalEligible(driver, { ...rental, selfie_image_url: null }, now)).toBe(false));
  it("rejects mismatched ID", () => expect(isReturningRentalEligible(driver, { ...rental, name_mismatch_flag: true }, now)).toBe(false));
  it("cannot reuse another driver's documents", () => expect(isReturningRentalEligible(driver, { ...rental, driver_id: "D2" }, now)).toBe(false));
  it("rejects cancelled rentals", () => expect(isReturningRentalEligible(driver, { ...rental, reservation_status: "cancelled" }, now)).toBe(false));
  it("rejects future rentals", () => expect(isReturningRentalEligible(driver, { ...rental, start_date: "2026-11-04", reservation_status: "active" }, now)).toBe(false));
});