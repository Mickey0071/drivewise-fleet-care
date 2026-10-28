export const NJ_SALES_TAX_RATE = 6.625;

export interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeReceiptTotals(items: ReceiptItem[], taxRatePct: number, amountPaid = 0) {
  let subtotal = 0;
  let taxableBase = 0;
  for (const it of items) {
    const line = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    subtotal += line;
    if (it.taxable) taxableBase += line;
  }
  const tax = r2((taxableBase * (Number(taxRatePct) || 0)) / 100);
  const total = r2(subtotal + tax);
  return { subtotal: r2(subtotal), taxableBase: r2(taxableBase), tax, total, balance: r2(total - (Number(amountPaid) || 0)) };
}
