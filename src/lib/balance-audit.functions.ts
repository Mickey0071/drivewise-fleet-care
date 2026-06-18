import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Balance audit — REPORT-ONLY.
 *
 * Computes, for every reservation, the current (legacy) balance vs the
 * canonical balance defined by the one rule we apply everywhere:
 *
 *   Balance due = base_rental(original term only)
 *               + extension time the car is actually out
 *                 (counted ONCE per period, signature NOT required,
 *                  re-sent links for the same period deduped)
 *               - cash_payments_received
 *
 *   Violations are NEVER part of the rental balance — they are reported on a
 *   separate line (violations_unpaid) and tracked independently.
 *
 * This function NEVER writes anything. Corrections are applied one-by-one
 * from the /admin/payment-reconciliation screen and routed through the
 * audited admin RPCs (admin_correct_payment_amount / admin_delete_payment),
 * so every stored change lands in payment_audit_log.
 */

export type BalanceVerdict =
  | "ok"
  | "phantom_extension"
  | "missing_violation"
  | "bloated_base"
  | "multi";

export type BloatedRow = {
  payment_id: string;
  amount: number;
  expected: number;
  due_date: string | null;
};

export type BalanceAuditLine = {
  rental_id: string;
  renter_name: string;
  status: string;
  /** components of the canonical balance */
  base_rental: number;
  signed_extensions: number;
  unsigned_accrual: number;
  /** sum of ALL payments received (base + extension + any other), excl. credits */
  total_payments: number;
  /** payments that the buggy legacy calc counted (base-rental only) */
  base_payments: number;
  violations_unpaid: number;
  credits: number;
  old_balance: number;
  canonical_balance: number;
  delta: number;
  verdict: BalanceVerdict;
  reasons: string[];
  bloated_rows: BloatedRow[];
};

export type BalanceAuditResult =
  | { lines: BalanceAuditLine[]; changed: number; checked: number }
  | { error: string };

function n(v: unknown): number {
  return Number(v ?? 0) || 0;
}

const UNPAID_VIOLATION_EXCLUDE = new Set([
  "paid",
  "dismissed",
  "waived",
  "cancelled",
  "canceled",
  "resolved",
  "closed",
  "refunded",
]);

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error("Authorization check failed");
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

