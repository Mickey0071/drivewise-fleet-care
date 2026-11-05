export interface CloseoutCosts {
  cost?: number;
  partsCost?: number;
  laborCost?: number;
  amountPaid?: number;
  lineItems?: { partsCost?: number; laborCost?: number }[];
}

/** Closing work does not mean paying it, and unallocated item costs never erase a ticket quote. */
export function repairCloseoutAmounts(ticket: CloseoutCosts, posted = 0) {
  const parts = Math.max(0, ticket.partsCost ?? 0);
  const labor = Math.max(0, ticket.laborCost ?? 0);
  const itemTotal = (ticket.lineItems ?? []).reduce((sum, item) => sum + (item.partsCost ?? 0) + (item.laborCost ?? 0), 0);
  const total = Math.max(0, ticket.cost ?? 0, parts + labor, itemTotal);
  const paid = Math.max(0, ticket.amountPaid ?? 0);
  return { parts, labor, total, paid, balance: Math.max(0, total - paid), remaining: Math.max(0, total - posted) };
}