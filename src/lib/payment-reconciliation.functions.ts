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

/* ===========================================================================
 * Stripe charge IMPORT — pulls succeeded Stripe charges that were never
 * written back into the `payments` table and records them against the
 * correct reservation. This fixes false "late"/balance-due flags caused by
 * one-time checkout/payment-link charges that did not sync.
 *
 * Dry-run by default: returns exactly what WOULD be inserted, what is already
 * recorded, likely cash duplicates, and charges that could not be matched to
 * a reservation. Pass commit:true to perform the inserts (idempotent —
 * dedupes strictly on stripe_charge_id).
 * ======================================================================== */

type DriverRow = { id: string; full_name: string | null; email: string | null };
type RentalWindow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  returned_at: string | null;
  stripe_customer_id: string | null;
};

export type ImportChargeLine = {
  charge_id: string;
  payment_intent_id: string | null;
  amount: number;
  charge_date: string; // YYYY-MM-DD
  rental_id: string | null;
  driver_id: string;
  /** inserted | would_insert | already_recorded | possible_cash_duplicate | unmatched */
  status:
    | "inserted"
    | "would_insert"
    | "already_recorded"
    | "possible_cash_duplicate"
    | "unmatched";
  detail: string;
};

export type ImportResult =
  | {
      lines: ImportChargeLine[];
      drivers_scanned: number;
      charges_found: number;
      inserted: number;
      would_insert: number;
      already_recorded: number;
      possible_duplicates: number;
      unmatched: number;
      committed: boolean;
      environment: StripeEnv;
    }
  | { error: string };

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.abs(
    Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000),
  );
}

