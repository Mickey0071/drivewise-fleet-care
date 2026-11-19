import { describe, expect, it } from "vitest";
import { needsOffRoadDiagnosis } from "./off-road-queue";

describe("top off-road diagnosis queue", () => {
  it("keeps a car awaiting its mechanic diagnosis", () => {
    expect(needsOffRoadDiagnosis({ id: "repair-1", status: "diagnosing", dateCompleted: "" }, new Set())).toBe(true);
  });
  it("removes a submitted mechanic diagnosis even before staff accepts it", () => {
    expect(needsOffRoadDiagnosis({ id: "repair-1", status: "diagnosing", dateCompleted: "" }, new Set(["repair-1"]))).toBe(false);
  });
  it("removes a saved staff diagnosis", () => {
    expect(needsOffRoadDiagnosis({ id: "repair-1", status: "diagnosing", dateCompleted: "", diagnosisTitle: "Replace alternator" }, new Set())).toBe(false);
  });
  it("does not return diagnosed repairs awaiting completion to the top", () => {
    expect(needsOffRoadDiagnosis({ id: "repair-1", status: "pending_complete", dateCompleted: "" }, new Set())).toBe(false);
  });
  it("retains a vehicle with a separate undiagnosed repair", () => {
    const submitted = new Set(["repair-1"]);
    expect([
      { id: "repair-1", status: "diagnosing" as const, dateCompleted: "" },
      { id: "repair-2", status: "reported" as const, dateCompleted: "" },
    ].some(repair => needsOffRoadDiagnosis(repair, submitted))).toBe(true);
  });
  it("excludes completed repairs", () => {
    expect(needsOffRoadDiagnosis({ id: "repair-1", status: "complete", dateCompleted: "2026-11-18" }, new Set())).toBe(false);
  });
});