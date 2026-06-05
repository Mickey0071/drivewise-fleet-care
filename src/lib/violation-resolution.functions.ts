import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { buildAffidavitPdf } from "@/lib/ezpass-affidavit.server";
import { getRequestHeader } from "@tanstack/react-start/server";

const ADMIN_PHONE = "267-221-3977";
const AFFIDAVIT_BUCKET = "violation-affidavits";
const RESOLVED_STATUSES = ["paid", "affidavit_signed", "submitted_to_authority", "resolved"];

function genToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtMoney(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

function nameTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1);
}
function namesMatch(typed: string, onFile: string): boolean {
  const a = new Set(nameTokens(typed));
  const lic = nameTokens(onFile);
  if (!a.size || !lic.length) return false;
  if (lic.length >= 2) return a.has(lic[0]) && a.has(lic[lic.length - 1]);
  return a.has(lic[0]);
}

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

async function buildAndStoreAffidavit(
  ctx: ViolationCtx,
  signature: {
    dataUrl: string;
    name: string;
    signedAt: string;
    ip?: string | null;
    userAgent?: string | null;
  } | null,
): Promise<string> {
  const { violation: v, driver, vehicle, rental } = ctx;
  const pdf = await buildAffidavitPdf({
    violationId: v.id,
    violationDate: v.date_issued,
    violationTime: null,
    location: v.description,
    amount: Number(v.total_amount || v.amount || 0),
    plate: v.license_plate,
    vehicle: vehicle ?? null,
    driver: driver ?? null,
    rental: rental ?? null,
    signature,
  });
  const path = signature
    ? `signed/affidavit-${v.id}.pdf`
    : `draft/affidavit-${v.id}.pdf`;
  await (supabaseAdmin as any).storage
    .from(AFFIDAVIT_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  const { data: signed } = await (supabaseAdmin as any).storage
    .from(AFFIDAVIT_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  return signed?.signedUrl ?? "";
}

/** Public: load the violation summary for the customer resolution page. */
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
      signedAt: (row.signed_at as string) ?? null,
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

/** Public: return a fresh signed URL to the (pre-generated) affidavit PDF. */
export const getAffidavitPdfUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
      throw new Error("Invalid token");
    }
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const ctx = await loadByToken(data.token);
    if (ctx.violation.signed_pdf_url) {
      return { url: ctx.violation.signed_pdf_url as string, signed: true };
    }
    const url = await buildAndStoreAffidavit(ctx, null);
    return { url, signed: false };
  });

