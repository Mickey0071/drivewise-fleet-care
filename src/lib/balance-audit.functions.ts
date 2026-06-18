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

      for (const r of rentals as any[]) {
        if (filter && r.id !== filter) continue;
        const rs = (r.reservation_status ?? "active") as string;

        const myPayments = payments.filter((p: any) => p.rental_id === r.id);
        const myReqs = extReqs.filter((e: any) => e.rental_id === r.id);
        const mySigned = extSigned.filter((e: any) => e.rental_id === r.id);
        const myViolations = violations.filter((v: any) => v.rental_id === r.id);

        // --- payments received (paid charge receipts) and credits ---
        const credits = myPayments
          .filter((p: any) => p.status === "paid" && p.kind === "credit")
          .reduce((s: number, p: any) => s + n(p.amount), 0);
        const payments_received = myPayments
          .filter((p: any) => p.status === "paid" && p.kind !== "credit")
          .reduce((s: number, p: any) => s + n(p.amount), 0);

        // --- unpaid charge rows (these already represent signed extensions
        //     because applying an extension inserts a payment row) ---
        const unpaid_charges = myPayments
          .filter((p: any) => p.status !== "paid" && p.kind !== "credit")
          .reduce((s: number, p: any) => s + n(p.amount), 0);

        // signed extension owed = signed but not yet represented by a paid row.
        // Captured inside unpaid_charges already; tracked separately for display.
        const signed_extension_owed = mySigned
          .filter((e: any) => {
            const pay = myPayments.find((p: any) => p.id === e.payment_id);
            return pay ? pay.status !== "paid" : false;
          })
          .reduce((s: number, e: any) => s + n(e.additional_amount), 0);

        // --- unpaid violations ---
        const violations_unpaid = myViolations
          .filter((v: any) => {
            if (v.paid_at) return false;
            const st = String(v.status ?? "").toLowerCase();
            return !UNPAID_VIOLATION_EXCLUDE.has(st);
          })
          .reduce((s: number, v: any) => s + (n(v.total_amount) || n(v.amount)), 0);

        // --- phantom: sent-but-unsigned extension requests the legacy calc
        //     was counting via includePending. They have no payment row and no
        //     signature. Dedup by new_end_date, and drop periods already
        //     covered by a signed/accepted extension. ---
        const coveredEnds = new Set<string>([
          ...mySigned.map((e: any) => e.new_end_date),
          ...myReqs
            .filter((e: any) => {
              const st = String(e.status ?? "").toLowerCase();
              return st === "signed" || st === "paid" || e.signed_at || e.rental_extension_id;
            })
            .map((e: any) => e.new_end_date),
        ]);
        const now = Date.now();
        const phantomByEnd = new Map<string, number>();
        for (const e of myReqs) {
          const st = String(e.status ?? "").toLowerCase();
          if (st !== "pending") continue;
          if (e.signed_at || e.rental_extension_id || e.payment_id) continue;
          if (e.expires_at && new Date(e.expires_at).getTime() <= now) continue;
          if (coveredEnds.has(e.new_end_date)) continue;
          const key = e.new_end_date ?? e.id;
          phantomByEnd.set(key, Math.max(phantomByEnd.get(key) ?? 0, n(e.additional_amount)));
        }
        const phantom_sent_extension =
          rs === "active"
            ? Array.from(phantomByEnd.values()).reduce((s, v) => s + v, 0)
            : 0;

        // --- bloated base rows: paid/owed charge rows materially above the
        //     period rate that are NOT linked to an extension. ---
        const extPayIds = new Set<string>([
          ...mySigned.map((e: any) => e.payment_id).filter(Boolean),
          ...myReqs.map((e: any) => e.payment_id).filter(Boolean),
        ]);
        const periodRate = n(r.rate) || n(r.weekly_rate);
        const bloated_rows: BloatedRow[] = [];
        if (periodRate > 0) {
          for (const p of myPayments) {
            if (p.kind === "credit") continue;
            if (extPayIds.has(p.id)) continue;
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
        // NEW canonical rule (period-based, signature-agnostic):
        //   balance = base_rental(original term) + extension time the car is
        //             actually out (counted ONCE per period, deduped across
        //             re-sent links) − payments received.
        // Violations are NEVER part of the rental balance — reported separately
        // in `violations_unpaid` only.
        // `phantom_sent_extension` is the deduped, per-period extension amount
        // the car is out for (sent links count even before signature); periods
        // already represented by a signed/paid payment row are excluded above
        // to avoid double counting.
        const canonical_balance = unpaid_charges + phantom_sent_extension - credits;
        // OLD shown balance under the prior signed-only rule (which also folded
        // unpaid violations into the balance).
        const old_balance = unpaid_charges + violations_unpaid - credits;
        const delta = canonical_balance - old_balance;

        const reasons: string[] = [];
        if (phantom_sent_extension > 0)
          reasons.push(
            `Adds $${phantom_sent_extension.toFixed(2)} extension time the car is out (counted once per period — re-sent links deduped).`,
          );
        if (violations_unpaid > 0)
          reasons.push(
            `Removes $${violations_unpaid.toFixed(2)} violation(s) from the rental balance (now tracked on a separate line).`,
          );
        if (bloated_rows.length)
          reasons.push(
            `${bloated_rows.length} charge row(s) above the $${periodRate.toFixed(2)} rate — base may include extension days (needs split/review).`,
          );

        let verdict: BalanceVerdict = "ok";
        const flags = [
          phantom_sent_extension > 0 ? "phantom_extension" : null,
          violations_unpaid > 0 && Math.abs(delta) > 0.005 ? "missing_violation" : null,
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
          unpaid_charges,
          signed_extension_owed,
          violations_unpaid,
          credits,
          payments_received,
          phantom_sent_extension,
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
