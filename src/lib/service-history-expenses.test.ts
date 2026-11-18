import { describe, expect, it } from "vitest";
import { serviceHistoryExpenses } from "./service-history-expenses";
import type { Expense } from "./mock/data";

const expense = (fields: Partial<Expense>): Expense => ({ id: "E1", vehicleId: "V1", category: "Parts", amount: 125, date: "2026-11-18", ...fields });
describe("direct expenses in service history", () => {
  it("places existing repair expenses in repair history, not other expenses", () => {
    const result = serviceHistoryExpenses("V1", [expense({ category: "Repair & Maintenance" }), expense({ id: "E2", category: "Fuel", amount: 40 })], []);
    expect(result.repairRows.map(e => e.id)).toEqual(["E1"]);
    expect(result.repairTotal).toBe(125);
    expect(result.otherRows.map(e => e.id)).toEqual(["E2"]);
    expect(result.otherTotal).toBe(40);
  });
  it("includes a vehicle expense without any repair workflow", () => {
    const result = serviceHistoryExpenses("V1", [expense({})], []);
    expect(result.rows.map(e => e.id)).toEqual(["E1"]);
    expect(result.total).toBe(125);
  });
  it("excludes expenses belonging to another car", () => {
    expect(serviceHistoryExpenses("V1", [expense({ vehicleId: "V2" })], []).total).toBe(0);
  });
  it("does not duplicate a repair already printed in the report", () => {
    expect(serviceHistoryExpenses("V1", [expense({ maintenanceId: "M1" })], ["M1"]).rows).toEqual([]);
  });
  it("keeps expenses whose linked repair is not in the completed report", () => {
    expect(serviceHistoryExpenses("V1", [expense({ maintenanceId: "M1" })], []).total).toBe(125);
  });
  it("keeps EZPass and tolls out of service history", () => {
    expect(serviceHistoryExpenses("V1", [expense({ category: "EZPass" }), expense({ category: "Tolls" })], []).rows).toEqual([]);
  });
});