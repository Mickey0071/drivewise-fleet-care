import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { getRequestHeader } from "@tanstack/react-start/server";

export interface ViolationRow {
  id: string;
  rental_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  type: string;
  license_plate: string | null;
  date_issued: string;
  amount: number;
  fee: number;
  total_amount: number;
  description: string | null;
  photo_url: string | null;
  status: string;
  payment_method: string | null;
  payment_link_url: string | null;
  paid_at: string | null;
  created_at: string;
  notes: string | null;
  driver_name?: string | null;
  vehicle_label?: string | null;
}

export const listViolations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ViolationRow[]> => {
    const { data, error } = await supabaseAdmin
      .from("violations")
      .select("*")
      .order("date_issued", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ViolationRow[];
    const driverIds = Array.from(new Set(rows.map((r) => r.driver_id).filter(Boolean))) as string[];
    const vehicleIds = Array.from(new Set(rows.map((r) => r.vehicle_id).filter(Boolean))) as string[];
    const [{ data: drivers }, { data: vehicles }] = await Promise.all([
      driverIds.length
        ? supabaseAdmin.from("drivers").select("id, full_name").in("id", driverIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      vehicleIds.length
        ? supabaseAdmin.from("vehicles").select("id, plate, make, model, year").in("id", vehicleIds)
        : Promise.resolve({ data: [] as { id: string; plate: string; make: string; model: string; year: number }[] }),
    ]);
    const dMap = new Map((drivers ?? []).map((d) => [d.id, d.full_name]));
    const vMap = new Map(
      (vehicles ?? []).map((v) => [v.id, `${v.year} ${v.make} ${v.model} (${v.plate})`]),
    );
    return rows.map((r) => ({
      ...r,
      driver_name: r.driver_id ? dMap.get(r.driver_id) ?? null : null,
      vehicle_label: r.vehicle_id ? vMap.get(r.vehicle_id) ?? null : null,
    }));
  });

export const lookupRentalByPlate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plate: string; date: string }) => {
    const plate = (input.plate || "").trim().toUpperCase();
    const date = (input.date || "").trim();
    if (!plate) throw new Error("Plate required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
    return { plate, date };
  })
  .handler(async ({ data }) => {
    const { plate, date } = data;
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, make, model, year")
      .ilike("plate", plate)
      .maybeSingle();
    if (!vehicle) return { found: false as const, reason: `No vehicle with plate ${plate}` };

    const { data: rentals } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, start_date, end_date, returned_at")
      .eq("vehicle_id", vehicle.id)
      .lte("start_date", date)
      .order("start_date", { ascending: false })
      .limit(20);
    const match = (rentals ?? []).find(
      (r) => !r.end_date || r.end_date >= date,
    );
    if (!match) {
      return {
        found: false as const,
        reason: `No rental covers ${date} on plate ${plate}`,
        vehicle,
      };
    }
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, full_name, phone, email")
      .eq("id", match.driver_id)
      .maybeSingle();
    return {
      found: true as const,
      vehicle,
      rental: match,
      driver: driver ?? null,
    };
  });

export const createViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      rentalId?: string | null;
      vehicleId?: string | null;
      driverId?: string | null;
      type: string;
      date: string;
      licensePlate?: string | null;
      amount: number;
      fee?: number;
      description?: string;
      photoUrl?: string | null;
    }) => {
      const type = (input.type || "").toLowerCase();
      if (!["toll", "parking", "damage", "traffic", "other"].includes(type)) {
        throw new Error("Invalid violation type");
      }
      const amount = Number(input.amount);
      const fee = Number(input.fee ?? 0);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount invalid");
      if (!Number.isFinite(fee) || fee < 0) throw new Error("Fee invalid");
      if (amount + fee > 50000) throw new Error("Total too large");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || "")) throw new Error("Date required");
      return {
        rentalId: input.rentalId || null,
        vehicleId: input.vehicleId || null,
        driverId: input.driverId || null,
        type,
        date: input.date,
        licensePlate: (input.licensePlate || "").toUpperCase() || null,
        amount,
        fee,
        description: (input.description || "").slice(0, 500),
        photoUrl: input.photoUrl || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const total = Number((data.amount + data.fee).toFixed(2));
    const newId =
      "VIO-" +
      Math.random().toString(36).slice(2, 8).toUpperCase() +
      Date.now().toString(36).slice(-3).toUpperCase();
    const { data: row, error } = await supabaseAdmin
      .from("violations")
      .insert({
        id: newId,
        rental_id: data.rentalId,
        vehicle_id: data.vehicleId ?? "UNKNOWN",
        driver_id: data.driverId,
        type: data.type,
        date_issued: data.date,
        license_plate: data.licensePlate,
        amount: data.amount,
        fee: data.fee,
        total_amount: total,
        description: data.description,
        notes: data.description,
        photo_url: data.photoUrl,
        status: "pending",
        created_by: context.userId,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, violation: row as ViolationRow };
  });

