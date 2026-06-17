import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { getRequestHeader } from "@tanstack/react-start/server";

const AGREEMENT_VERSION = "v1.0";

function genToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveRates(row: {
  billing_period: string | null;
  rental_rate: number | null;
  rental_weekly_rate: number | null;
  vehicle_daily_rate: number | null;
  vehicle_weekly_rate: number | null;
}): { dailyRate: number; weeklyRate: number } {
  const isDaily = (row.billing_period || "").toLowerCase().startsWith("day");
  let weeklyRate =
    Number(row.rental_weekly_rate ?? 0) ||
    (!isDaily ? Number(row.rental_rate ?? 0) : 0) ||
    Number(row.vehicle_weekly_rate ?? 0);
  let dailyRate =
    (isDaily ? Number(row.rental_rate ?? 0) : 0) ||
    Number(row.vehicle_daily_rate ?? 0) ||
    (weeklyRate ? Math.round((weeklyRate / 7) * 100) / 100 : 0);
  if (!weeklyRate && dailyRate) weeklyRate = Math.round(dailyRate * 7 * 100) / 100;
  return { dailyRate: Number(dailyRate || 0), weeklyRate: Number(weeklyRate || 0) };
}

/** Public: load a safe summary of an auto-extension offer for the customer page. */
export const getAutoExtensionOffer = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin.rpc(
      "get_auto_extension_offer_public",
      { _token: data.token },
    );
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };
    const { dailyRate, weeklyRate } = resolveRates(row as any);
    return {
      found: true as const,
      token: row.token as string,
      offerType: row.offer_type as string,
      status: row.status as string,
      currentEndDate: (row.current_end_date as string) ?? null,
      dailyRate,
      weeklyRate,
      vehicle: {
        make: row.vehicle_make as string | null,
        model: row.vehicle_model as string | null,
        year: row.vehicle_year as number | null,
        plate: row.vehicle_plate as string | null,
      },
      driverFullName: row.driver_full_name as string | null,
    };
  });

/**
 * Public: customer chooses daily/weekly, signs, and is sent to
 * Stripe to pay. We create an extension_requests row + Stripe payment link
 * tagged kind=admin_extension so the existing payments webhook applies the
 * extension, records payment, saves the card, and confirms on payment.
 */