/** Match a charge date to the reservation whose [start, end] window contains it. */
function matchRental(rentals: RentalWindow[], chargeDate: string, today: string): RentalWindow | null {
  const candidates = rentals.filter((r) => {
    if (!r.start_date) return false;
    const start = r.start_date.slice(0, 10);
    const end = (r.returned_at ?? r.end_date ?? today).slice(0, 10);
    return chargeDate >= start && chargeDate <= end;
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // Prefer the one whose start is closest to (and before) the charge date.
    return candidates.sort((a, b) =>
      daysApart(chargeDate, a.start_date!.slice(0, 10)) - daysApart(chargeDate, b.start_date!.slice(0, 10)),
    )[0];
  }
  return null;
}

type PaymentInsert = {
  id: string;
  rental_id: string;
  driver_id: string;
  amount: number;
  kind: string;
  status: string;
  method: string;
  due_date: string;
  paid_date: string;
  stripe_charge_id: string;
  stripe_payment_intent_id: string | null;
};

export const importStripeCharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { driverId?: string; allDrivers?: boolean; commit?: boolean } | undefined) => {
      const d = data ?? {};
      if (!d.driverId && !d.allDrivers) {
        throw new Error("Provide a driverId or set allDrivers");
      }
      return d;
    },
  )
  .handler(async ({ data, context }): Promise<ImportResult> => {
    try {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const env = activeEnv();
      const stripe = createStripeClient(env);
      const today = new Date().toISOString().slice(0, 10);

      // 1. Resolve the set of drivers to process.
      let driverQuery = supabaseAdmin.from("drivers").select("id, full_name, email");
      if (data.driverId) driverQuery = driverQuery.eq("id", data.driverId);
      const { data: driverRows, error: dErr } = await driverQuery;
      if (dErr) throw new Error(dErr.message);
      const drivers = (driverRows ?? []) as DriverRow[];
      if (drivers.length === 0) throw new Error("No matching drivers found");

      const lines: ImportChargeLine[] = [];
      let chargesFound = 0;
      const toInsert: PaymentInsert[] = [];

      for (const driver of drivers) {
        // 2. Driver's reservations (matching windows).
        const { data: rentalRows } = await supabaseAdmin
          .from("rentals")
          .select("id, start_date, end_date, returned_at, stripe_customer_id")
          .eq("driver_id", driver.id);
        const rentals = (rentalRows ?? []) as RentalWindow[];
        if (rentals.length === 0) continue;

        // 3. Existing payments for those rentals (for dedupe).
        const rentalIds = rentals.map((r) => r.id);
        const { data: existingRows } = await supabaseAdmin
          .from("payments")
          .select("rental_id, amount, status, method, paid_date, due_date, stripe_charge_id")
          .in("rental_id", rentalIds);
        const existing = existingRows ?? [];
        const recordedChargeIds = new Set(
          existing.map((p: any) => p.stripe_charge_id).filter(Boolean),
        );

        // 4. Resolve Stripe customer ids: every customer under the email, plus
        //    any customer id already stamped on a reservation.
        const customerIds = new Set<string>();
        for (const r of rentals) if (r.stripe_customer_id) customerIds.add(r.stripe_customer_id);
        if (driver.email) {
          const custList = await stripe.customers.list({ email: driver.email.toLowerCase(), limit: 100 });
          for (const c of custList.data) customerIds.add(c.id);
          // Stripe stores emails case-sensitively in some flows — also try raw.
          if (driver.email !== driver.email.toLowerCase()) {
            const raw = await stripe.customers.list({ email: driver.email, limit: 100 });
            for (const c of raw.data) customerIds.add(c.id);
          }
        }
        if (customerIds.size === 0) continue;

        // 5. Collect succeeded, non-refunded charges across all customers.
        const seenCharges = new Set<string>();
        for (const customerId of customerIds) {
          const charges = await stripe.charges.list({ customer: customerId, limit: 100 });
          for (const ch of charges.data) {
            if (seenCharges.has(ch.id)) continue;
            seenCharges.add(ch.id);
            if (ch.status !== "succeeded" || !ch.paid) continue;
            const refunded = (ch.amount_refunded ?? 0) >= (ch.amount ?? 0);
            if (refunded) continue;
            chargesFound++;

            const amount = (ch.amount ?? 0) / 100;
            const chargeDate = isoDate(ch.created);
            const pi =
              typeof ch.payment_intent === "string"
                ? ch.payment_intent
                : ch.payment_intent?.id ?? null;

            if (recordedChargeIds.has(ch.id)) {
              lines.push({
                charge_id: ch.id,
                payment_intent_id: pi,
                amount,
                charge_date: chargeDate,
                rental_id: existing.find((p: any) => p.stripe_charge_id === ch.id)?.rental_id ?? null,
                driver_id: driver.id,
                status: "already_recorded",
                detail: "Already in payments (matched by Stripe charge id).",
              });
              continue;
            }

            const rental = matchRental(rentals, chargeDate, today);
            if (!rental) {
              lines.push({
                charge_id: ch.id,
                payment_intent_id: pi,
                amount,
                charge_date: chargeDate,
                rental_id: null,
                driver_id: driver.id,
                status: "unmatched",
                detail: "No reservation window contains this charge date — review manually.",
              });
              continue;
            }

            // Possible cash duplicate: a non-Stripe row, same rental & amount,
            // within 3 days, that has no charge id.
            const dup = existing.find(
              (p: any) =>
                p.rental_id === rental.id &&
                !p.stripe_charge_id &&
                Math.abs(Number(p.amount) - amount) < 0.005 &&
                p.status === "paid" &&
                (p.paid_date || p.due_date) &&
                daysApart((p.paid_date ?? p.due_date).slice(0, 10), chargeDate) <= 3,
            );
            if (dup) {
              lines.push({
                charge_id: ch.id,
                payment_intent_id: pi,
                amount,
                charge_date: chargeDate,
                rental_id: rental.id,
                driver_id: driver.id,
                status: "possible_cash_duplicate",
                detail: `A manual ${dup.method ?? "cash"} payment of $${amount.toFixed(2)} already exists near this date — skipped to avoid double-counting.`,
              });
              continue;
            }

            const paymentId = `PM-RC-${ch.id.slice(-16)}`;
            toInsert.push({
              id: paymentId,
              rental_id: rental.id,
              driver_id: driver.id,
              amount,
              kind: "charge",
              status: "paid",
              method: "Stripe",
              due_date: chargeDate,
              paid_date: chargeDate,
              stripe_charge_id: ch.id,
              stripe_payment_intent_id: pi,
            });
            lines.push({
              charge_id: ch.id,
              payment_intent_id: pi,
              amount,
              charge_date: chargeDate,
              rental_id: rental.id,
              driver_id: driver.id,
              status: data.commit ? "inserted" : "would_insert",
              detail: data.commit
                ? "Recorded against the reservation."
                : "Will be recorded on commit.",
            });
          }
        }
      }

      // 6. Commit if requested (upsert on id keeps it idempotent).
      if (data.commit && toInsert.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("payments")
          .upsert(toInsert, { onConflict: "id" });
        if (insErr) throw new Error(insErr.message);
      }

      return {
        lines,
        drivers_scanned: drivers.length,
        charges_found: chargesFound,
        inserted: data.commit ? toInsert.length : 0,
        would_insert: data.commit ? 0 : toInsert.length,
        already_recorded: lines.filter((l) => l.status === "already_recorded").length,
        possible_duplicates: lines.filter((l) => l.status === "possible_cash_duplicate").length,
        unmatched: lines.filter((l) => l.status === "unmatched").length,
        committed: !!data.commit,
        environment: env,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Stripe import failed" };
    }
  });