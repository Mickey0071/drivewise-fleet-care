import { describe, it, expect } from "vitest";
import { rtoSummary, rtoSchedule, rtoIsOnRent } from "./rto";

const terms = { agreementDate: "2026-11-01", downPayment: 1500, weeklyAmount: 225, numPayments: 14, lateFeePerDay: 25 };

describe("rent to own", () => {
  it("only activated rent-to-own contracts appear on rent", () => {
    expect(rtoIsOnRent("active")).toBe(true);
    for (const status of ["draft", "sent", "signed", "completed", "cancelled"]) {
      expect(rtoIsOnRent(status)).toBe(false);
    }
  });
  it("contract total is $1,500 down + 14 x $225", () => {
    expect(rtoSummary(terms, [], "2026-11-01").balance).toBe(4650);
  });
  it("cash payments subtract from balance", () => {
    const s = rtoSummary(terms, [{ amount: 1500, lateFee: 0, paidAt: "2026-11-01" }, { amount: 225, lateFee: 0, paidAt: "2026-11-08" }], "2026-11-08");
    expect(s.balance).toBe(2925);
    expect(s.weeklyPaid).toBe(1);
  });
  it("late fees do not reduce the balance", () => {
    const s = rtoSummary(terms, [{ amount: 1550, lateFee: 50, paidAt: "2026-11-03" }], "2026-11-03");
    expect(s.balance).toBe(3150);
  });
  it("$25/day late and default after 4 days", () => {
    const s = rtoSummary(terms, [{ amount: 1500, lateFee: 0, paidAt: "2026-11-01" }], "2026-11-13");
    expect(s.daysLate).toBe(5);
    expect(s.lateFeeOwed).toBe(125);
    expect(s.inDefault).toBe(true);
  });
  it("schedule has down + 14 weekly rows", () => {
    const r = rtoSchedule(terms);
    expect(r.length).toBe(15);
    expect(r[14].due).toBe("2027-02-07");
  });
});
