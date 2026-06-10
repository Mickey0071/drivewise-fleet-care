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
  customer_token?: string | null;
  sent_to_customer_at?: string | null;
  viewed_at?: string | null;
  resolution_choice?: string | null;
  signed_at?: string | null;
  signed_pdf_url?: string | null;
  reminder_sent_at?: string | null;
  signed_name?: string | null;
  signature_url?: string | null;
  submitted_to_authority_at?: string | null;
  submitted_to?: string | null;
  submission_method?: string | null;
  confirmation_number?: string | null;
  resolved_at?: string | null;
  resolution_reason?: string | null;
  resolution_notes?: string | null;
  liability_transfer_generated_at?: string | null;
  liability_transfer_pdf_url?: string | null;
  mail_packet_printed_at?: string | null;
  mailed_at?: string | null;
  transfer_confirmed_at?: string | null;
  authority_key?: string | null;
  final_warning_sent_at?: string | null;
  violation_time?: string | null;
  location?: string | null;
  reference_number?: string | null;
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

export interface PlateMatch {
  rental: {
    id: string;
    driver_id: string | null;
    start_date: string;
    end_date: string | null;
  };
  driver: { id: string; full_name: string | null; phone: string | null; email: string | null } | null;
}

export interface PlateLookupResult {
  vehicleFound: boolean;
  vehicle: { id: string; plate: string; make: string; model: string; year: number } | null;
  matches: PlateMatch[];
  found: boolean;
  ambiguous: boolean;
  matchConfidence: number;
  confidenceLabel: string;
  reason?: string;
  legacyMatches?: {
    id: string;
    renter_name: string | null;
    plate: string | null;
    vehicle: string | null;
    start_datetime: string | null;
    end_datetime: string | null;
    address: string | null;
    dl_number: string | null;
    pickup_location: string | null;
    notes: string | null;
  }[];
}

export const lookupRentalByPlate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plate: string; date: string }) => {
    const plate = (input.plate || "").trim().toUpperCase();
    const date = (input.date || "").trim();
    if (!plate) throw new Error("Plate required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
    return { plate, date };
  })
  .handler(async ({ data }): Promise<PlateLookupResult> => {
    const { plate, date } = data;
    // Migrated (legacy) reservations matching this plate around the violation date.
    // These are lookup-only — never linked to a violation or counted in any report.
    const { data: legacyRows } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, plate, vehicle, start_datetime, end_datetime, address, dl_number, pickup_location, notes")
      .ilike("plate", plate)
      .limit(50);
    const legacyMatches = (legacyRows ?? []).filter((r) => {
      const start = r.start_datetime ? r.start_datetime.slice(0, 10) : null;
      const end = r.end_datetime ? r.end_datetime.slice(0, 10) : null;
      if (start && start > date) return false;
      if (end && end < date) return false;
      return true;
    });

    // 1) Find vehicle in fleet by plate
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, make, model, year")
      .ilike("plate", plate)
      .maybeSingle();
    if (!vehicle) {
      return {
        vehicleFound: false,
        vehicle: null,
        matches: [],
        found: false,
        ambiguous: false,
        matchConfidence: 0,
        confidenceLabel: "Vehicle not in fleet or OCR failed",
        reason: `No vehicle with plate ${plate}`,
        legacyMatches,
      };
    }

    // 2) Find all rentals of that vehicle active on the violation date
    const { data: rentals } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, start_date, end_date, returned_at")
      .eq("vehicle_id", vehicle.id)
      .lte("start_date", date)
      .order("start_date", { ascending: false })
      .limit(50);
    const active = (rentals ?? []).filter((r) => !r.end_date || r.end_date >= date);

    if (active.length === 0) {
      return {
        vehicleFound: true,
        vehicle,
        matches: [],
        found: false,
        ambiguous: false,
        matchConfidence: 40,
        confidenceLabel: "Plate matched, but no rental covers this date — select renter manually",
        reason: `No rental covers ${date} on plate ${plate}`,
        legacyMatches,
      };
    }

    const driverIds = Array.from(
      new Set(active.map((r) => r.driver_id).filter(Boolean)),
    ) as string[];
    const { data: drivers } = driverIds.length
      ? await supabaseAdmin
          .from("drivers")
          .select("id, full_name, phone, email")
          .in("id", driverIds)
      : { data: [] as { id: string; full_name: string; phone: string; email: string }[] };
    const dMap = new Map((drivers ?? []).map((d) => [d.id, d]));

    const matches: PlateMatch[] = active.map((r) => ({
      rental: {
        id: r.id,
        driver_id: r.driver_id ?? null,
        start_date: r.start_date,
        end_date: r.end_date ?? null,
      },
      driver: r.driver_id ? dMap.get(r.driver_id) ?? null : null,
    }));

    const ambiguous = matches.length > 1;
    return {
      vehicleFound: true,
      vehicle,
      matches,
      found: true,
      ambiguous,
      matchConfidence: ambiguous ? 70 : 95,
      confidenceLabel: ambiguous
        ? `${matches.length} rentals overlap this date — choose the renter`
        : "Plate + date match",
      legacyMatches,
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
      extractedConfidence?: number | null;
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
        extractedConfidence:
          input.extractedConfidence != null && Number.isFinite(Number(input.extractedConfidence))
            ? Math.max(0, Math.min(100, Math.round(Number(input.extractedConfidence))))
            : null,
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
        extracted_confidence: data.extractedConfidence,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, violation: row as ViolationRow };
  });

