/** Rent-to-own money rules. Pure — shared by admin page, print view and tests. */
export interface RtoTerms {
  agreementDate: string; // YYYY-MM-DD
  firstDueDate?: string | null;
  downPayment: number;
  weeklyAmount: number;
  numPayments: number;
  lateFeePerDay: number;
}
export interface RtoPaymentLite { amount: number; lateFee: number; paidAt: string }

export function rtoIsOnRent(status: string): boolean {
  return status === "active";
}

function addDays(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

/** Row 0 = down payment, rows 1..n = weekly payments every 7 days. */
export function rtoSchedule(t: RtoTerms) {
  const first = t.firstDueDate || addDays(t.agreementDate, 7);
  const rows = [{ no: 0, label: "Down", amount: t.downPayment, due: t.agreementDate }];
  for (let i = 1; i <= t.numPayments; i++) rows.push({ no: i, label: String(i), amount: t.weeklyAmount, due: addDays(first, 7 * (i - 1)) });
  return rows;
}

export function rtoSummary(t: RtoTerms, payments: RtoPaymentLite[], today = new Date().toISOString().slice(0, 10)) {
  const contractTotal = t.downPayment + t.weeklyAmount * t.numPayments;
  const lateFeesPaid = payments.reduce((s, p) => s + Number(p.lateFee || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Late fees are taken first; the rest goes toward the contract.
  const principalPaid = Math.max(0, totalPaid - lateFeesPaid);
  const balance = Math.max(0, Math.round((contractTotal - principalPaid) * 100) / 100);
  const afterDown = principalPaid - t.downPayment;
  const weeklyPaid = afterDown <= 0 ? 0 : Math.min(t.numPayments, Math.floor((afterDown + 0.001) / t.weeklyAmount));
  const downPaid = principalPaid >= t.downPayment;
  const schedule = rtoSchedule(t);
  const next = balance <= 0 ? null : schedule[downPaid ? weeklyPaid + 1 : 0] ?? null;
  const daysLate = next ? Math.max(0, daysBetween(next.due, today)) : 0;
  return {
    contractTotal, totalPaid, lateFeesPaid, principalPaid, balance,
    downPaid, weeklyPaid, remaining: t.numPayments - weeklyPaid,
    next, daysLate, lateFeeOwed: daysLate * t.lateFeePerDay,
    inDefault: daysLate > 4, paidOff: balance <= 0,
  };
}