export const markViolationDisputed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id) throw new Error("id required");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("violations")
      .update({ status: "disputed", updated_at: new Date().toISOString() } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const markViolationPaidManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; method?: string }) => {
    if (!input.id) throw new Error("id required");
    return { id: input.id, method: (input.method || "manual").slice(0, 40) };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("violations")
      .update({
        status: "paid",
        payment_method: data.method,
        paid_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const chargeViolationRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; mode: "auto" | "link" }) => {
    if (!input.id) throw new Error("id required");
    if (input.mode !== "auto" && input.mode !== "link") throw new Error("Invalid mode");
    return { id: input.id, mode: input.mode };
  })
  .handler(async ({ data }) => {
    const { data: v, error: vErr } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (vErr || !v) throw new Error("Violation not found");
    if (v.status === "paid") throw new Error("Already paid");
    const rentalId = v.rental_id as string | null;
    if (!rentalId) throw new Error("Violation has no linked rental");
    const amount = Number(v.total_amount || v.amount);
    if (!(amount > 0)) throw new Error("Violation amount must be > 0");

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, stripe_customer_id, stripe_payment_method_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (rErr || !rental) throw new Error("Rental not found");

    const { data: subRow } = await supabaseAdmin
      .from("subscriptions")
      .select("environment")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const env: StripeEnv = (subRow?.environment as StripeEnv) || "sandbox";
    const stripe = createStripeClient(env);

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, phone, email")
      .eq("id", rental.driver_id)
      .maybeSingle();

    const description = (v.description as string | null) || `${v.type} violation`;
    const amountCents = Math.round(amount * 100);
    let stripeCustomerId = (rental.stripe_customer_id as string | null) || null;
    const stripePaymentMethodId = (rental.stripe_payment_method_id as string | null) || null;

    const canAutoCharge = Boolean(stripeCustomerId && stripePaymentMethodId);
    const useLink = data.mode === "link" || !canAutoCharge;

    if (useLink) {
      if (!driver?.phone && !driver?.email) {
        throw new Error("Renter has no phone or email on file — cannot send payment link");
      }
      const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
      let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
      if (originHeader) {
        try {
          origin = new URL(originHeader).origin;
        } catch {
          /* keep default */
        }
      }
      const note = `Violation: ${description}`.slice(0, 200);
      const metadata = {
        kind: "custom_renter_payment",
        rental_id: rentalId,
        violation_id: v.id,
        note,
      };
      const product = await stripe.products.create({
        name: `Camauto Rentals — ${note}`.slice(0, 250),
        metadata: { rental_id: rentalId, violation_id: v.id },
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
        ...(origin
          ? {
              after_completion: {
                type: "redirect" as const,
                redirect: { url: `${origin}/my-rentals/${encodeURIComponent(rentalId)}?paid=1` },
              },
            }
          : {}),
        restrictions: { completed_sessions: { limit: 1 } },
      });
      if (!link.url) throw new Error("Stripe did not return a payment link URL");

      const amt = `$${amount.toFixed(2)}`;
      await notifyRenter({
        phone: driver?.phone ?? null,
        email: driver?.email ?? null,
        name: driver?.full_name ?? null,
        sms: `Camauto Rentals: Violation ${amt} — ${description}. Pay: ${link.url}`,
        emailSubject: "Violation Charge — Camauto Rentals",
        emailHeading: "Violation Charge",
        emailIntro: `A violation charge of <strong>${amt}</strong> has been issued: ${description}. Tap below to pay.`,
        emailCta: { label: `Pay ${amt} Now`, url: link.url },
        emailDetails: [
          { label: "Amount", value: amt },
          { label: "Description", value: description },
        ],
      });

      await supabaseAdmin
        .from("violations")
        .update({
          status: "pending",
          payment_method: "payment_link",
          payment_link_url: link.url,
          stripe_payment_link_id: link.id,
        } as never)
        .eq("id", v.id);

      return { ok: true as const, mode: "link" as const, url: link.url };
    }

    // ---- Auto-charge saved card ----
    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomerId!,
        payment_method: stripePaymentMethodId!,
        off_session: true,
        confirm: true,
        description: `Violation: ${description} (rental ${rentalId})`,
        metadata: { rental_id: rentalId, kind: "violation", violation_id: v.id, description },
      });
      if (pi.status !== "succeeded") {
        await supabaseAdmin
          .from("violations")
          .update({ status: "failed", stripe_payment_intent_id: pi.id } as never)
          .eq("id", v.id);
        throw new Error(`Charge not completed (status: ${pi.status})`);
      }
      await supabaseAdmin
        .from("violations")
        .update({
          status: "paid",
          payment_method: "card_on_file",
          stripe_payment_intent_id: pi.id,
          paid_at: new Date().toISOString(),
        } as never)
        .eq("id", v.id);

      let last4: string | null = null;
      try {
        const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId!);
        last4 = pm.card?.last4 ?? null;
      } catch {
        /* non-fatal */
      }
      const amt = `$${amount.toFixed(2)}`;
      const cardLabel = last4 ? ` ending in ${last4}` : "";
      if (driver?.phone || driver?.email) {
        await notifyRenter({
          phone: driver?.phone ?? null,
          email: driver?.email ?? null,
          name: driver?.full_name ?? null,
          sms: `Camauto Rentals charged your card${cardLabel} ${amt} for ${description}. Questions? 866-625-5550`,
          emailSubject: "Violation Charged — Camauto Rentals",
          emailHeading: "Violation Charged",
          emailIntro: `A violation charge of <strong>${amt}</strong> has been charged to your card${cardLabel ? ` <strong>${cardLabel.trim()}</strong>` : " on file"}: ${description}.`,
          emailDetails: [
            { label: "Amount", value: amt },
            { label: "Description", value: description },
            ...(last4 ? [{ label: "Card", value: `•••• ${last4}` }] : []),
          ],
        });
      }
      return { ok: true as const, mode: "charged" as const, paymentIntentId: pi.id };
    } catch (e: unknown) {
      const err = e as { raw?: { message?: string }; message?: string };
      const msg = err?.raw?.message || err?.message || String(e);
      await supabaseAdmin
        .from("violations")
        .update({ status: "failed" } as never)
        .eq("id", v.id);
      throw new Error(msg);
    }
  });