export interface RentalOption {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_name: string | null;
  vehicle_label: string | null;
  plate: string | null;
  start_date: string;
  end_date: string | null;
  reservation_status: string | null;
  source?: "live" | "migrated";
}

export const listRentalsForViolation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<RentalOption[]> => {
    const { data: rentals, error } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, start_date, end_date, reservation_status")
      .order("start_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = rentals ?? [];
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
    const vMap = new Map((vehicles ?? []).map((v) => [v.id, v]));
    const liveOptions: RentalOption[] = rows.map((r) => {
      const v = r.vehicle_id ? vMap.get(r.vehicle_id) : undefined;
      return {
        id: r.id,
        driver_id: r.driver_id ?? null,
        vehicle_id: r.vehicle_id ?? null,
        driver_name: r.driver_id ? dMap.get(r.driver_id) ?? null : null,
        vehicle_label: v ? `${v.year} ${v.make} ${v.model} (${v.plate})` : null,
        plate: v?.plate ?? null,
        start_date: r.start_date,
        end_date: r.end_date ?? null,
        reservation_status: r.reservation_status ?? null,
        source: "live",
      };
    });

    // Also include migrated/legacy reservations so manual match can pick them.
    const { data: legacyRows } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, plate, vehicle, start_datetime, end_datetime")
      .order("start_datetime", { ascending: false, nullsFirst: false })
      .limit(1000);
    const legacyOptions: RentalOption[] = (legacyRows ?? []).map((r) => ({
      id: `LEGACY:${r.id}`,
      driver_id: null,
      vehicle_id: null,
      driver_name: r.renter_name ?? null,
      vehicle_label: r.vehicle ?? null,
      plate: r.plate ?? null,
      start_date: r.start_datetime ? r.start_datetime.slice(0, 10) : "",
      end_date: r.end_datetime ? r.end_datetime.slice(0, 10) : null,
      reservation_status: "migrated",
      source: "migrated",
    }));

    return [...liveOptions, ...legacyOptions];
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

export interface ViolationHistoryRow {
  id: string;
  violation_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_by_name: string | null;
  created_at: string;
}

const VALID_STATUSES = ["pending", "paid", "disputed", "failed"] as const;
type ViolationStatus = (typeof VALID_STATUSES)[number];

export const listViolationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id) throw new Error("id required");
    return { id: input.id };
  })
  .handler(async ({ data }): Promise<ViolationHistoryRow[]> => {
    const { data: rows, error } = await supabaseAdmin
      .from("violation_status_history")
      .select("id, violation_id, from_status, to_status, reason, changed_by_name, created_at")
      .eq("violation_id", data.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ViolationHistoryRow[];
  });

export const changeViolationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: string; reason?: string; method?: string }) => {
    if (!input.id) throw new Error("id required");
    const status = (input.status || "").toLowerCase();
    if (!VALID_STATUSES.includes(status as ViolationStatus)) {
      throw new Error("Invalid status");
    }
    return {
      id: input.id,
      status: status as ViolationStatus,
      reason: (input.reason || "").slice(0, 500) || null,
      method: (input.method || "").slice(0, 40) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: current, error: cErr } = await supabaseAdmin
      .from("violations")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr || !current) throw new Error("Violation not found");
    const fromStatus = (current.status as string) || null;

    const patch: Record<string, unknown> = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };
    if (data.status === "paid") {
      patch.paid_at = new Date().toISOString();
      patch.payment_method = data.method || "manual";
    }
    const { error } = await supabaseAdmin
      .from("violations")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    let changedByName: string | null = null;
    if (context.userId) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", context.userId)
        .maybeSingle();
      changedByName = profile?.full_name || profile?.email || null;
    }

    await supabaseAdmin.from("violation_status_history").insert({
      violation_id: data.id,
      from_status: fromStatus,
      to_status: data.status,
      reason: data.reason,
      changed_by: context.userId ?? null,
      changed_by_name: changedByName,
    } as never);

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
function genCustomerToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Admin: generate a customer resolution link and send it via SMS + email. */
export const sendViolationToCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id) throw new Error("id required");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { data: v, error } = await (supabaseAdmin as any)
      .from("violations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");
    if (["paid", "resolved", "submitted_to_authority"].includes(v.status as string)) {
      throw new Error("This violation is already resolved.");
    }

    const { data: driver } = v.driver_id
      ? await (supabaseAdmin as any)
          .from("drivers")
          .select("full_name, phone, email")
          .eq("id", v.driver_id)
          .maybeSingle()
      : { data: null };
    if (!driver?.phone && !driver?.email) {
      throw new Error("Renter has no phone or email on file.");
    }

    const token = (v.customer_token as string) || genCustomerToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    await (supabaseAdmin as any)
      .from("violations")
      .update({
        customer_token: token,
        customer_token_expires_at: expires,
        status: "sent_to_customer",
        sent_to_customer_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", v.id);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
    if (originHeader) {
      try {
        origin = new URL(originHeader).origin;
      } catch {
        /* keep default */
      }
    }
    const url = `${origin}/violation/${encodeURIComponent(token)}`;
    const amt = `$${Number(v.total_amount || v.amount || 0).toFixed(2)}`;

    await notifyRenter({
      phone: driver?.phone ?? null,
      email: driver?.email ?? null,
      name: driver?.full_name ?? null,
      sms: `Camauto Rentals: You have an EZPass violation (${amt}). Resolve it here: ${url}`,
      emailSubject: "EZPass Violation Notice — Camauto Rentals",
      emailHeading: "EZPass Violation Notice",
      emailIntro: `You have an outstanding EZPass violation of <strong>${amt}</strong>. You can pay it directly or sign an affidavit to transfer liability to yourself.`,
      emailCta: { label: "Resolve Violation", url },
      emailDetails: [{ label: "Amount Due", value: amt }],
    });

    return { ok: true as const, url };
  });