/** Public: customer reviews + e-signs the affidavit. */
export const signViolationAffidavit = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      signatureDataUrl: string;
      signedName: string;
      acknowledgements: boolean[];
    }) => {
      if (!d?.token || typeof d.token !== "string" || d.token.length < 16) {
        throw new Error("Invalid token");
      }
      if (!d?.signatureDataUrl || !d.signatureDataUrl.startsWith("data:image/")) {
        throw new Error("Signature required");
      }
      if (d.signatureDataUrl.length > 800_000) throw new Error("Signature too large");
      const name = (d.signedName || "").trim();
      if (!name) throw new Error("Name required");
      if (name.length > 200) throw new Error("Name too long");
      if (!Array.isArray(d.acknowledgements) || d.acknowledgements.length < 4 || !d.acknowledgements.every(Boolean)) {
        throw new Error("All acknowledgements must be checked");
      }
      return { token: d.token, signatureDataUrl: d.signatureDataUrl, signedName: name };
    },
  )
  .handler(async ({ data }) => {
    const ctx = await loadByToken(data.token);
    const v = ctx.violation;
    if (RESOLVED_STATUSES.includes(v.status)) {
      throw new Error("This violation has already been resolved.");
    }
    const onFile = ctx.driver?.full_name || "";
    if (onFile && !namesMatch(data.signedName, onFile)) {
      throw new Error("The name you entered does not match the name on file for this rental.");
    }

    const ip =
      (getRequestHeader("x-forwarded-for") || "").split(",")[0].trim() ||
      getRequestHeader("cf-connecting-ip") ||
      getRequestHeader("x-real-ip") ||
      null;
    const userAgent = getRequestHeader("user-agent") || null;
    const signedAt = new Date().toISOString();

    // Save signature image
    let signatureUrl = "";
    try {
      const m = data.signatureDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (m) {
        const buf = Buffer.from(m[2], "base64");
        const sigPath = `signatures/${v.id}.png`;
        await (supabaseAdmin as any).storage
          .from(AFFIDAVIT_BUCKET)
          .upload(sigPath, buf, { contentType: m[1], upsert: true });
        const { data: s } = await (supabaseAdmin as any).storage
          .from(AFFIDAVIT_BUCKET)
          .createSignedUrl(sigPath, 60 * 60 * 24 * 365 * 5);
        signatureUrl = s?.signedUrl ?? "";
      }
    } catch (e) {
      console.error("[signViolationAffidavit] signature save failed", e);
    }

    // Build finalized signed PDF
    const signedPdfUrl = await buildAndStoreAffidavit(ctx, {
      dataUrl: data.signatureDataUrl,
      name: data.signedName,
      signedAt,
      ip,
      userAgent,
    });

    await (supabaseAdmin as any)
      .from("violations")
      .update({
        status: "affidavit_signed",
        resolution_choice: "affidavit",
        signed_at: signedAt,
        signed_name: data.signedName,
        signature_url: signatureUrl,
        signed_ip: ip,
        signed_user_agent: userAgent ? userAgent.slice(0, 400) : null,
        signed_pdf_url: signedPdfUrl,
        updated_at: signedAt,
      } as never)
      .eq("id", v.id);

    await (supabaseAdmin as any).from("violation_status_history").insert({
      violation_id: v.id,
      from_status: v.status,
      to_status: "affidavit_signed",
      reason: `Affidavit e-signed by ${data.signedName}`,
      changed_by_name: data.signedName,
    } as never);

    const amt = fmtMoney(Number(v.total_amount || v.amount || 0));
    // Customer notification (with signed PDF attached)
    try {
      await notifyRenter({
        phone: ctx.driver?.phone ?? null,
        email: ctx.driver?.email ?? null,
        name: ctx.driver?.full_name ?? null,
        sms: "✓ Affidavit signed. Camauto will submit to EZPass on your behalf. — Camauto Rentals",
        emailSubject: "Affidavit Signed — Camauto Rentals",
        emailHeading: "Affidavit Signed",
        emailIntro:
          "Thank you for signing the liability transfer affidavit. Camauto Rentals will submit your information to EZPass. A copy of your signed affidavit is attached.",
        emailDetails: [
          { label: "Violation", value: v.id },
          { label: "Amount", value: amt },
          ...(ctx.vehicle
            ? [{ label: "Vehicle", value: `${ctx.vehicle.year ?? ""} ${ctx.vehicle.make ?? ""} ${ctx.vehicle.model ?? ""}`.trim() }]
            : []),
        ],
        emailAttachments: signedPdfUrl ? [signedPdfUrl] : [],
      });
    } catch (e) {
      console.error("[signViolationAffidavit] customer notify failed", e);
    }
    // Admin notification
    try {
      await notifyRenter({
        phone: ADMIN_PHONE,
        email: null,
        name: "Admin",
        sms: `📝 Affidavit signed: ${ctx.driver?.full_name || "Customer"} - ${v.description || "violation"} ${amt}`,
        emailSubject: "Affidavit signed",
        emailHeading: "Affidavit signed",
        emailIntro: "A customer signed a violation affidavit.",
      });
    } catch (e) {
      console.error("[signViolationAffidavit] admin notify failed", e);
    }

    return { ok: true as const };
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
