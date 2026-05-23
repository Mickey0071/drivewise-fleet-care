import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

const ADMIN_PHONE = "+12672213977";

type RoleRow = { role: "admin" | "runner" | "driver" | "va" };

async function getRolesAndProfile(userId: string) {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("profiles").select("full_name, first_name, last_name").eq("id", userId).maybeSingle(),
  ]);
  const roleList = ((roles as RoleRow[] | null) ?? []).map((r) => r.role);
  const isAdmin = roleList.includes("admin");
  const isVa = roleList.includes("va");
  const name = profile?.full_name
    || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")
    || "Staff";
  return { isAdmin, isVa, name };
}

async function getRentalContext(rentalId: string) {
  const { data: rental } = await supabaseAdmin
    .from("rentals")
    .select("id, driver_id, stripe_customer_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) throw new Error("Rental not found");
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("full_name, phone")
    .eq("id", rental.driver_id)
    .maybeSingle();
  return { rental, driver };
}

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

/**
 * Process a Stripe refund for the most recent successful PaymentIntent on
 * the rental's Stripe customer that has enough remaining refundable amount.
 */
async function processStripeRefund(opts: { rentalId: string; amount: number }) {
  const { data: rental } = await supabaseAdmin
    .from("rentals")
    .select("stripe_customer_id")
    .eq("id", opts.rentalId)
    .maybeSingle();
  if (!rental?.stripe_customer_id) {
    throw new Error("No Stripe customer on file for this rental — cannot refund automatically.");
  }
  const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
  const stripe = createStripeClient(env);
  const amountCents = Math.round(opts.amount * 100);

  const list = await stripe.paymentIntents.list({
    customer: rental.stripe_customer_id,
    limit: 25,
  });
  const candidate = list.data.find((pi) => {
    if (pi.status !== "succeeded") return false;
    const refundable = (pi.amount_received ?? pi.amount) - (((pi as any).amount_refunded) ?? 0);
    return refundable >= amountCents;
  });
  if (!candidate) {
    throw new Error("No matching succeeded payment with enough refundable balance was found in Stripe.");
  }
  const refund = await stripe.refunds.create({
    payment_intent: candidate.id,
    amount: amountCents,
    metadata: { rental_id: opts.rentalId, source: "va_refund_flow" },
  });
  return {
    refundId: refund.id,
    paymentIntentId: candidate.id,
    chargeId: typeof refund.charge === "string" ? refund.charge : (refund.charge?.id ?? null),
  };
}

/**
 * VA or admin creates a refund request.
 * - VA: request stays pending and management is SMSed for approval.
 * - Admin: refund is processed immediately and marked approved.
 */
export const createRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; amount: number; reason?: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    const amt = Number(d.amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than $0");
    if (amt > 25000) throw new Error("Amount exceeds maximum");
    return { rentalId: d.rentalId, amount: Math.round(amt * 100) / 100, reason: (d.reason ?? "").slice(0, 500) };
  })
  .handler(async ({ data, context }) => {
    const { isAdmin, isVa, name } = await getRolesAndProfile(context.userId);
    if (!isAdmin && !isVa) throw new Error("Not authorized");
    const { rental, driver } = await getRentalContext(data.rentalId);

    const role = isAdmin ? "admin" : "va";
    const insertRow: any = {
      rental_id: rental.id,
      requested_by: context.userId,
      requester_role: role,
      requester_name: name,
      amount: data.amount,
      reason: data.reason || null,
      status: "pending",
    };
    const { data: created, error: insErr } = await supabaseAdmin
      .from("refund_requests")
      .insert(insertRow)
      .select("id")
      .single();
    if (insErr || !created) throw new Error(insErr?.message || "Could not create refund request");

    // Admin path: process immediately.
    if (isAdmin) {
      try {
        const res = await processStripeRefund({ rentalId: rental.id, amount: data.amount });
        await supabaseAdmin.from("refund_requests").update({
          status: "approved",
          decided_by: context.userId,
          decided_at: new Date().toISOString(),
          stripe_payment_intent_id: res.paymentIntentId,
          stripe_charge_id: res.chargeId,
          stripe_refund_id: res.refundId,
        }).eq("id", created.id);
        return { ok: true, status: "approved" as const, id: created.id };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabaseAdmin.from("refund_requests").update({
          status: "failed", error: msg,
          decided_by: context.userId, decided_at: new Date().toISOString(),
        }).eq("id", created.id);
        throw new Error(msg);
      }
    }

    // VA path: notify management for approval.
    const renterLabel = driver?.full_name || rental.driver_id;
    try {
      await sendSms(
        ADMIN_PHONE,
        `Camauto: ${name} (VA) requested refund of ${fmtMoney(data.amount)} for ${renterLabel} (rental ${rental.id})${data.reason ? ` — "${data.reason}"` : ""}. Approve or deny in the Refund Approvals page.`,
        null,
      );
    } catch (e) {
      console.error("[createRefundRequest] admin SMS failed", e);
    }
    return { ok: true, status: "pending" as const, id: created.id };
  });