export const submitAutoExtension = createServerFn({ method: "POST" })
  .inputValidator((d: {
    token: string;
    choice: "daily" | "weekly";
    signatureDataUrl: string;
    signedBy: string;
  }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    if (d.choice !== "daily" && d.choice !== "weekly") throw new Error("Choose an extension option");
    if (!d?.signatureDataUrl || !d.signatureDataUrl.startsWith("data:image/")) {
      throw new Error("Signature required");
    }
    if (d.signatureDataUrl.length > 500_000) throw new Error("Signature too large");
    const name = (d.signedBy || "").trim();
    if (!name) throw new Error("Name required");
    if (name.length > 200) throw new Error("Name too long");
    return {
      token: d.token,
      choice: d.choice,
      signatureDataUrl: d.signatureDataUrl,
      signedBy: name,
    };
  })
  .handler(async ({ data }) => {
    // Load offer + rental via the SECURITY DEFINER RPC (validates not expired).
    const { data: rows, error: offErr } = await supabaseAdmin.rpc(
      "get_auto_extension_offer_public",
      { _token: data.token },
    );
    if (offErr) throw new Error(offErr.message);
    const offer = Array.isArray(rows) ? rows[0] : rows;
    if (!offer) throw new Error("This extension link is invalid or has expired.");
    if (offer.status === "consumed") {
      throw new Error("This extension has already been completed.");
    }

    const { dailyRate, weeklyRate } = resolveRates(offer as any);
    const rate = data.choice === "daily" ? dailyRate : weeklyRate;
    if (!rate || rate <= 0) throw new Error("Rate is not configured for this rental.");
    const periodLabel = data.choice === "daily" ? "day" : "week";
    const periods = 1;
    const additionalAmount = Number(rate.toFixed(2));
    const amountCents = Math.round(additionalAmount * 100);

    const baseEnd = offer.current_end_date
      ? new Date(offer.current_end_date as string)
      : new Date();
    const newEnd = new Date(baseEnd);
    if (data.choice === "daily") newEnd.setDate(newEnd.getDate() + 1);
    else newEnd.setDate(newEnd.getDate() + 7);
    const newEndIso = newEnd.toISOString().slice(0, 10);

    const extToken = genToken();
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("extension_requests")
      .insert({
        token: extToken,
        rental_id: offer.rental_id,
        periods,
        period_label: periodLabel,
        previous_end_date: offer.current_end_date ?? null,
        new_end_date: newEndIso,
        additional_amount: additionalAmount,
        status: "signed",
        agreement_version: AGREEMENT_VERSION,
        signature_data_url: data.signatureDataUrl,
        signed_by: data.signedBy,
        signed_at: new Date().toISOString(),
      } as any)
      .select("token")
      .maybeSingle();
    if (insErr || !inserted) {
      throw new Error(insErr?.message || "Failed to create extension request");
    }

    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "https://camautorentals.lovable.app";
    if (originHeader) {
      try {
        origin = new URL(originHeader).origin;
      } catch {}
    }

    const metadata = {
      kind: "admin_extension",
      rental_id: offer.rental_id,
      extension_token: extToken,
      periods: String(periods),
      period_label: periodLabel,
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — Extend 1 ${periodLabel}`,
      metadata: { rental_id: offer.rental_id, extension_token: extToken },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: amountCents,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata, setup_future_usage: "off_session" },
      after_completion: {
        type: "redirect" as const,
        redirect: { url: `${origin}/extend/${encodeURIComponent(extToken)}?paid=1` },
      },
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");

    await supabaseAdmin
      .from("extension_requests")
      .update({ payment_link_url: link.url, stripe_payment_link_id: link.id })
      .eq("token", extToken);

    // Mark the offer consumed + record the customer's choice / auto-pay.
    await supabaseAdmin
      .from("auto_extension_offers")
      .update({
        status: "consumed",
        extension_token: extToken,
        extension_choice: data.choice,
        auto_pay_enabled: false,
        consumed_at: new Date().toISOString(),
      })
      .eq("token", data.token);

    // Notify admin that a customer is completing an extension.
    try {
      const adminPhone = "267-221-3977";
      await notifyRenter({
        phone: adminPhone,
        email: null,
        name: "Admin",
        sms: `Camauto: ${offer.driver_full_name || "Customer"} is extending ${offer.vehicle_year ?? ""} ${offer.vehicle_make ?? ""} ${offer.vehicle_model ?? ""} (${data.choice}).`,
        emailSubject: "Extension in progress",
        emailHeading: "Extension in progress",
        emailIntro: "A customer is completing a rental extension.",
      });
    } catch (e) {
      console.error("[submitAutoExtension] admin notify failed", e);
    }

    return { paymentUrl: link.url, newEndDate: newEndIso, amount: additionalAmount };
  });

/**
 * Public: customer declines the extension. Pauses auto-renew on the rental so
 * no further links or auto-charges go out, flags the rental for a dashboard
 * alert (extension_declined_at), marks the offer declined, and SMSes the admin.
 */
export const declineAutoExtension = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin.rpc(
      "get_auto_extension_offer_public",
      { _token: data.token },
    );
    if (error) throw new Error(error.message);
    const offer = Array.isArray(rows) ? rows[0] : rows;
    if (!offer) throw new Error("This extension link is invalid or has expired.");
    if (offer.status === "consumed") {
      throw new Error("This extension has already been completed.");
    }

    const nowIso = new Date().toISOString();

    // Pause auto-renew + flag for dashboard alert.
    await supabaseAdmin
      .from("rentals")
      .update({
        auto_renew: false,
        extension_declined_at: nowIso,
        updated_at: nowIso,
      } as any)
      .eq("id", offer.rental_id);

    // Mark the offer declined.
    await supabaseAdmin
      .from("auto_extension_offers")
      .update({ status: "declined", consumed_at: nowIso })
      .eq("token", data.token);

    // Notify admin.
    try {
      await notifyRenter({
        phone: "267-221-3977",
        email: null,
        name: "Admin",
        sms: `Camauto: ${offer.driver_full_name || "Customer"} DECLINED to extend ${offer.vehicle_year ?? ""} ${offer.vehicle_make ?? ""} ${offer.vehicle_model ?? ""}. Auto-renew paused — arrange pickup.`,
        emailSubject: "Renter declined to extend",
        emailHeading: "Renter declined to extend",
        emailIntro: "A renter declined their rental extension. Auto-renew has been paused.",
      });
    } catch (e) {
      console.error("[declineAutoExtension] admin notify failed", e);
    }

    return { ok: true as const };
  });