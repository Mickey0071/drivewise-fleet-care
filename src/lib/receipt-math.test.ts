import { describe, it, expect } from "vitest";
import { computeReceiptTotals, NJ_SALES_TAX_RATE } from "./receipt-math";

describe("receipt totals", () => {
  it("default rate is NJ 6.625%", () => {
    expect(NJ_SALES_TAX_RATE).toBe(6.625);
  });
  it("taxes $400 rental at 6.625% = $26.50", () => {
    const t = computeReceiptTotals([{ description: "Rental", quantity: 1, unitPrice: 400, taxable: true }], 6.625);
    expect(t.tax).toBe(26.5);
    expect(t.total).toBe(426.5);
  });
  it("does not tax non-taxable deposit", () => {
    const t = computeReceiptTotals(
      [
        { description: "Rental", quantity: 1, unitPrice: 400, taxable: true },
        { description: "Deposit", quantity: 1, unitPrice: 250, taxable: false },
      ],
      6.625,
      500,
    );
    expect(t.tax).toBe(26.5);
    expect(t.total).toBe(676.5);
    expect(t.balance).toBe(176.5);
  });
});