export const listRefundRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isAdmin, isVa } = await getRolesAndProfile(context.userId);
    if (!isAdmin && !isVa) throw new Error("Not authorized");
    let q = supabaseAdmin
      .from("refund_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!isAdmin) q = q.eq("requested_by", context.userId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rentalIds = Array.from(new Set((data ?? []).map((r) => r.rental_id))).filter(Boolean);
    let rentalMap: Record<string, { driver_id: string }> = {};
    let driverMap: Record<string, { full_name: string | null }> = {};
    if (rentalIds.length) {
      const { data: rentals } = await supabaseAdmin
        .from("rentals").select("id, driver_id").in("id", rentalIds);
      rentalMap = Object.fromEntries((rentals ?? []).map((r) => [r.id, { driver_id: r.driver_id }]));
      const driverIds = Array.from(new Set(Object.values(rentalMap).map((r) => r.driver_id)));
      if (driverIds.length) {
        const { data: drivers } = await supabaseAdmin
          .from("drivers").select("id, full_name").in("id", driverIds);
        driverMap = Object.fromEntries((drivers ?? []).map((d) => [d.id, { full_name: d.full_name }]));
      }
    }
    return {
      requests: (data ?? []).map((r) => ({
        ...r,
        renter_name: driverMap[rentalMap[r.rental_id]?.driver_id ?? ""]?.full_name ?? null,
      })),
    };
  });

export const approveRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { isAdmin, name: adminName } = await getRolesAndProfile(context.userId);
    if (!isAdmin) throw new Error("Only admins can approve refunds");

    const { data: req } = await supabaseAdmin
      .from("refund_requests").select("*").eq("id", data.id).maybeSingle();
    if (!req) throw new Error("Refund request not found");
    if (req.status !== "pending") throw new Error(`Request is already ${req.status}`);

    let res: Awaited<ReturnType<typeof processStripeRefund>>;
    try {
      res = await processStripeRefund({ rentalId: req.rental_id, amount: Number(req.amount) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("refund_requests").update({
        status: "failed", error: msg,
        decided_by: context.userId, decided_at: new Date().toISOString(),
      }).eq("id", req.id);
      throw new Error(msg);
    }

    await supabaseAdmin.from("refund_requests").update({
      status: "approved",
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      stripe_payment_intent_id: res.paymentIntentId,
      stripe_charge_id: res.chargeId,
      stripe_refund_id: res.refundId,
    }).eq("id", req.id);

    // Notify the VA requester.
    try {
      const { data: requesterProfile } = await supabaseAdmin
        .from("profiles").select("phone").eq("id", req.requested_by).maybeSingle();
      if (requesterProfile?.phone) {
        await sendSms(
          requesterProfile.phone,
          `Camauto: Your refund of ${fmtMoney(Number(req.amount))} for rental ${req.rental_id} was APPROVED by ${adminName} and processed.`,
          req.requester_name,
        );
      }
    } catch (e) { console.error("[approveRefundRequest] VA SMS failed", e); }

    return { ok: true };
  });

export const denyRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: d.id, reason: (d.reason ?? "").slice(0, 500) };
  })
  .handler(async ({ data, context }) => {
    const { isAdmin, name: adminName } = await getRolesAndProfile(context.userId);
    if (!isAdmin) throw new Error("Only admins can deny refunds");

    const { data: req } = await supabaseAdmin
      .from("refund_requests").select("*").eq("id", data.id).maybeSingle();
    if (!req) throw new Error("Refund request not found");
    if (req.status !== "pending") throw new Error(`Request is already ${req.status}`);

    await supabaseAdmin.from("refund_requests").update({
      status: "denied",
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      denial_reason: data.reason || null,
    }).eq("id", req.id);

    try {
      const { data: requesterProfile } = await supabaseAdmin
        .from("profiles").select("phone").eq("id", req.requested_by).maybeSingle();
      if (requesterProfile?.phone) {
        await sendSms(
          requesterProfile.phone,
          `Camauto: Your refund request of ${fmtMoney(Number(req.amount))} for rental ${req.rental_id} was DENIED by ${adminName}${data.reason ? ` — "${data.reason}"` : ""}.`,
          req.requester_name,
        );
      }
    } catch (e) { console.error("[denyRefundRequest] VA SMS failed", e); }

    return { ok: true };
  });