/** Cron/admin: send reminders for violations awaiting a customer response 7+ days. */
export const sendViolationReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sevenDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();
    const { data: rows } = await (supabaseAdmin as any)
      .from("violations")
      .select("*")
      .in("status", ["sent_to_customer", "viewing"])
      .lte("sent_to_customer_at", sevenDaysAgo)
      .is("reminder_sent_at", null)
      .limit(200);
    let sent = 0;
    for (const v of rows ?? []) {
      const { data: driver } = v.driver_id
        ? await (supabaseAdmin as any)
            .from("drivers")
            .select("full_name, phone, email")
            .eq("id", v.driver_id)
            .maybeSingle()
        : { data: null };
      if (!driver?.phone && !driver?.email) continue;
      const url = `${process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app"}/violation/${encodeURIComponent(v.customer_token as string)}`;
      const amt = `$${Number(v.total_amount || v.amount || 0).toFixed(2)}`;
      await notifyRenter({
        phone: driver.phone ?? null,
        email: driver.email ?? null,
        name: driver.full_name ?? null,
        sms: `Reminder from Camauto Rentals: Your EZPass violation (${amt}) is still unresolved. ${url}`,
        emailSubject: "Reminder: EZPass Violation — Camauto Rentals",
        emailHeading: "Reminder: Unresolved Violation",
        emailIntro: `This is a reminder that your EZPass violation of <strong>${amt}</strong> is still unresolved. Please pay or sign the affidavit.`,
        emailCta: { label: "Resolve Now", url },
      });
      await (supabaseAdmin as any)
        .from("violations")
        .update({ reminder_sent_at: new Date().toISOString() } as never)
        .eq("id", v.id);
      sent++;
    }
    return { ok: true as const, sent };
  });

