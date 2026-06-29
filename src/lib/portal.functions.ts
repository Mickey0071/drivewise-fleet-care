import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";

/* ===========================================================================
 * Canonical balance engine — server-side mirror of src/lib/mock/store.ts.
 * Same formulas, same numbers as the admin dashboard. Operates on raw DB rows.
 * Balance owed = time charge + prior balance − payments received − discounts.
 * ========================================================================= */
const DAY_MS = 86400000;
const DEFAULT_PAID_DAYS_WINDOW = 2;

function daysBetweenISO(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS,
  );
}

interface RentalRow {
  id: string;
  reservation_status: string | null;
  start_date: string | null;
  end_date: string | null;
  returned_at: string | null;
  billing_period: string | null;
  weekly_rate: number | null;
  rate: number | null;
  prior_balance: number | null;
  discount_total: number | null;
  paid_days_window: number | null;
}

function periodRate(r: RentalRow): { rate: number; weekly: boolean } {
  const weekly = String(r.billing_period ?? "").toLowerCase() !== "daily";
  const rate = weekly
    ? Number(r.weekly_rate) || Number(r.rate) || 0
    : Number(r.rate) || Number(r.weekly_rate) || 0;
  return { rate, weekly };
}

function throughDate(r: RentalRow): string {
  const rs = r.reservation_status ?? "active";
  const today = new Date().toISOString().slice(0, 10);
  const returned = rs === "returned" || rs === "completed" || !!r.returned_at;
  return (returned ? r.returned_at ?? r.end_date ?? today : today).slice(0, 10);
}

function paidDaysWindow(r: RentalRow): number {
  const w = Number(r.paid_days_window);
  return Number.isFinite(w) && w >= 0 ? w : DEFAULT_PAID_DAYS_WINDOW;
}

function postedPeriods(r: RentalRow): { periods: number; rate: number; weekly: boolean } {
  const { rate, weekly } = periodRate(r);
  const rs = r.reservation_status ?? "active";
  if (rs === "pending" || !r.start_date || rate <= 0) return { periods: 0, rate, weekly };
  const start = r.start_date.slice(0, 10);
  const days = daysBetweenISO(start, throughDate(r));
  if (days < 0) return { periods: 0, rate, weekly };
  if (weekly) return { periods: Math.floor(days / 7) + 1, rate, weekly };
  const window = paidDaysWindow(r);
  return { periods: Math.max(0, days + 1 - window), rate, weekly };
}

function timeCharge(r: RentalRow): number {
  const { periods, rate } = postedPeriods(r);
  return periods * rate;
}

function paymentsReceived(rows: any[]): number {
  return rows
    .filter((p) => p.status === "paid" && p.kind !== "credit" && p.kind !== "violation")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

function canonicalOwed(r: RentalRow, payRows: any[]): number {
  if ((r.reservation_status ?? "active") === "pending") return 0;
  return (
    timeCharge(r) +
    Number(r.prior_balance || 0) -
    paymentsReceived(payRows) -
    Number(r.discount_total || 0)
  );
}

function nextDueDate(r: RentalRow, payRows: any[]): string {
  const start = r.start_date?.slice(0, 10) ?? "";
  const { rate, weekly } = periodRate(r);
  if (!start || rate <= 0) return r.end_date ?? start;
  const received = paymentsReceived(payRows);
  const periodsCovered = Math.max(0, Math.floor(received / rate));
  const d = new Date(start + "T00:00:00Z");
  if (weekly) d.setUTCDate(d.getUTCDate() + periodsCovered * 7);
  else d.setUTCDate(d.getUTCDate() + paidDaysWindow(r) + periodsCovered);
  return d.toISOString().slice(0, 10);
}

const RENTAL_COLS =
  "id, vehicle_id, driver_id, reservation_status, start_date, end_date, returned_at, billing_period, weekly_rate, rate, prior_balance, discount_total, paid_days_window";

/** Resolve a portal token to its single reservation, or throw if invalid/expired. */
async function resolveToken(token: string): Promise<{ rentalId: string }> {
  const { data, error } = await supabaseAdmin
    .from("portal_tokens")
    .select("reservation_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This link is invalid.");
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    throw new Error("This link has expired. Please request a new one.");
  }
  return { rentalId: data.reservation_id as string };
}

/**
 * Public — fetch everything the portal page shows for the ONE reservation the
 * token unlocks. No login. The token is the only key; we never expose any
 * other reservation's data.
 */
