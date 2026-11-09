import type { RtoTerms, RtoPaymentLite } from "@/lib/rto";

export type RtoRow = Record<string, any> & {
  id: string; customer_name: string; status: string; staff_seen: boolean;
  terms: RtoTerms; payments: (RtoPaymentLite & { id: string; method: string; note: string | null })[];
};

/** Load contracts with payments (admin RLS applies). */
export async function loadRtoContracts(supabase: any): Promise<RtoRow[]> {
  const [{ data: cs, error }, { data: ps, error: paymentError }] = await Promise.all([
    supabase.from("rto_contracts").select("*").order("created_at", { ascending: false }),
    supabase.from("rto_payments").select("*").order("paid_at"),
  ]);
  if (error) throw error;
  if (paymentError) throw paymentError;
  return (cs ?? []).map((c: any) => ({
    ...c,
    terms: {
      agreementDate: c.agreement_date, firstDueDate: c.first_due_date,
      downPayment: Number(c.down_payment), weeklyAmount: Number(c.weekly_amount),
      numPayments: Number(c.num_payments), lateFeePerDay: Number(c.late_fee_per_day),
    },
    payments: (ps ?? []).filter((p: any) => p.contract_id === c.id).map((p: any) => ({
      id: p.id, amount: Number(p.amount), lateFee: Number(p.late_fee), paidAt: p.paid_at, method: p.method, note: p.note,
    })),
  }));
}