export const auditBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId?: string; onlyChanged?: boolean } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<BalanceAuditResult> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [rRes, pRes, erRes, reRes, vRes, dRes] = await Promise.all([
        supabaseAdmin.from("rentals").select(
          "id, driver_id, start_date, end_date, billing_period, rate, weekly_rate, reservation_status, returned_at",
        ),
        supabaseAdmin.from("payments").select(
          "id, rental_id, amount, due_date, paid_date, status, kind, note",
        ),
        supabaseAdmin.from("extension_requests").select(
          "id, rental_id, status, additional_amount, new_end_date, signed_at, paid_at, rental_extension_id, payment_id, expires_at",
        ),
        supabaseAdmin.from("rental_extensions").select(
          "id, rental_id, additional_amount, new_end_date, payment_id, signature_data_url",
        ),
        supabaseAdmin.from("violations").select(
          "id, rental_id, amount, total_amount, status, paid_at",
        ),
        supabaseAdmin.from("drivers").select("id, full_name"),
      ]);

      const firstErr = [rRes, pRes, erRes, reRes, vRes, dRes].find((x) => x.error);
      if (firstErr?.error) throw new Error(firstErr.error.message);

      const rentals = rRes.data ?? [];
      const payments = pRes.data ?? [];
      const extReqs = erRes.data ?? [];
      const extSigned = reRes.data ?? [];
      const violations = vRes.data ?? [];
      const drivers = dRes.data ?? [];

      const driverName = new Map<string, string>(
        drivers.map((d: any) => [d.id, d.full_name ?? ""]),
      );

      const filter = data.rentalId?.trim();
      const lines: BalanceAuditLine[] = [];

      const todayStr = new Date().toISOString().slice(0, 10);
      const dayMs = 86400000;
      const periodsBetween = (fromISO: string, toISO: string, weekly: boolean): number => {
        const a = new Date(fromISO + "T00:00:00Z").getTime();
        const b = new Date(toISO + "T00:00:00Z").getTime();
        const days = Math.round((b - a) / dayMs);
        if (days <= 0) return 0;
        return weekly ? Math.ceil(days / 7) : days;
      };

      for (const r of rentals as any[]) {
        if (filter && r.id !== filter) continue;
        const rs = (r.reservation_status ?? "active") as string;

        const myPayments = payments.filter((p: any) => p.rental_id === r.id);
        const myReqs = extReqs.filter((e: any) => e.rental_id === r.id);
        const mySigned = extSigned.filter((e: any) => e.rental_id === r.id);
        const myViolations = violations.filter((v: any) => v.rental_id === r.id);

        // --- discounts (credit rows) ---
        const credits = myPayments
          .filter((p: any) => p.status === "paid" && p.kind === "credit")
          .reduce((s: number, p: any) => s + n(p.amount), 0);

        // --- extension payment rows (linked to a signed/paid extension) ---
        // Used both to (a) exclude these charges from base_rental and (b) count
        // them in total_payments — the legacy bug was that extension payments
        // were never subtracted from the balance.
        const extPayIdsAll = new Set<string>([
          ...mySigned.map((e: any) => e.payment_id).filter(Boolean),
          ...myReqs
            .filter((e: any) => {
              const st = String(e.status ?? "").toLowerCase();
              return st === "signed" || st === "paid" || e.signed_at || e.rental_extension_id;
            })
            .map((e: any) => e.payment_id)
            .filter(Boolean),
        ]);
        const isExtensionCharge = (p: any) =>
          extPayIdsAll.has(p.id) || /extension/i.test(String(p.note ?? ""));

        // --- signed extensions (real charges), deduped by the period they
        //     cover (new_end_date). Sent-but-unsigned links count for nothing. ---
        const signedByEnd = new Map<string, number>();
        for (const e of mySigned) {
          const key = e.new_end_date ?? e.id;
          signedByEnd.set(key, Math.max(signedByEnd.get(key) ?? 0, n(e.additional_amount)));
        }
        for (const e of myReqs) {
          const st = String(e.status ?? "").toLowerCase();
          const isSigned = st === "signed" || st === "paid" || e.signed_at || e.rental_extension_id;
          if (!isSigned) continue;
          const key = e.new_end_date ?? e.id;
          signedByEnd.set(key, Math.max(signedByEnd.get(key) ?? 0, n(e.additional_amount)));
        }
        const signed_extensions = Array.from(signedByEnd.values()).reduce((s, v) => s + v, 0);
        const signedEnds = Array.from(signedByEnd.keys());

        // --- base rental (original term only): every non-credit charge that is
        //     NOT an extension charge, regardless of paid status. ---
        const base_rental = myPayments
          .filter((p: any) => p.kind !== "credit" && !isExtensionCharge(p))
          .reduce((s: number, p: any) => s + n(p.amount), 0);

        // --- total payments received: ALL paid non-credit rows (base +
        //     extension + anything else). This is the bug fix. ---
        const paidRows = myPayments.filter((p: any) => p.status === "paid" && p.kind !== "credit");
        const total_payments = paidRows.reduce((s: number, p: any) => s + n(p.amount), 0);
        // legacy buggy payments figure: base-rental payments only (extensions ignored)
        const base_payments = paidRows
          .filter((p: any) => !isExtensionCharge(p))
          .reduce((s: number, p: any) => s + n(p.amount), 0);

        // --- unpaid violations ---
        const violations_unpaid = myViolations
          .filter((v: any) => {
            if (v.paid_at) return false;
            const st = String(v.status ?? "").toLowerCase();
            return !UNPAID_VIOLATION_EXCLUDE.has(st);
          })
          .reduce((s: number, v: any) => s + (n(v.total_amount) || n(v.amount)), 0);

        // --- unsigned out accrual: car still out past everything it has paid
        //     for. Accrues per day (daily plan) or per week (weekly plan) from
        //     the covered-through date to today. Stops once the car is returned. ---
        const weekly = String(r.billing_period ?? "").toLowerCase() === "weekly";
        const periodRate = weekly ? (n(r.weekly_rate) || n(r.rate)) : (n(r.rate) || n(r.weekly_rate));
        let unsigned_accrual = 0;
        const isOut = rs !== "returned" && rs !== "completed" && rs !== "pending" && !r.returned_at;
        if (isOut && periodRate > 0) {
          // covered-through date = the latest of the original end date and any
          // signed extension's new end date. If there is no end date, fall back
          // to start_date + (base_rental / rate) periods.
          let coveredEnd = (r.end_date as string) || "";
          if (!coveredEnd && r.start_date) {
            const used = periodRate > 0 ? Math.floor(base_rental / periodRate) : 0;
            const startMs = new Date(r.start_date + "T00:00:00Z").getTime();
            coveredEnd = new Date(startMs + used * (weekly ? 7 : 1) * dayMs)
              .toISOString()
              .slice(0, 10);
          }
          for (const end of signedEnds) {
            if (typeof end === "string" && end > coveredEnd) coveredEnd = end;
          }
          if (coveredEnd && todayStr > coveredEnd) {
            unsigned_accrual = periodsBetween(coveredEnd, todayStr, weekly) * periodRate;
          }
        }

        // --- bloated base rows: paid/owed charge rows materially above the
        //     period rate that are NOT linked to an extension. ---
        const bloated_rows: BloatedRow[] = [];
        if (periodRate > 0) {
          for (const p of myPayments) {
            if (p.kind === "credit") continue;
            if (extPayIdsAll.has(p.id)) continue;
            if (/extension/i.test(String((p as any).note ?? ""))) continue;
            if (n(p.amount) > periodRate + 0.5) {
              bloated_rows.push({
                payment_id: p.id,
                amount: n(p.amount),
                expected: periodRate,
                due_date: p.due_date ?? null,
              });
            }
          }
        }

        // --- balances ---
        // CANONICAL RULE:
        //   balance = base_rental(original term)
        //           + signed_extensions (deduped per period)
        //           + unsigned_out_accrual (per day/week the car is still out)
        //           − total_payments (EVERY payment type)
        //           − credits (discounts)
        // Violations are NEVER part of the rental balance.
        const canonical_balance =
          base_rental + signed_extensions + unsigned_accrual - total_payments - credits;
        // LEGACY (buggy) balance: identical, but only subtracts base-rental
        // payments — extension payments were ignored.
        const old_balance =
          base_rental + signed_extensions + unsigned_accrual - base_payments - credits;
        const delta = canonical_balance - old_balance;

        const extension_payments = total_payments - base_payments;
        const reasons: string[] = [];
        if (extension_payments > 0.005)
          reasons.push(
            `Subtracts $${extension_payments.toFixed(2)} of extension/other payments that the old balance ignored.`,
          );
        if (unsigned_accrual > 0)
          reasons.push(
            `Adds $${unsigned_accrual.toFixed(2)} accrual — car still out past covered date (${weekly ? "per week" : "per day"}).`,
          );
        if (violations_unpaid > 0)
          reasons.push(
            `$${violations_unpaid.toFixed(2)} violation(s) tracked on a separate line (never in the balance).`,
          );
        if (bloated_rows.length)
          reasons.push(
            `${bloated_rows.length} charge row(s) above the $${periodRate.toFixed(2)} rate — base may include extension days (needs split/review).`,
          );

        let verdict: BalanceVerdict = "ok";
        const flags = [
          extension_payments > 0.005 && Math.abs(delta) > 0.005 ? "phantom_extension" : null,
          violations_unpaid > 0 ? "missing_violation" : null,
          bloated_rows.length ? "bloated_base" : null,
        ].filter(Boolean) as BalanceVerdict[];
        if (flags.length === 1) verdict = flags[0];
        else if (flags.length > 1) verdict = "multi";

        const changed = Math.abs(delta) > 0.005 || bloated_rows.length > 0;
        if (data.onlyChanged && !changed) continue;

        lines.push({
          rental_id: r.id,
          renter_name: driverName.get(r.driver_id) ?? "",
          status: rs,
          base_rental,
          signed_extensions,
          unsigned_accrual,
          total_payments,
          base_payments,
          violations_unpaid,
          credits,
          old_balance,
          canonical_balance,
          delta,
          verdict,
          reasons,
          bloated_rows,
        });
      }

      lines.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.rental_id.localeCompare(b.rental_id, undefined, { numeric: true }));
      const changedCount = lines.filter((l) => Math.abs(l.delta) > 0.005 || l.bloated_rows.length > 0).length;
      return { lines, changed: changedCount, checked: lines.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Balance audit failed" };
    }
  });
