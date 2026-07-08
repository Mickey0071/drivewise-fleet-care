import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { extractNameFromIdImage, uploadPayerIdImage } from "@/lib/payer-id-ocr.server";
import { getRequestHeader } from "@tanstack/react-start/server";

const AGREEMENT_VERSION = "v1.0";

function genToken(): string {
  // 32 hex chars
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function addPeriod(base: Date, periods: number, label: string): Date {
  const d = new Date(base);
  if (label === "daily" || label === "day") d.setDate(d.getDate() + periods);
  else if (label === "monthly" || label === "month") d.setMonth(d.getMonth() + periods);
  else d.setDate(d.getDate() + periods * 7);
  return d;
}

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  const ok = (roles ?? []).some((r: any) => r.role === "admin");
  if (!ok) throw new Error("Admin role required");
}

/**
 * Admin: create an extension link. Computes new end_date + amount, generates a
 * token, creates a Stripe Payment Link, and SMSes the renter with one link
 * (/extend/<token>) where they sign + pay in a single step.
 */
export const createExtensionLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; periods: number; periodLabel?: string; chargeState?: "owed" | "paid"; method?: string; collectAmount?: number }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    const n = Number(d.periods);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error("Periods must be 1–60");
    const label = (d.periodLabel || "").toLowerCase();
    if (label && !["day", "week", "month", "daily", "weekly", "monthly"].includes(label)) {
      throw new Error("Invalid period label");
    }
    const chargeState = d.chargeState === "paid" ? "paid" : "owed";
    const method = typeof d.method === "string" ? d.method : "cash";
    let collectAmount: number | undefined;
    if (d.collectAmount != null) {
      const c = Number(d.collectAmount);
      if (!Number.isFinite(c) || c <= 0) throw new Error("Amount to collect must be greater than $0");
      if (c > 1_000_000) throw new Error("Amount to collect is too large");
      collectAmount = Number(c.toFixed(2));
    }
    return { rentalId: d.rentalId, periods: n, periodLabel: label || "", chargeState, method, collectAmount };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, reservation_status, billing_period, weekly_rate, rate, end_date")
      .eq("id", data.rentalId).maybeSingle();
    if (!rental) throw new Error("Rental not found");
    if (rental.reservation_status !== "active" && rental.reservation_status !== "on_rent") {
      throw new Error("Extensions are only available for active rentals.");
    }

    const rate = Number(rental.rate ?? rental.weekly_rate ?? 0);
    if (rate <= 0) throw new Error("Rental rate is not set.");

    const rawLabel = (data.periodLabel || rental.billing_period || "weekly").toLowerCase();
    const periodLabel = rawLabel.startsWith("day") ? "day"
      : rawLabel.startsWith("month") ? "month" : "week";

    const baseEnd = rental.end_date ? new Date(rental.end_date as string) : new Date();
    const newEnd = addPeriod(baseEnd, data.periods, periodLabel);
    const newEndIso = newEnd.toISOString().slice(0, 10);
    const additionalAmount = Number((rate * data.periods).toFixed(2));
    // The full period charge always hits the account (charge + extension log).
    // The Stripe link, however, only collects what the admin chose to collect
    // now (defaults to the full charge). A partial collection naturally leaves
    // the difference as an open balance via timeCharge − paymentsReceived.
    const collectAmount = data.collectAmount != null
      ? Number(data.collectAmount.toFixed(2))
      : additionalAmount;
    const amountCents = Math.round(collectAmount * 100);

    const token = genToken();

    // Insert request row first so we can attach the link URL after.
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("extension_requests")
      .insert({
        token,
        rental_id: rental.id,
        periods: data.periods,
        period_label: periodLabel,
        previous_end_date: rental.end_date ?? null,
        new_end_date: newEndIso,
        additional_amount: additionalAmount,
        status: "pending",
        agreement_version: AGREEMENT_VERSION,
        created_by: context.userId,
      } as any)
      .select("id, token")
      .maybeSingle();
    if (insErr || !inserted) throw new Error(insErr?.message || "Failed to create extension request");

    // ---- Apply + log the extension immediately ----
    // Advance the rental end date, write the extension log row, and create the
    // extension charge now so it shows on the reservation card right away,
    // instead of waiting for the renter to sign/pay the Stripe link.
    const today = new Date().toISOString().slice(0, 10);
    const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
    const extId = `EXT-${rand().toUpperCase()}`;
    const payId = `EXTPAY-${rand().toUpperCase()}`;
    const chargePaid = data.chargeState === "paid";

    // Extension charge line.
    await supabaseAdmin.from("payments").insert({
      id: payId,
      rental_id: rental.id,
      driver_id: rental.driver_id,
      amount: additionalAmount,
      due_date: newEndIso,
      paid_date: chargePaid ? today : null,
      method: chargePaid ? data.method : null,
      status: chargePaid ? "paid" : "late",
      kind: "charge",
      note: `Extension: +${data.periods} ${periodLabel}${data.periods === 1 ? "" : "s"}`,
    } as any);

    // Extension log row.
    await supabaseAdmin.from("rental_extensions").insert({
      id: extId,
      rental_id: rental.id,
      extended_at: new Date().toISOString(),
      previous_end_date: rental.end_date ?? null,
      new_end_date: newEndIso,
      periods: data.periods,
      period_label: periodLabel,
      additional_amount: additionalAmount,
      payment_id: payId,
      agreement_version: AGREEMENT_VERSION,
    } as any);

    // Advance the rental end date.
    await supabaseAdmin.from("rentals").update({ end_date: newEndIso }).eq("id", rental.id);

    // Clear any pre-scheduled weekly/daily placeholder charges that this
    // extension now covers. The auto-scheduler seeds upcoming periods as
    // unpaid "late"/"missed" PM-<rental>-<date> rows; leaving them behind
    // after an extension covers the same period produces a phantom duplicate
    // charge. Only ever remove unpaid rows with no real Stripe charge.
    {
      const prevEndIso = rental.end_date ? String(rental.end_date).slice(0, 10) : today;
      await supabaseAdmin
        .from("payments")
        .delete()
        .eq("rental_id", rental.id)
        .in("status", ["late", "missed"])
        .is("paid_date", null)
        .is("stripe_charge_id", null)
        .like("id", "PM-%")
        .gt("due_date", prevEndIso)
        .lte("due_date", newEndIso);
    }

    // Link the request to the applied records so the webhook reconciles
    // (marks paid) instead of applying the extension a second time.
    await supabaseAdmin.from("extension_requests").update({
      rental_extension_id: extId,
      applied_payment_id: payId,
      applied_at: new Date().toISOString(),
      charge_state: chargePaid ? "paid" : "owed",
      ...(chargePaid ? { status: "paid", paid_at: new Date().toISOString() } : {}),
    } as any).eq("token", token);

    // If the admin recorded the charge as already paid, there's nothing for
    // the renter to pay — skip the Stripe link + SMS and return.
    if (chargePaid) {
      return {
        token,
        signUrl: "",
        paymentUrl: "",
        additionalAmount,
        collectAmount,
        newEndDate: newEndIso,
        periods: data.periods,
        periodLabel,
        smsSent: false,
        renterPhone: null,
        applied: true as const,
        chargeState: "paid" as const,
      };
    }

    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
    if (originHeader) { try { origin = new URL(originHeader).origin; } catch {} }

    const metadata = {
      kind: "admin_extension",
      rental_id: rental.id,
      extension_token: token,
      periods: String(data.periods),
      period_label: periodLabel,
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — Extend ${data.periods} ${periodLabel}${data.periods === 1 ? "" : "s"}`.slice(0, 250),
      metadata: { rental_id: rental.id, extension_token: token },
    });
    const price = await stripe.prices.create({
      product: product.id, currency: "usd", unit_amount: amountCents,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      after_completion: {
        type: "redirect" as const,
        redirect: { url: `${origin}/extend/${encodeURIComponent(token)}?paid=1` },
      },
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");

    await supabaseAdmin.from("extension_requests").update({
      payment_link_url: link.url,
      stripe_payment_link_id: link.id,
    }).eq("token", token);

    const signUrl = `${origin}/extend/${encodeURIComponent(token)}`;

    // SMS the renter — single link.
    const { data: drv } = await supabaseAdmin
      .from("drivers").select("full_name, phone, email").eq("id", rental.driver_id).maybeSingle();
    let smsSent = false;
    if (drv?.phone) {
      try {
        const periodsLbl = `${data.periods} ${periodLabel}${data.periods === 1 ? "" : "s"}`;
        const amt = `$${collectAmount.toFixed(2)}`;
        await notifyRenter({
          phone: drv.phone,
          email: drv.email ?? null,
          name: drv.full_name,
          sms: `Camauto Rentals: Complete your rental extension (${periodsLbl} · ${amt}): ${signUrl}`,
          emailSubject: "Rental Extension Agreement — Camauto Rentals",
          emailHeading: "Sign Your Rental Extension",
          emailIntro:
            "Review and sign your rental extension below. Signing and payment are completed in one secure step.",
          emailCta: { label: "Sign & Pay Extension", url: signUrl },
          emailDetails: [
            { label: "Extension Length", value: periodsLbl },
            { label: "New End Date", value: newEndIso },
            { label: "Additional Cost", value: amt },
          ],
        });
        smsSent = true;
      } catch (e) {
        console.error("[createExtensionLink] renter SMS failed", e);
      }
    }

    return {
      token,
      signUrl,
      paymentUrl: link.url,
      additionalAmount,
      collectAmount,
      newEndDate: newEndIso,
      periods: data.periods,
      periodLabel,
      smsSent,
      renterPhone: drv?.phone ?? null,
      applied: true as const,
      chargeState: "owed" as const,
    };
  });

/** Public: fetch a safe summary of the extension request for the signing page. */
export const getExtensionLinkPublic = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) throw new Error("Invalid token");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .rpc("get_extension_request_public", { _token: data.token });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };
    return {
      found: true as const,
      token: row.token as string,
      rentalId: row.rental_id as string,
      periods: row.periods as number,
      periodLabel: row.period_label as string,
      previousEndDate: row.previous_end_date as string | null,
      newEndDate: row.new_end_date as string,
      additionalAmount: Number(row.additional_amount ?? 0),
      status: row.status as string,
      expiresAt: row.expires_at as string,
      signedAt: row.signed_at as string | null,
      paidAt: row.paid_at as string | null,
      vehicle: {
        make: row.vehicle_make as string | null,
        model: row.vehicle_model as string | null,
        year: row.vehicle_year as number | null,
        plate: row.vehicle_plate as string | null,
      },
      driverFullName: row.driver_full_name as string | null,
      rate: Number(row.rate ?? row.weekly_rate ?? 0),
      billingPeriod: (row.billing_period as string) || "weekly",
    };
  });

/**
 * Public: renter captures signature + acceptance. We persist the signature on
 * the extension_request row and return the Stripe payment link URL for the
 * renter to complete payment. The webhook applies the extension on payment.
 */
export const signAndPayExtension = createServerFn({ method: "POST" })
  .inputValidator((d: {
    token: string;
    signatureDataUrl: string;
    signedBy: string;
    thirdPartyPayer?: boolean;
    payerIdDataUrl?: string;
    payerPhone?: string;
  }) => {
    if (!d?.token || typeof d.token !== "string") throw new Error("Invalid token");
    if (!d?.signatureDataUrl || !d.signatureDataUrl.startsWith("data:image/")) {
      throw new Error("Signature required");
    }
    if (d.signatureDataUrl.length > 500_000) throw new Error("Signature too large");
    const name = (d.signedBy || "").trim();
    if (!name) throw new Error("Name required");
    if (name.length > 200) throw new Error("Name too long");
    if (d.thirdPartyPayer) {
      if (!d.payerIdDataUrl?.startsWith("data:image/")) throw new Error("Payer's ID photo required");
      if (d.payerPhone && d.payerPhone.length > 30) throw new Error("Invalid payer phone");
    }
    return {
      token: d.token,
      signatureDataUrl: d.signatureDataUrl,
      signedBy: name,
      thirdPartyPayer: !!d.thirdPartyPayer,
      payerIdDataUrl: d.payerIdDataUrl,
      payerPhone: d.payerPhone?.trim() || undefined,
    };
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("extension_requests")
      .select("token, status, expires_at, payment_link_url, paid_at, rental_id")
      .eq("token", data.token)
      .maybeSingle();
    if (error || !row) throw new Error("Extension request not found");
    if (new Date(row.expires_at as string).getTime() < Date.now()) {
      throw new Error("This extension link has expired. Please contact us.");
    }
    if (row.status === "paid" || row.paid_at) {
      throw new Error("This extension has already been paid.");
    }
    if (!row.payment_link_url) throw new Error("Payment link unavailable. Please contact us.");

    // Third-party payer: upload their ID and OCR the name so the webhook
    // can compare it to the Stripe cardholder name during extension payment.
    if (data.thirdPartyPayer && data.payerIdDataUrl && row.rental_id) {
      try {
        const payerIdUrl = await uploadPayerIdImage(String(row.rental_id), data.payerIdDataUrl);
        const payerName = await extractNameFromIdImage(data.payerIdDataUrl);
        if (!payerName) {
          throw new Error("Could not read the name on the payer's ID — please retake the photo");
        }
        await supabaseAdmin.from("rentals").update({
          third_party_payer: true,
          payer_id_image_url: payerIdUrl,
          payer_name_extracted: payerName,
          payer_phone: data.payerPhone || null,
          updated_at: new Date().toISOString(),
        }).eq("id", row.rental_id);
        console.log(`[ext-sign] third-party payer for ${row.rental_id}: name="${payerName}"`);
      } catch (e) {
        console.error(`[ext-sign] payer ID handling failed for ${row.rental_id}:`, e);
        throw e instanceof Error ? e : new Error("Could not process payer's ID — please retry");
      }
    }

    await supabaseAdmin.from("extension_requests").update({
      signature_data_url: data.signatureDataUrl,
      signed_by: data.signedBy,
      signed_at: new Date().toISOString(),
      status: row.status === "paid" ? row.status : "signed",
    }).eq("token", data.token);

    return { paymentUrl: row.payment_link_url as string };
  });