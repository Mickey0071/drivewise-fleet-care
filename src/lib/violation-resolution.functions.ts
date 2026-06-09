import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";

const RESOLVED_STATUSES = ["paid", "submitted_to_authority", "resolved"];

function stripeEnv(): StripeEnv {
  return process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
}

function appOrigin(): string {
  const h = getRequestHeader("origin") || getRequestHeader("referer");
  let origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
  if (h) {
    try {
      origin = new URL(h).origin;
    } catch {
      /* keep default */
    }
  }
  return origin;
}

type ViolationCtx = {
  violation: any;
  driver: any;
  vehicle: any;
  rental: any;
};

async function loadByToken(token: string): Promise<ViolationCtx> {
  const { data: v } = await (supabaseAdmin as any)
    .from("violations")
    .select("*")
    .eq("customer_token", token)
    .maybeSingle();
  if (!v) throw new Error("This link is invalid or has expired.");
  if (v.customer_token_expires_at && new Date(v.customer_token_expires_at as string) < new Date()) {
    throw new Error("This link has expired. Please call 866-625-5550.");
  }
  const [{ data: driver }, { data: vehicle }, { data: rental }] = await Promise.all([
    v.driver_id
      ? (supabaseAdmin as any)
          .from("drivers")
          .select(
            "full_name, first_name, last_name, phone, email, license_number, dl_state, address, street_address, city, state, zip_code, stripe_customer_id, stripe_payment_method_id",
          )
          .eq("id", v.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.vehicle_id
      ? (supabaseAdmin as any)
          .from("vehicles")
          .select("year, make, model, vin, plate")
          .eq("id", v.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? (supabaseAdmin as any)
          .from("rentals")
          .select("id, start_date, end_date, driver_id")
          .eq("id", v.rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { violation: v, driver, vehicle, rental };
}

/** Public: load the violation summary for the customer informational page. */
export const getViolationForCustomer = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await (supabaseAdmin as any).rpc("get_violation_public", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };

    const resolved = RESOLVED_STATUSES.includes(row.status as string);
    // Mark as viewing on first open (best-effort, non-blocking).
    if (!resolved && row.status === "sent_to_customer") {
      await (supabaseAdmin as any)
        .from("violations")
        .update({ status: "viewing", viewed_at: new Date().toISOString() } as never)
        .eq("customer_token", data.token);
    } else if (!resolved && !row.viewed_at) {
      await (supabaseAdmin as any)
        .from("violations")
        .update({ viewed_at: new Date().toISOString() } as never)
        .eq("customer_token", data.token)
        .is("viewed_at", null);
    }

    return {
      found: true as const,
      resolved,
      id: row.id as string,
      status: row.status as string,
      resolutionChoice: (row.resolution_choice as string) ?? null,
      amount: Number(row.total_amount || row.amount || 0),
      dateIssued: (row.date_issued as string) ?? null,
      location: (row.description as string) ?? null,
      plate: (row.vehicle_plate || row.license_plate) as string | null,
      paidAt: (row.paid_at as string) ?? null,
      vehicle: {
        year: row.vehicle_year as number | null,
        make: row.vehicle_make as string | null,
        model: row.vehicle_model as string | null,
        plate: row.vehicle_plate as string | null,
      },
      driverName: row.driver_full_name as string | null,
      rentalStart: (row.rental_start_date as string) ?? null,
      rentalEnd: (row.rental_end_date as string) ?? null,
    };
  });

/** Public: customer chooses to pay; create a Stripe payment link. */
export const createViolationCustomerPayment = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const ctx = await loadByToken(data.token);
    const v = ctx.violation;
    if (RESOLVED_STATUSES.includes(v.status)) {
      throw new Error("This violation has already been resolved.");
    }
    const amount = Number(v.total_amount || v.amount || 0);
    if (!(amount > 0)) throw new Error("Violation amount is not set.");
    const amountCents = Math.round(amount * 100);

    const stripe = createStripeClient(stripeEnv());
    const origin = appOrigin();
    const note = `Violation ${v.id}`;
    const metadata = {
      kind: "violation_customer",
      violation_id: v.id,
      customer_token: data.token,
      rental_id: v.rental_id || "",
      note,
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — Violation ${v.id}`,
      metadata: { violation_id: v.id, rental_id: v.rental_id || "" },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: amountCents,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      customer_creation: "always",
      payment_intent_data: { metadata, setup_future_usage: "off_session" },
      after_completion: {
        type: "redirect" as const,
        redirect: { url: `${origin}/violation/${encodeURIComponent(data.token)}?paid=1` },
      },
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");

    await (supabaseAdmin as any)
      .from("violations")
      .update({
        resolution_choice: "pay",
        payment_method: "payment_link",
        payment_link_url: link.url,
        stripe_payment_link_id: link.id,
      } as never)
      .eq("id", v.id);

    return { url: link.url };
  });
