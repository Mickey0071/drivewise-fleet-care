import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook, createStripeClient } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";
import { sendReceiptToCustomer } from "@/lib/receipt.functions";
import { notifyRenter } from "@/lib/renter-notify.server";
import { decideNameMatch } from "@/lib/nickname-dictionary";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

async function getProfile(
  userId: string | null,
): Promise<{ phone: string | null; full_name: string | null } | null> {
  if (!userId) return null;
  const { data } = await getSupabase()
    .from("profiles")
    .select("phone, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

function fmtAmount(cents: number | null | undefined): string {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

// Persist the reusable Stripe customer + card on the driver record so the
// card can be charged later (violations, extensions, etc.).
async function saveCardToDriver(
  driverId: string | null | undefined,
  env: StripeEnv,
  customerId: string | null | undefined,
  paymentMethodId: string | null | undefined,
): Promise<void> {
  if (!driverId) return;
  if (!customerId && !paymentMethodId) return;
  const stripe = createStripeClient(env);
  const sb = getSupabase();

  // Load the driver so we can reuse an existing Stripe customer if present.
  const { data: driver } = await sb
    .from("drivers")
    .select("stripe_customer_id, full_name, email, phone")
    .eq("id", driverId)
    .maybeSingle();

  // 1+2. Resolve the driver's reusable Stripe customer: existing → the one
  // from this checkout → create a brand new one.
  let resolvedCustomerId: string | null =
    driver?.stripe_customer_id || customerId || null;
  if (!resolvedCustomerId) {
    try {
      const created = await stripe.customers.create({
        ...(driver?.email ? { email: driver.email } : {}),
        ...(driver?.full_name ? { name: driver.full_name } : {}),
        ...(driver?.phone ? { phone: driver.phone } : {}),
        metadata: { driver_id: driverId },
      });
      resolvedCustomerId = created.id;
    } catch (e) {
      console.warn("[webhook] could not create Stripe customer for driver", e);
    }
  }

  // 3. Attach the payment method to the driver's customer so it can be
  // charged off-session later (violations, extensions, etc.), then read the
  // card's last4 for display.
  let last4: string | null = null;
  let brand: string | null = null;
  let expMonth: number | null = null;
  let expYear: number | null = null;
  if (paymentMethodId) {
    if (resolvedCustomerId) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: resolvedCustomerId,
        });
        // Make it the default for future off-session invoices/charges.
        await stripe.customers.update(resolvedCustomerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      } catch (e: any) {
        // Already attached to this customer is fine; log anything else.
        if (e?.code !== "resource_already_exists") {
          console.warn("[webhook] could not attach payment method to driver customer", e);
        }
      }
    }
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      last4 = pm.card?.last4 ?? null;
      brand = pm.card?.brand ?? null;
      expMonth = pm.card?.exp_month ?? null;
      expYear = pm.card?.exp_year ?? null;
    } catch (e) {
      console.warn("[webhook] could not load card last4 for driver", e);
    }
  }

  // 4. Persist the reusable card details on the driver record.
  await sb
    .from("drivers")
    .update({
      ...(resolvedCustomerId ? { stripe_customer_id: resolvedCustomerId } : {}),
      ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
      ...(last4 ? { card_last4: last4 } : {}),
      ...(brand ? { card_brand: brand } : {}),
      ...(expMonth ? { card_exp_month: expMonth } : {}),
      ...(expYear ? { card_exp_year: expYear } : {}),
      card_saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", driverId);
}

// --- Name match helpers --------------------------------------------------
function normalizeName(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(mr|mrs|ms|miss|dr|jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function nameTokens(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length > 1);
}
/**
 * Returns 1.0 if every license token (>=2 chars) appears in the cardholder
 * name, 0 if none do, partial otherwise. First + last must both match for a
 * pass (score >= 0.66 with both first and last token present).
 */
function nameMatchScore(cardName: string, licenseName: string): number {
  const card = nameTokens(cardName);
  const lic = nameTokens(licenseName);
  if (!card.length || !lic.length) return 0;
  const cardSet = new Set(card);
  let hits = 0;
  for (const t of lic) if (cardSet.has(t)) hits++;
  return hits / lic.length;
}
function namesMatch(cardName: string, licenseName: string): boolean {
  const score = nameMatchScore(cardName, licenseName);
  if (score >= 0.99) return true;
  // Require first + last token match (positions 0 and last of license).
  const lic = nameTokens(licenseName);
  const card = new Set(nameTokens(cardName));
  if (lic.length >= 2 && card.has(lic[0]) && card.has(lic[lic.length - 1])) return true;
  return false;
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId || null;
  const rentalId = session.metadata?.rental_id || null;
  const kind =
    session.metadata?.kind || (session.mode === "subscription" ? "subscription" : "deposit");

  async function resolveSessionPaymentMethodId(): Promise<string | null> {
    const stripe = createStripeClient(env);
    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
      return typeof pi.payment_method === "string"
        ? pi.payment_method
        : (pi.payment_method?.id ?? null);
    }
    return null;
  }

  // Custom renter-initiated payment (extensions, violations, etc.).
  // Just log a payment row and notify; do NOT touch reservation/vehicle state.
  if (kind === "custom_renter_payment" && rentalId) {
    const sb = getSupabase();
    const note =
      (session.metadata?.note as string | undefined)?.slice(0, 200) || "Additional payment";
    const amountCents = session.amount_total ?? 0;
    const amountDollars = Number((amountCents / 100).toFixed(2));
    const today = new Date().toISOString().slice(0, 10);
    const violationId = (session.metadata?.violation_id as string | undefined) || null;
    if (violationId) {
      await sb
        .from("violations")
        .update({
          status: "paid",
          payment_method: "payment_link",
          paid_at: new Date().toISOString(),
        })
        .eq("id", violationId);
    }
    let paymentMethodId: string | null = null;
    try {
      paymentMethodId = await resolveSessionPaymentMethodId();
    } catch (e) {
      console.error("[webhook:custom] failed to load PaymentIntent payment method", e);
    }

    const { data: rentalRow } = await sb
      .from("rentals")
      .select("id, driver_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (rentalRow) {
      const paidId = `PM-${session.id.slice(-10)}`;
      await sb.from("payments").upsert(
        {
          id: paidId,
          rental_id: rentalRow.id,
          driver_id: rentalRow.driver_id,
          amount: amountDollars,
          due_date: today,
          paid_date: today,
          method: "Stripe",
          status: "paid",
          note,
        } as any,
        { onConflict: "id" },
      );

      // Renter SMS
      const { data: drv } = await sb
        .from("drivers")
        .select("full_name, phone, email")
        .eq("id", rentalRow.driver_id)
        .maybeSingle();
      if (drv?.phone) {
        await notifyRenter({
          phone: drv.phone,
          email: drv.email ?? null,
          name: drv.full_name,
          sms: `Camauto Rentals: Payment of ${fmtAmount(amountCents)} received. Thank you.`,
          emailSubject: "Payment Received — Camauto Rentals",
          emailHeading: "Payment Received",
          emailIntro: `We have received your payment of <strong>${fmtAmount(amountCents)}</strong>. Thank you!`,
          emailDetails: [
            { label: "Amount", value: fmtAmount(amountCents) },
            ...(note ? [{ label: "Note", value: note }] : []),
          ],
        });
      }
      await sb.from("subscriptions").insert({
        user_id: userId,
        rental_id: rentalRow.id,
        stripe_customer_id: session.customer,
        stripe_session_id: session.id,
        kind: "custom_renter_payment",
        amount_cents: amountCents,
        status: "paid",
        environment: env,
      } as any);

      if (session.customer || paymentMethodId) {
        await sb
          .from("rentals")
          .update({
            ...(session.customer ? { stripe_customer_id: session.customer } : {}),
            ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", rentalRow.id);
        await saveCardToDriver(rentalRow.driver_id, env, session.customer, paymentMethodId);
      }
    }
    return;
  }

  // Renter-initiated extension purchase: apply the extension after payment.
  // Admin-initiated extension link uses the same flow but pulls the
  // pre-computed end date, signature, and amount from extension_requests.
  if ((kind === "renter_extension" || kind === "admin_extension") && rentalId) {
    const sb = getSupabase();
    const periods = Math.max(1, Math.min(60, parseInt(session.metadata?.periods || "1", 10) || 1));
    const amountCents = session.amount_total ?? 0;
    const amountDollars = Number((amountCents / 100).toFixed(2));
    const today = new Date().toISOString().slice(0, 10);

    // -------- Cardholder-name validation (extensions) --------
    // Same posture as the initial-payment flow above: compare Stripe
    // billing_details.name to either the third-party payer's ID name
    // (when present on the rental) or the renter's license name. On
    // mismatch, refund and abort — do NOT apply the extension.
    const extStripe = createStripeClient(env);
    let extCardName = "";
    let extChargeId: string | null = null;
    try {
      const piId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (piId) {
        const pi = await extStripe.paymentIntents.retrieve(piId, {
          expand: ["latest_charge", "payment_method"],
        });
        const ch: any =
          pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
        extCardName =
          ch?.billing_details?.name || (pi as any).payment_method?.billing_details?.name || "";
        extChargeId = ch?.id ?? null;
      }
    } catch (e) {
      console.error("[webhook:ext] failed to load PaymentIntent for name check", e);
    }
    const { data: extRentalPre } = await sb
      .from("rentals")
      .select("id, driver_id, third_party_payer, payer_name_extracted, payer_phone")
      .eq("id", rentalId)
      .maybeSingle();
    let extLicenseName = "";
    let extNameSource: "license" | "payer_id" = "license";
    if (extRentalPre?.third_party_payer && extRentalPre?.payer_name_extracted) {
      extLicenseName = String(extRentalPre.payer_name_extracted);
      extNameSource = "payer_id";
    } else if (extRentalPre?.driver_id) {
      const { data: drv } = await sb
        .from("drivers")
        .select("full_name, first_name, last_name")
        .eq("id", extRentalPre.driver_id)
        .maybeSingle();
      extLicenseName =
        drv?.full_name || [drv?.first_name, drv?.last_name].filter(Boolean).join(" ") || "";
    }
    // Hybrid name matching: dictionary/exact → approve, fuzzy >=0.75 → approve,
    // 0.5-0.75 → admin review (flagged, extension still applied), <0.5 → refund.
    const extDecision =
      extCardName && extLicenseName ? decideNameMatch(extCardName, extLicenseName) : null;
    const extScore = extDecision?.score ?? 0;
    if (extDecision && extDecision.action === "refund") {
      console.warn(
        `[webhook:ext] name mismatch rental=${rentalId} card="${extCardName}" ${extNameSource}="${extLicenseName}" score=${extScore}`,
      );
      try {
        if (extChargeId) await extStripe.refunds.create({ charge: extChargeId });
      } catch (e) {
        console.error("[webhook:ext] refund failed", e);
      }
      // Mark extension request as refunded.
      const extToken2 = session.metadata?.extension_token as string | undefined;
      if (extToken2) {
        await sb
          .from("extension_requests")
          .update({
            status: "refunded_name_mismatch",
            name_match_status: "mismatched",
            name_match_score: extScore,
            cardholder_name: extCardName,
            stripe_session_id: session.id,
          })
          .eq("token", extToken2);
      }
      const mismatchMsg =
        extNameSource === "payer_id"
          ? `Camauto Rentals: Extension payment refunded — the card name (${extCardName}) doesn't match the payer's ID (${extLicenseName}). Please retry with a matching card.`
          : `Camauto Rentals: Extension payment refunded — the card name (${extCardName}) doesn't match your driver's license (${extLicenseName}). Please retry with a card in your name.`;
      if (extRentalPre?.driver_id) {
        const { data: drv } = await sb
          .from("drivers")
          .select("full_name, phone, email")
          .eq("id", extRentalPre.driver_id)
          .maybeSingle();
        if (drv?.phone) {
          await notifyRenter({
            phone: drv.phone,
            email: drv.email ?? null,
            name: drv.full_name,
            sms: mismatchMsg,
            emailSubject: "Extension Payment Refunded — Camauto Rentals",
            emailHeading: "Extension Payment Refunded",
            emailIntro: mismatchMsg,
          });
        }
      }
      if (extRentalPre?.third_party_payer && extRentalPre?.payer_phone) {
        try {
          await sendSms(String(extRentalPre.payer_phone), mismatchMsg, null);
        } catch {}
      }
      return;
    }
    // -------- end extension name validation --------

    // For admin links, look up the request row (carries signature + new_end).
    const extToken = session.metadata?.extension_token as string | undefined;
    let extReqRow: any = null;
    if (kind === "admin_extension" && extToken) {
      const { data: er } = await sb
        .from("extension_requests")
        .select(
          "token, periods, period_label, new_end_date, previous_end_date, additional_amount, signature_data_url, signed_by, signed_at, agreement_version",
        )
        .eq("token", extToken)
        .maybeSingle();
      extReqRow = er;
    }

    const { data: rentalRow } = await sb
      .from("rentals")
      .select("id, driver_id, vehicle_id, end_date, billing_period, rate, weekly_rate")
      .eq("id", rentalId)
      .maybeSingle();
    if (rentalRow) {
      const periodLabel =
        (extReqRow?.period_label as string) ||
        (session.metadata?.period_label as string) ||
        (rentalRow.billing_period as string) ||
        "weekly";
      let newEndIso: string;
      if (extReqRow?.new_end_date) {
        newEndIso = String(extReqRow.new_end_date).slice(0, 10);
      } else {
        const baseEnd = rentalRow.end_date ? new Date(rentalRow.end_date as string) : new Date();
        const newEnd = new Date(baseEnd);
        const lbl = periodLabel.toLowerCase();
        if (lbl.startsWith("day")) newEnd.setDate(newEnd.getDate() + periods);
        else if (lbl.startsWith("month")) newEnd.setMonth(newEnd.getMonth() + periods);
        else newEnd.setDate(newEnd.getDate() + periods * 7);
        newEndIso = newEnd.toISOString().slice(0, 10);
      }

      // Record payment row
      const paidId = `PM-${session.id.slice(-10)}`;
      await sb.from("payments").upsert(
        {
          id: paidId,
          rental_id: rentalRow.id,
          driver_id: rentalRow.driver_id,
          amount: amountDollars,
          due_date: today,
          paid_date: today,
          method: "Stripe",
          status: "paid",
          note: `Extension: +${periods} ${periodLabel.replace(/ly$/, "")}${periods === 1 ? "" : "s"}`,
        } as any,
        { onConflict: "id" },
      );

      // Record extension row (copy signature when admin link).
      const extRowId = `EXT-${session.id.slice(-10)}`;
      await sb.from("rental_extensions").upsert(
        {
          id: extRowId,
          rental_id: rentalRow.id,
          previous_end_date: extReqRow?.previous_end_date ?? rentalRow.end_date,
          new_end_date: newEndIso,
          periods,
          period_label: periodLabel,
          additional_amount: amountDollars,
          payment_id: paidId,
          signature_data_url: extReqRow?.signature_data_url ?? null,
          signed_by: extReqRow?.signed_by ?? null,
          agreement_version: extReqRow?.agreement_version ?? null,
        } as any,
        { onConflict: "id" },
      );

      // Mark extension_request as paid.
      if (extToken) {
        await sb
          .from("extension_requests")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_session_id: session.id,
            payment_id: paidId,
            rental_extension_id: extRowId,
            name_match_status: extDecision ? extDecision.status : "unverified",
            name_match_score: extScore || null,
            cardholder_name: extCardName || null,
          })
          .eq("token", extToken);
      }

      // Update the existing rental record in place with the new end date.
      // (We never create a separate rental record for an extension.)
      const prevEndIso = rentalRow.end_date ? String(rentalRow.end_date).slice(0, 10) : null;
      console.log(
        `[webhook:ext] Extending rental ${rentalRow.id}: end_date ${prevEndIso ?? "open-ended"} -> ${newEndIso} (+${periods} ${periodLabel})`,
      );
      await sb
        .from("rentals")
        .update({
          end_date: newEndIso,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rentalRow.id);

      // Persist the reusable card on the rental + driver for future charges.
      let extPaymentMethodId: string | null = null;
      try {
        extPaymentMethodId = await resolveSessionPaymentMethodId();
      } catch (e) {
        console.error("[webhook:ext] failed to resolve payment method", e);
      }
      if (session.customer || extPaymentMethodId) {
        await sb
          .from("rentals")
          .update({
            ...(session.customer ? { stripe_customer_id: session.customer } : {}),
            ...(extPaymentMethodId ? { stripe_payment_method_id: extPaymentMethodId } : {}),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", rentalRow.id);
        await saveCardToDriver(rentalRow.driver_id, env, session.customer, extPaymentMethodId);
      }

      // Renter SMS
      const { data: drv } = await sb
        .from("drivers")
        .select("full_name, phone, email")
        .eq("id", rentalRow.driver_id)
        .maybeSingle();
      if (drv?.phone) {
        await notifyRenter({
          phone: drv.phone,
          email: drv.email ?? null,
          name: drv.full_name,
          sms: `Camauto Rentals: Extension signed and processed. Rental extended to ${newEndIso}. Charged: ${fmtAmount(amountCents)}. Thank you!`,
          emailSubject: "Extension Confirmed — Camauto Rentals",
          emailHeading: "Your Rental Extension is Confirmed",
          emailIntro:
            "Your extension has been signed and processed. Your rental has been extended successfully.",
          emailDetails: [
            { label: "Extended To", value: newEndIso },
            { label: "Length", value: `${periods} ${periodLabel}${periods === 1 ? "" : "s"}` },
            { label: "Charged", value: fmtAmount(amountCents) },
          ],
        });
      }
      await sb.from("subscriptions").insert({
        user_id: userId,
        rental_id: rentalRow.id,
        stripe_customer_id: session.customer,
        stripe_session_id: session.id,
        kind,
        amount_cents: amountCents,
        status: "paid",
        environment: env,
      } as any);
    }
    return;
  }

  // Any one-time checkout linked to a rental activates that reservation.
  // (kind may be "deposit", "payment_link", or "first_payment" — all are
  // treated as the first weekly payment when rental_id is present.)
  if (rentalId && kind !== "subscription" && kind !== "weekly_subscription") {
    const sb = getSupabase();

    // -------- Cardholder-name vs license-name validation --------
    // Pull the PaymentIntent + Charge to get billing_details.name and the
    // PaymentMethod id we'll persist for future charges.
    const stripe = createStripeClient(env);
    let cardholderName = "";
    let paymentMethodId: string | null = null;
    let chargeId: string | null = null;
    try {
      const piId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (piId) {
        const pi = await stripe.paymentIntents.retrieve(piId, {
          expand: ["latest_charge", "payment_method"],
        });
        const charge: any =
          pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
        cardholderName =
          charge?.billing_details?.name || (pi as any).payment_method?.billing_details?.name || "";
        paymentMethodId =
          typeof pi.payment_method === "string"
            ? pi.payment_method
            : (pi.payment_method?.id ?? null);
        chargeId = charge?.id ?? null;
      }
    } catch (e) {
      console.error("[webhook] failed to load PaymentIntent for name check", e);
    }

    // Look up the renter's license name.
    const { data: rentalPre } = await sb
      .from("rentals")
      .select("id, driver_id, third_party_payer, payer_name_extracted, payer_phone")
      .eq("id", rentalId)
      .maybeSingle();
    let licenseName = "";
    let nameSource: "license" | "payer_id" = "license";
    if (rentalPre?.third_party_payer && rentalPre?.payer_name_extracted) {
      licenseName = String(rentalPre.payer_name_extracted);
      nameSource = "payer_id";
    } else if (rentalPre?.driver_id) {
      const { data: drv } = await sb
        .from("drivers")
        .select("full_name, first_name, last_name")
        .eq("id", rentalPre.driver_id)
        .maybeSingle();
      licenseName =
        drv?.full_name || [drv?.first_name, drv?.last_name].filter(Boolean).join(" ") || "";
    }

    // Hybrid name matching: dictionary/exact → approve (no alert), fuzzy
    // >=0.75 → approve, 0.5-0.75 → admin review (flagged, rental still
    // activates), <0.5 → auto-refund.
    const decision =
      cardholderName && licenseName ? decideNameMatch(cardholderName, licenseName) : null;
    const score = decision?.score ?? 0;

    if (decision && decision.action === "refund") {
      // Mismatch — refund the charge, do NOT activate the rental.
      console.warn(
        `[webhook] name mismatch rental=${rentalId} card="${cardholderName}" ${nameSource}="${licenseName}" score=${score}`,
      );
      try {
        if (chargeId) await stripe.refunds.create({ charge: chargeId });
      } catch (e) {
        console.error("[webhook] refund failed", e);
      }
      await sb
        .from("rentals")
        .update({
          cardholder_name: cardholderName,
          name_match_status: "mismatched",
          name_match_score: score,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rentalId);
      await sb.from("subscriptions").insert({
        user_id: userId,
        rental_id: rentalId,
        stripe_customer_id: session.customer,
        stripe_session_id: session.id,
        kind: "refunded_name_mismatch",
        amount_cents: session.amount_total ?? null,
        status: "refunded",
        environment: env,
      } as any);

      const profile = await getProfile(userId);
      const mismatchMsg =
        nameSource === "payer_id"
          ? `Rentalprise Auto: Payment refunded — the card name (${cardholderName}) doesn't match the payer's ID (${licenseName}). Please retry with a matching card.`
          : `Rentalprise Auto: Your payment was refunded — the card name (${cardholderName}) doesn't match your driver's license (${licenseName}). Please retry with a card in your name.`;
      if (profile?.phone) {
        await sendSms(profile.phone, mismatchMsg, profile.full_name);
      }
      // Also notify the third-party payer when their card was used.
      if (rentalPre?.third_party_payer && rentalPre?.payer_phone) {
        try {
          await sendSms(String(rentalPre.payer_phone), mismatchMsg, null);
        } catch {}
      }
      return;
    }
    // -------- end name validation --------

    // Record the payment in the subscriptions ledger for accounting.
    await getSupabase()
      .from("subscriptions")
      .insert({
        user_id: userId,
        rental_id: rentalId,
        stripe_customer_id: session.customer,
        stripe_session_id: session.id,
        kind: kind || "first_payment",
        amount_cents: session.amount_total ?? null,
        status: "paid",
        environment: env,
      } as any);

    if (session.customer || paymentMethodId) {
      await sb
        .from("rentals")
        .update({
          ...(session.customer ? { stripe_customer_id: session.customer } : {}),
          ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", rentalId);
    }

    // Flip the reservation to active and mark vehicle rented.
    const { data: rental } = await sb
      .from("rentals")
      .select(
        "id, vehicle_id, driver_id, start_date, billing_period, rate, weekly_rate, reservation_status, payment_received",
      )
      .eq("id", rentalId)
      .maybeSingle();

    if (rental) {
      await sb
        .from("rentals")
        .update({
          payment_received: true,
          reservation_status: "active",
          activated_at: new Date().toISOString(),
          pending_created_at: null,
          stripe_customer_id: session.customer ?? null,
          stripe_payment_method_id: paymentMethodId,
          cardholder_name: cardholderName || null,
          name_match_status: decision ? decision.status : "unverified",
          name_match_score: score || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rental.id);

      await saveCardToDriver(rental.driver_id, env, session.customer ?? null, paymentMethodId);

      if (rental.vehicle_id) {
        await sb.from("vehicles").update({ status: "rented" }).eq("id", rental.vehicle_id);
      }

      // Record the first weekly payment as paid; schedule next due one period out.
      const period = (rental.billing_period as string) || "weekly";
      const start = new Date(
        (rental.start_date as string) || new Date().toISOString().slice(0, 10),
      );
      const next = new Date(start);
      if (period === "daily") next.setDate(next.getDate() + 1);
      else if (period === "monthly") next.setMonth(next.getMonth() + 1);
      else next.setDate(next.getDate() + 7);
      const amount = Number(rental.rate ?? rental.weekly_rate ?? 0);
      const today = new Date().toISOString().slice(0, 10);
      const paidId = `PM-${session.id.slice(-10)}`;
      // First payment row (already paid via Stripe).
      await sb.from("payments").upsert(
        {
          id: paidId,
          rental_id: rental.id,
          driver_id: rental.driver_id,
          amount,
          due_date: today,
          paid_date: today,
          method: "Stripe",
          status: "paid",
        } as any,
        { onConflict: "id" },
      );
      // Next scheduled payment (only if none already exists past today).
      const { data: upcoming } = await sb
        .from("payments")
        .select("id")
        .eq("rental_id", rental.id)
        .gt("due_date", today)
        .limit(1);
      if (!upcoming?.length) {
        await sb.from("payments").insert({
          id: `PM-${rental.id.slice(-6)}-${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
          rental_id: rental.id,
          driver_id: rental.driver_id,
          amount,
          due_date: next.toISOString().slice(0, 10),
          status: "late",
        } as any);
      }
    }

    let vehicleInfo = "";
    if (rental?.vehicle_id) {
      const { data: v } = await sb
        .from("vehicles")
        .select("year, make, model")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (v) {
        vehicleInfo = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
      }
    }

    const profile = await getProfile(userId);
    if (profile?.phone) {
      const amt = fmtAmount(session.amount_total);
      const rentalLabel = `R-${rentalId.slice(-3).toUpperCase()}`;
      const vehicleLine = vehicleInfo ? ` Vehicle: ${vehicleInfo}.` : "";
      await notifyRenter({
        phone: profile.phone,
        email: (profile as any).email ?? null,
        name: profile.full_name,
        sms: `Payment received! Your rental ${rentalLabel} is active.${vehicleLine} Questions? 866-625-5550`,
        emailSubject: "Payment Received — Your Rental Is Active",
        emailHeading: "Your Rental Is Active!",
        emailIntro: `Your payment of <strong>${amt || "$0.00"}</strong> has been received and your rental <strong>${rentalLabel}</strong> is now active.${vehicleLine ? ` Your vehicle is the ${vehicleInfo}.` : ""}`,
        emailDetails: amt ? [{ label: "Amount Paid", value: amt }] : [],
        emailFootnote: "A receipt will arrive in your inbox shortly. Questions? Call us at 866-625-5550.",
      });
    }

    // Notify the third-party payer when their card was used.
    if (rentalPre?.third_party_payer && rentalPre?.payer_phone) {
      try {
        const amt = fmtAmount(session.amount_total);
        const renterLabel = profile?.full_name || "the renter";
        await sendSms(
          String(rentalPre.payer_phone),
          `Camauto Rentals: Payment processed${amt ? " (" + amt + ")" : ""} for ${renterLabel}'s rental. Thank you!`,
          null,
        );
      } catch (e) {
        console.error("[webhook] payer SMS failed", e);
      }
    }

    // Generate & deliver the payment receipt PDF (fire-and-forget; never throws).
    try {
      await sendReceiptToCustomer({
        data: {
          rentalId,
          paymentAmountCents: session.amount_total ?? undefined,
          paymentMethod: "Stripe",
          paymentReference: session.id,
        },
      });
    } catch (e) {
      console.error(`[receipt] rental=${rentalId} delivery failed`, e);
    }
  }
}

async function handleSubscriptionCreated(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId || null;
  const rentalId = subscription.metadata?.rental_id || null;
  const item = subscription.items?.data?.[0];
  const priceId =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId =
    typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        rental_id: rentalId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        product_id: productId,
        price_id: priceId,
        kind: "subscription",
        amount_cents: item?.price?.unit_amount ?? null,
        status: subscription.status,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        environment: env,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "stripe_subscription_id" },
    );

  const profile = await getProfile(userId);
  if (profile?.phone) {
    const amt = fmtAmount(item?.price?.unit_amount);
    await sendSms(
      profile.phone,
      `Rentalprise Auto: Your rental subscription is active${amt ? " (" + amt + ")" : ""}. Welcome aboard!`,
      profile.full_name,
    );
  }
}

async function handleSubscriptionUpdated(subscription: any, env: StripeEnv) {
  const item = subscription.items?.data?.[0];
  const priceId =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId =
    typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  // Detect a cancel-at-period-end transition by comparing to the existing row.
  const { data: existing } = await getSupabase()
    .from("subscriptions")
    .select("user_id, cancel_at_period_end")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await getSupabase()
    .from("subscriptions")
    .update({
      status: subscription.status,
      product_id: productId,
      price_id: priceId,
      amount_cents: item?.price?.unit_amount ?? null,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  const justCanceled = !existing?.cancel_at_period_end && subscription.cancel_at_period_end;
  if (justCanceled) {
    const profile = await getProfile(existing?.user_id || null);
    if (profile?.phone) {
      const endsAt = periodEnd
        ? new Date(periodEnd * 1000).toLocaleDateString("en-US")
        : "the end of your current period";
      await sendSms(
        profile.phone,
        `Rentalprise Auto: Your subscription has been canceled. You'll retain access until ${endsAt}.`,
        profile.full_name,
      );
    }
  }
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  // Cancel = end at period end. Stripe fires this when the period actually ends.
  await getSupabase()
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    } as any)
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

// Safety net: a successful PaymentIntent (for a one-time rental deposit/payment)
// always activates its reservation, idempotently. This guarantees activation
// even if the `checkout.session.completed` handler errored midway or a duplicate
// event left the rental in a partial state. It never re-activates a rental that
// was refunded for a cardholder-name mismatch.
async function handlePaymentIntentSucceeded(pi: any, env: StripeEnv) {
  const rentalId = pi?.metadata?.rental_id || null;
  const kind = pi?.metadata?.kind || "deposit";
  if (!rentalId) return;
  // Only one-time rental payments; subscriptions/extensions/custom flows are
  // handled by their own events and must not be touched here.
  if (kind === "subscription" || kind === "weekly_subscription") return;
  if (kind === "renter_extension" || kind === "admin_extension") return;
  if (kind === "custom_renter_payment") return;

  const sb = getSupabase();
  const { data: rental } = await sb
    .from("rentals")
    .select("id, vehicle_id, reservation_status, payment_received, name_match_status")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return;

  // Respect the name-mismatch refund decision — never override it.
  if (rental.name_match_status === "mismatched") return;
  // Already activated (or canceled) — nothing to do; keep this idempotent.
  if (rental.reservation_status === "active" && rental.payment_received) return;
  if (rental.reservation_status === "canceled") return;
  if (rental.reservation_status !== "pending") return;

  console.warn(
    `[webhook:pi] safety-net activation rental=${rentalId} (was ${rental.reservation_status})`,
  );
  await sb
    .from("rentals")
    .update({
      payment_received: true,
      reservation_status: "active",
      activated_at: new Date().toISOString(),
      pending_created_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rental.id)
    .eq("reservation_status", "pending");

  if (rental.vehicle_id) {
    await sb.from("vehicles").update({ status: "rented" }).eq("id", rental.vehicle_id);
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object, env);
      break;
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object, env);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
