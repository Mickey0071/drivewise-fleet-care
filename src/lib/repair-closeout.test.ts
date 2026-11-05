import { describe, expect, it } from "vitest";
import { repairCloseoutAmounts } from "./repair-closeout";

describe("repair close-out", () => {
  it("retains the $950 ticket when all five completed item costs are zero", () => {
    expect(repairCloseoutAmounts({ cost: 950, lineItems: Array.from({ length: 5 }, () => ({ partsCost: 0, laborCost: 0 })) }).total).toBe(950);
  });
  it("closing an unpaid $22 repair does not mark it paid", () => {
    const result = repairCloseoutAmounts({ cost: 22, amountPaid: 0 });
    expect(result.paid).toBe(0);
    expect(result.balance).toBe(22);
  });
  it("does not repost an already expensed $125 repair", () => {
    expect(repairCloseoutAmounts({ cost: 125 }, 125).remaining).toBe(0);
  });
  it("posts only the unrecorded portion", () => {
    expect(repairCloseoutAmounts({ cost: 2850, amountPaid: 1000 }, 1000).remaining).toBe(1850);
  });
});