export const getPortalData = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(16).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { rentalId } = await resolveToken(data.token);

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select(RENTAL_COLS)
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Reservation not found.");

    const [{ data: vehicle }, { data: payRows }, { data: extRows }, { data: reqRows }, { data: taskRows }] =
      await Promise.all([
        supabaseAdmin
          .from("vehicles")
          .select("year, make, model, plate")
          .eq("id", (rental as any).vehicle_id)
          .maybeSingle(),
        supabaseAdmin
          .from("payments")
          .select("id, amount, paid_date, method, status, kind, note")
          .eq("rental_id", rentalId),
        supabaseAdmin
          .from("rental_extensions")
          .select(
            "id, previous_end_date, new_end_date, periods, period_label, additional_amount, payment_id, signed_by, extended_at, created_at",
          )
          .eq("rental_id", rentalId)
          .order("new_end_date", { ascending: true }),
        supabaseAdmin
          .from("extension_requests")
          .select(
            "id, previous_end_date, new_end_date, periods, period_label, status, signed_at, rental_extension_id, applied_payment_id, created_at",
          )
          .eq("rental_id", rentalId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("runner_tasks")
          .select("id, title, status, scheduled_at, completed_at, details")
          .eq("customer_id", (rental as any).driver_id)
          .not("token", "is", null)
          .not("status", "in", "(cancelled,archived)")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    const rentalRow = rental as unknown as RentalRow;
    const allPays = (payRows ?? []) as any[];
    const payById = new Map(allPays.map((p) => [p.id, p]));

    const { rate, weekly } = periodRate(rentalRow);
    const charged = timeCharge(rentalRow) + Number(rentalRow.prior_balance || 0);
    const paid = paymentsReceived(allPays);
    const balance = canonicalOwed(rentalRow, allPays);

    // --- Extensions (chronological) ---
    const extensions = (extRows ?? []).map((e: any, idx: number) => {
      const linkedPay = e.payment_id ? payById.get(e.payment_id) : null;
      const isPaid = linkedPay && linkedPay.status === "paid";
      const startD = e.previous_end_date ?? null;
      const endD = e.new_end_date ?? null;
      const days = startD && endD ? Math.abs(daysBetweenISO(startD, endD)) : null;
      return {
        id: e.id as string,
        label: `Week ${idx + 2}`,
        startDate: startD,
        endDate: endD,
        days,
        amountCharged: Number(e.additional_amount ?? 0),
        amountPaid: isPaid ? Number(linkedPay.amount ?? 0) : 0,
        paymentDate: isPaid ? linkedPay.paid_date ?? null : null,
        paymentMethod: isPaid ? linkedPay.method ?? null : null,
        status: isPaid ? ("signed_paid" as const) : ("signed_due" as const),
      };
    });

    // "Link sent" — extension requests that were sent but never applied
    // (no charge yet, unsigned). These add $0 and show as informational.
    const appliedReqIds = new Set(
      (reqRows ?? [])
        .filter((r: any) => r.rental_extension_id)
        .map((r: any) => r.rental_extension_id),
    );
    void appliedReqIds;
    const linkSent = (reqRows ?? [])
      .filter(
        (r: any) =>
          !r.rental_extension_id &&
          !r.applied_payment_id &&
          !r.signed_at &&
          String(r.status ?? "").toLowerCase() === "pending",
      )
      .map((r: any, idx: number) => ({
        id: r.id as string,
        label: `Pending extension ${idx + 1}`,
        startDate: r.previous_end_date ?? null,
        endDate: r.new_end_date ?? null,
        days:
          r.previous_end_date && r.new_end_date
            ? Math.abs(daysBetweenISO(r.previous_end_date, r.new_end_date))
            : null,
        amountCharged: 0,
        amountPaid: 0,
        paymentDate: null,
        paymentMethod: null,
        status: "link_sent" as const,
      }));

    return {
      ok: true as const,
      reservation: {
        vehicle: {
          year: (vehicle as any)?.year ?? null,
          make: (vehicle as any)?.make ?? null,
          model: (vehicle as any)?.model ?? null,
          plate: (vehicle as any)?.plate ?? null,
        },
        startDate: rentalRow.start_date,
        endDate: rentalRow.end_date,
        rate,
        rateCadence: weekly ? ("weekly" as const) : ("daily" as const),
        totalCharged: Number(charged.toFixed(2)),
        totalPaid: Number(paid.toFixed(2)),
        balance: Number(balance.toFixed(2)),
        nextDueDate: nextDueDate(rentalRow, allPays),
      },
      extensions: [...extensions, ...linkSent],
      tasks: (taskRows ?? []).map((t: any) => ({
        id: t.id as string,
        title: t.title ?? "Task",
        status: t.status ?? "sent",
        scheduledAt: t.scheduled_at ?? null,
        completedAt: t.completed_at ?? null,
        vehicleLabel: (t.details ?? {})?.vehicleLabel ?? null,
      })),
    };
  });

/**
 * Public — renter enters any amount and pays via Stripe-hosted Checkout. We
 * create a Payment Link tagged `custom_renter_payment` so the EXISTING webhook
 * records it against this reservation with the app's standard payment logic.
 */
export const createPortalPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(16).max(128),
        amount: z.number().positive().max(100000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { rentalId } = await resolveToken(data.token);

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id")
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Reservation not found.");

    const amountCents = Math.round(data.amount * 100);
    if (amountCents < 50) throw new Error("Minimum payment is $0.50");
    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
    if (originHeader) {
      try {
        origin = new URL(originHeader).origin;
      } catch {
        /* keep default */
      }
    }

    const note = "Portal payment";
    const metadata = { kind: "custom_renter_payment", rental_id: rentalId, note };
    const product = await stripe.products.create({
      name: "Camauto Rentals — Portal payment",
      metadata: { rental_id: rentalId },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: amountCents,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      after_completion: {
        type: "redirect" as const,
        redirect: { url: `${origin}/portal/${encodeURIComponent(data.token)}?paid=1` },
      },
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");
    return { url: link.url };
  });