const VIOLATION_ADMIN_PHONE = "267-221-3977";
const AUTHORITIES = ["EZPass", "NJ DMV", "NY DMV", "PA DOT", "Other"];
const SUBMIT_METHODS = ["Email", "Mail", "Online Portal", "Phone"];
// Methods where the authority returns a tracking/confirmation number we must record.
const CONFIRMATION_REQUIRED_METHODS = ["Online Portal", "Phone"];
// A violation can only be submitted to the authority from one of these states.
const SUBMITTABLE_STATUSES = [
  "affidavit_signed",
  "sent_to_customer",
  "viewing",
  "new",
  "logged",
  "pending",
];

/** Admin: full detail for the View & Submit dialog (customer info, affidavit, license, pre-built email). */
export const getViolationSubmissionDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input.id) throw new Error("id required");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { data: v, error } = await (supabaseAdmin as any)
      .from("violations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !v) throw new Error("Violation not found");

    const [{ data: driver }, { data: vehicle }, { data: rental }] = await Promise.all([
      v.driver_id
        ? (supabaseAdmin as any)
            .from("drivers")
            .select(
              "full_name, first_name, last_name, phone, email, license_number, dl_state, address, street_address, city, state, zip_code, license_image_url",
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
            .select("id, start_date, end_date, agreement_pdf_url")
            .eq("id", v.rental_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Fresh signed URL for the license image (private bucket) if it is a storage path.
    let licenseUrl: string | null = driver?.license_image_url ?? null;

    const amt = `$${Number(v.total_amount || v.amount || 0).toFixed(2)}`;
    const vehLabel = vehicle
      ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
      : "—";
    const addrParts = [
      driver?.street_address || driver?.address,
      [driver?.city, driver?.state, driver?.zip_code].filter(Boolean).join(", "),
    ].filter(Boolean);

    const emailBody = [
      `To Whom It May Concern,`,
      ``,
      `Camauto Rentals LLC is submitting a signed Liability Transfer Affidavit for the toll/violation referenced below. The vehicle was under a rental agreement at the time of the violation and the responsible operator has accepted liability in writing.`,
      ``,
      `VIOLATION DETAILS`,
      `  Violation ID:      ${v.id}`,
      `  Date of Violation: ${v.date_issued ?? "—"}`,
      `  Amount:            ${amt}`,
      `  License Plate:     ${v.license_plate || vehicle?.plate || "—"}`,
      `  Vehicle:           ${vehLabel}`,
      `  VIN:               ${vehicle?.vin || "—"}`,
      ``,
      `RESPONSIBLE OPERATOR`,
      `  Name:              ${driver?.full_name || "—"}`,
      `  Driver's License:  ${driver?.license_number || "—"}${driver?.dl_state ? ` (${driver.dl_state})` : ""}`,
      `  Address:           ${addrParts.join(" ") || "—"}`,
      `  Phone:             ${driver?.phone || "—"}`,
      `  Email:             ${driver?.email || "—"}`,
      `  Affidavit Signed:  ${v.signed_at ? new Date(v.signed_at).toLocaleString() : "—"}`,
      ``,
      `Attached to this email:`,
      `  1. Signed Liability Transfer Affidavit (PDF)`,
      `  2. Copy of the operator's driver's license`,
      ``,
      `Please transfer liability for this violation to the operator named above. Contact us at 866-625-5550 if any additional information is required.`,
      ``,
      `Sincerely,`,
      `Camauto Rentals LLC`,
    ].join("\n");

    return {
      id: v.id as string,
      status: v.status as string,
      amount: Number(v.total_amount || v.amount || 0),
      dateIssued: (v.date_issued as string) ?? null,
      plate: (v.license_plate as string) || (vehicle?.plate as string) || null,
      vehicleLabel: vehLabel,
      vin: (vehicle?.vin as string) ?? null,
      signedAt: (v.signed_at as string) ?? null,
      signedName: (v.signed_name as string) ?? null,
      signedPdfUrl: (v.signed_pdf_url as string) ?? null,
      licenseUrl,
      agreementUrl: (rental?.agreement_pdf_url as string) ?? null,
      viewedAt: (v.viewed_at as string) ?? null,
      driver: driver
        ? {
            fullName: driver.full_name ?? null,
            phone: driver.phone ?? null,
            email: driver.email ?? null,
            licenseNumber: driver.license_number ?? null,
            dlState: driver.dl_state ?? null,
            address: addrParts.join(" ") || null,
          }
        : null,
      rental: rental ? { id: rental.id, start: rental.start_date, end: rental.end_date } : null,
      submittedTo: (v.submitted_to as string) ?? null,
      submissionMethod: (v.submission_method as string) ?? null,
      confirmationNumber: (v.confirmation_number as string) ?? null,
      submittedAt: (v.submitted_to_authority_at as string) ?? null,
      resolvedAt: (v.resolved_at as string) ?? null,
      resolutionReason: (v.resolution_reason as string) ?? null,
      resolutionNotes: (v.resolution_notes as string) ?? null,
      emailSubject: `Liability Transfer Affidavit — Violation ${v.id} — Camauto Rentals`,
      emailBody,
    };
  });

/** Admin: record that a signed affidavit was submitted to the authority. */
export const submitViolationToAuthority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string;
    authority: string;
    method: string;
    confirmationNumber?: string;
    notes?: string;
  }) => {
    if (!input.id) throw new Error("id required");
    const authority = (input.authority || "").trim();
    if (!authority) throw new Error("Please select the authority you submitted to.");
    if (!AUTHORITIES.includes(authority)) {
      throw new Error(`"${authority}" is not a valid authority. Choose one of: ${AUTHORITIES.join(", ")}.`);
    }
    const method = (input.method || "").trim();
    if (!method) throw new Error("Please select how the violation was submitted.");
    if (!SUBMIT_METHODS.includes(method)) {
      throw new Error(`"${method}" is not a valid submission method. Choose one of: ${SUBMIT_METHODS.join(", ")}.`);
    }
    const confirmationNumber = (input.confirmationNumber || "").trim();
    if (CONFIRMATION_REQUIRED_METHODS.includes(method) && !confirmationNumber) {
      throw new Error(`A confirmation number is required when submitting via ${method}.`);
    }
    if (confirmationNumber.length > 120) {
      throw new Error("Confirmation number must be 120 characters or fewer.");
    }
    return {
      id: input.id,
      authority,
      method,
      confirmationNumber: confirmationNumber || null,
      notes: (input.notes || "").slice(0, 1000) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: current } = await (supabaseAdmin as any)
      .from("violations")
      .select("status, total_amount, amount, driver_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Violation not found");
    const status = (current.status as string) ?? "";
    if (status === "submitted_to_authority") {
      throw new Error("This violation has already been submitted to the authority.");
    }
    if (status === "resolved" || status === "paid") {
      throw new Error("This violation is already resolved and cannot be submitted to an authority.");
    }
    if (status && !SUBMITTABLE_STATUSES.includes(status)) {
      throw new Error(`A violation in "${status}" status cannot be submitted to an authority.`);
    }
    const now = new Date().toISOString();

    const { error } = await (supabaseAdmin as any)
      .from("violations")
      .update({
        status: "submitted_to_authority",
        submitted_to_authority_at: now,
        submitted_to: data.authority,
        submission_method: data.method,
        confirmation_number: data.confirmationNumber,
        submission_notes: data.notes,
        updated_at: now,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    let changedByName: string | null = null;
    if (context.userId) {
      const { data: profile } = await (supabaseAdmin as any)
        .from("profiles")
        .select("full_name, email")
        .eq("id", context.userId)
        .maybeSingle();
      changedByName = profile?.full_name || profile?.email || null;
    }

    await (supabaseAdmin as any).from("violation_status_history").insert({
      violation_id: data.id,
      from_status: current.status ?? null,
      to_status: "submitted_to_authority",
      reason: `Submitted to ${data.authority} via ${data.method}${data.confirmationNumber ? ` (conf# ${data.confirmationNumber})` : ""}${data.notes ? ` — ${data.notes}` : ""}`,
      changed_by: context.userId ?? null,
      changed_by_name: changedByName,
    } as never);

    let customerName = "Customer";
    if (current.driver_id) {
      const { data: d } = await (supabaseAdmin as any)
        .from("drivers")
        .select("full_name")
        .eq("id", current.driver_id)
        .maybeSingle();
      customerName = d?.full_name || customerName;
    }
    const amt = `$${Number(current.total_amount || current.amount || 0).toFixed(2)}`;
    try {
      await notifyRenter({
        phone: VIOLATION_ADMIN_PHONE,
        email: null,
        name: "Admin",
        sms: `✓ Violation submitted to ${data.authority}: ${customerName} ${amt}`,
        emailSubject: "Violation submitted to authority",
        emailHeading: "Violation submitted",
        emailIntro: `Violation ${data.id} was submitted to ${data.authority}.`,
      });
    } catch (e) {
      console.error("[submitViolationToAuthority] admin notify failed", e);
    }

    return { ok: true as const };
  });

/** Admin: final closure of a violation. */
export const markViolationResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason: string; notes?: string }) => {
    if (!input.id) throw new Error("id required");
    const reason = (input.reason || "").trim();
    if (!reason) throw new Error("Please provide a reason for resolving this violation.");
    return {
      id: input.id,
      reason: reason.slice(0, 300),
      notes: (input.notes || "").slice(0, 1000) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: current } = await (supabaseAdmin as any)
      .from("violations")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Violation not found");
    const status = (current.status as string) ?? "";
    if (status === "resolved") {
      throw new Error("This violation has already been resolved.");
    }
    const now = new Date().toISOString();

    const { error } = await (supabaseAdmin as any)
      .from("violations")
      .update({
        status: "resolved",
        resolved_at: now,
        resolution_reason: data.reason,
        resolution_notes: data.notes,
        updated_at: now,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    let changedByName: string | null = null;
    if (context.userId) {
      const { data: profile } = await (supabaseAdmin as any)
        .from("profiles")
        .select("full_name, email")
        .eq("id", context.userId)
        .maybeSingle();
      changedByName = profile?.full_name || profile?.email || null;
    }

    await (supabaseAdmin as any).from("violation_status_history").insert({
      violation_id: data.id,
      from_status: current.status ?? null,
      to_status: "resolved",
      reason: `${data.reason}${data.notes ? ` — ${data.notes}` : ""}`,
      changed_by: context.userId ?? null,
      changed_by_name: changedByName,
    } as never);

    return { ok: true as const };
  });
