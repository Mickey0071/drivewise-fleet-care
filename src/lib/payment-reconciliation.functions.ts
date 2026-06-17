import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

function stripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; raw?: { message?: string } };
    return e.raw?.message ?? e.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}

/**
 * Payment reconciliation — REPORT-ONLY by default.
 *
 * `reconcilePayments` pulls payment rows from the database, calls the real
 * Stripe API for each charge, and returns a discrepancy table. It NEVER edits
 * or deletes anything.
 *
 * To actually apply a correction you must call `applyPaymentCorrection`, which
 * requires an explicit reason and routes the change through the admin RPCs that
 * record every change in `payment_audit_log`.
 */

type PaymentRow = {
  id: string;
  rental_id: string;
  amount: number;
  status: string;
  paid_date: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
};

export type ReconLine = {
  payment_id: string;
  rental_id: string;
  row_amount: number;
  row_status: string;
  paid_date: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_amount: number | null;
  stripe_status: string | null;
  stripe_refunded: number | null;
  /** ok | mismatch | no_charge_id | charge_not_found | error */
  verdict: "ok" | "mismatch" | "no_charge_id" | "charge_not_found" | "error";
  detail: string;
};

export type ReconResult =
  | { lines: ReconLine[]; checked: number; mismatches: number; environment: StripeEnv }
  | { error: string };

function activeEnv(): StripeEnv {
  return process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error("Authorization check failed");
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

export const reconcilePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rentalId?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<ReconResult> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const env = activeEnv();
      const stripe = createStripeClient(env);

      let query = supabaseAdmin
        .from("payments")
        .select("id, rental_id, amount, status, paid_date, stripe_charge_id, stripe_payment_intent_id")
        .order("rental_id", { ascending: true });
      if (data.rentalId) query = query.eq("rental_id", data.rentalId);

      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);

      const lines: ReconLine[] = [];
      for (const r of (rows ?? []) as PaymentRow[]) {
        const base = {
          payment_id: r.id,
          rental_id: r.rental_id,
          row_amount: Number(r.amount),
          row_status: r.status,
          paid_date: r.paid_date,
          stripe_charge_id: r.stripe_charge_id,
          stripe_payment_intent_id: r.stripe_payment_intent_id,
          stripe_amount: null as number | null,
          stripe_status: null as string | null,
          stripe_refunded: null as number | null,
        };

        const chargeId = r.stripe_charge_id;
        if (!chargeId) {
          lines.push({ ...base, verdict: "no_charge_id", detail: "Row has no Stripe charge id — cannot verify against Stripe." });
          continue;
        }

        try {
          const charge = await stripe.charges.retrieve(chargeId);
          const stripeAmount = (charge.amount ?? 0) / 100;
          const refunded = (charge.amount_refunded ?? 0) / 100;
          const match = Math.abs(stripeAmount - Number(r.amount)) < 0.005;
          lines.push({
            ...base,
            stripe_amount: stripeAmount,
            stripe_status: charge.status ?? null,
            stripe_refunded: refunded,
            verdict: match ? "ok" : "mismatch",
            detail: match
              ? "Row amount matches the real Stripe charge."
              : `Row is $${Number(r.amount).toFixed(2)} but Stripe charge is $${stripeAmount.toFixed(2)}.`,
          });
        } catch (err) {
          const msg = stripeErrorMessage(err);
          const notFound = /no such charge|resource_missing/i.test(msg);
          lines.push({
            ...base,
            verdict: notFound ? "charge_not_found" : "error",
            detail: notFound ? `No Stripe charge found for ${chargeId}.` : msg,
          });
        }
      }

      const mismatches = lines.filter((l) => l.verdict !== "ok").length;
      return { lines, checked: lines.length, mismatches, environment: env };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Reconciliation failed" };
    }
  });

export type ApplyResult = { ok: true } | { error: string };

export const applyPaymentCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { paymentId: string; action: "set_amount" | "delete"; newAmount?: number; reason: string }) => {
      if (!data?.paymentId) throw new Error("paymentId is required");
      if (data.action !== "set_amount" && data.action !== "delete") throw new Error("Invalid action");
      if (!data.reason || !data.reason.trim()) throw new Error("A reason is required");
      if (data.action === "set_amount" && (typeof data.newAmount !== "number" || data.newAmount < 0)) {
        throw new Error("A valid newAmount is required");
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<ApplyResult> => {
    try {
      await assertAdmin(context);
      // Route through the SECURITY DEFINER RPCs so the audit trigger records the
      // before/after values plus the reason. Use the user-scoped client so
      // auth.uid() (the acting admin) is captured on the audit row.
      if (data.action === "set_amount") {
        const { error } = await context.supabase.rpc("admin_correct_payment_amount", {
          _payment_id: data.paymentId,
          _new_amount: data.newAmount ?? 0,
          _reason: data.reason.trim(),
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await context.supabase.rpc("admin_delete_payment", {
          _payment_id: data.paymentId,
          _reason: data.reason.trim(),
        });
        if (error) throw new Error(error.message);
      }
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Correction failed" };
    }
  });