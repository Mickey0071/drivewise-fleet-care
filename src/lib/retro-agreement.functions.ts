import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";
import { renderRentalAgreementPdf, type RentalAgreementPDFData } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";

/** Admin cell that receives retroactive-agreement notifications. */
const ADMIN_SMS = "267-221-3977";

export interface ViolationSearchCard {
  source: "live" | "migrated";
  /** rental id (live) or legacy uuid (migrated) */
  id: string;
  customerName: string;
  vehicleLabel: string;
  plate: string | null;
  startDate: string | null;
  endDate: string | null;
  isMigration: boolean;
  hasAgreement: boolean;
  agreementUrl: string | null;
  driverId: string | null;
  vehicleId: string | null;
  phone: string | null;
  email: string | null;
  retroSentAt: string | null;
  retroSignedAt: string | null;
}

function vehicleLabelFromText(year: string | null, vehicle: string | null, plate: string | null): string {
  const base = [year, vehicle].filter(Boolean).join(" ").trim();
  return base || (plate ? `Plate ${plate}` : "Vehicle on file");
}

/**
 * Search live + migrated (legacy) rentals by violation date and/or plate.
 * - date only  → rentals active that day
 * - plate only → all rentals for that vehicle, newest first
 * - both       → rentals matching both
 */
export const searchRentalsForViolation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { date?: string | null; plate?: string | null }) => {
    const date = (input.date || "").trim();
    const plate = (input.plate || "").trim().toUpperCase();
    if (!date && !plate) throw new Error("Enter a date or a license plate");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
    return { date: date || null, plate: plate || null };
  })
  .handler(async ({ data }): Promise<ViolationSearchCard[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { date, plate } = data;
    const cards: ViolationSearchCard[] = [];

    // ---- Live rentals ----
    let vehicleIds: string[] | null = null;
    let vMap = new Map<string, { plate: string; make: string; model: string; year: number }>();
    if (plate) {
      const { data: vehicles } = await supabaseAdmin
        .from("vehicles")
        .select("id, plate, make, model, year")
        .ilike("plate", plate);
      vehicleIds = (vehicles ?? []).map((v) => v.id);
      vMap = new Map((vehicles ?? []).map((v) => [v.id, v]));
    }

    if (!plate || (vehicleIds && vehicleIds.length > 0)) {
      let q = supabaseAdmin
        .from("rentals")
        .select(
          "id, driver_id, vehicle_id, start_date, end_date, agreement_pdf_url, client_signature_url, reservation_status",
        )
        .order("start_date", { ascending: false })
        .limit(100);
      if (vehicleIds) q = q.in("vehicle_id", vehicleIds);
      if (date) q = q.lte("start_date", date);
      const { data: rentals } = await q;
      let live = rentals ?? [];
      if (date) live = live.filter((r) => !r.end_date || r.end_date >= date);

      const needVehicleIds = Array.from(
        new Set(live.map((r) => r.vehicle_id).filter((id) => id && !vMap.has(id))),
      ) as string[];
      if (needVehicleIds.length) {
        const { data: vehicles } = await supabaseAdmin
          .from("vehicles")
          .select("id, plate, make, model, year")
          .in("id", needVehicleIds);
        for (const v of vehicles ?? []) vMap.set(v.id, v);
      }
      const driverIds = Array.from(new Set(live.map((r) => r.driver_id).filter(Boolean))) as string[];
      const { data: drivers } = driverIds.length
        ? await supabaseAdmin.from("drivers").select("id, full_name, phone, email").in("id", driverIds)
        : { data: [] as { id: string; full_name: string; phone: string; email: string }[] };
      const dMap = new Map((drivers ?? []).map((d) => [d.id, d]));

      for (const r of live) {
        const v = r.vehicle_id ? vMap.get(r.vehicle_id) : undefined;
        const d = r.driver_id ? dMap.get(r.driver_id) : undefined;
        cards.push({
          source: "live",
          id: r.id,
          customerName: d?.full_name ?? "Unknown renter",
          vehicleLabel: v ? `${v.year} ${v.make} ${v.model}` : "Vehicle on file",
          plate: v?.plate ?? null,
          startDate: r.start_date,
          endDate: r.end_date ?? null,
          isMigration: false,
          hasAgreement: Boolean(r.agreement_pdf_url || r.client_signature_url),
          agreementUrl: r.agreement_pdf_url ?? null,
          driverId: r.driver_id ?? null,
          vehicleId: r.vehicle_id ?? null,
          phone: d?.phone ?? null,
          email: d?.email ?? null,
          retroSentAt: null,
          retroSignedAt: null,
        });
      }
    }

    // ---- Migrated (legacy) rentals ----
    let lq = supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, renter_name, vehicle, year, plate, start_datetime, end_datetime, phone, email, agreement_pdf_url, retro_sent_at, retro_signed_at",
      )
      .order("start_datetime", { ascending: false, nullsFirst: false })
      .limit(200);
    if (plate) lq = lq.ilike("plate", plate);
    const { data: legacyRows } = await lq;
    let legacy = legacyRows ?? [];
    if (date) {
      legacy = legacy.filter((r) => {
        const start = r.start_datetime ? r.start_datetime.slice(0, 10) : null;
        const end = r.end_datetime ? r.end_datetime.slice(0, 10) : null;
        if (start && start > date) return false;
        if (end && end < date) return false;
        return true;
      });
    }
    for (const r of legacy) {
      cards.push({
        source: "migrated",
        id: r.id,
        customerName: r.renter_name ?? "Unknown renter",
        vehicleLabel: vehicleLabelFromText(r.year, r.vehicle, r.plate),
        plate: r.plate ?? null,
        startDate: r.start_datetime ? r.start_datetime.slice(0, 10) : null,
        endDate: r.end_datetime ? r.end_datetime.slice(0, 10) : null,
        isMigration: true,
        hasAgreement: Boolean(r.agreement_pdf_url),
        agreementUrl: r.agreement_pdf_url ?? null,
        driverId: null,
        vehicleId: null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        retroSentAt: r.retro_sent_at ?? null,
        retroSignedAt: r.retro_signed_at ?? null,
      });
    }

    return cards;
  });

function makeToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  ).slice(0, 40);
}

/** Next sequential text id like "D-101" / "R-501" for drivers / rentals. */
async function nextSeqId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: "rentals" | "drivers",
  prefix: "R" | "D",
  floor: number,
): Promise<string> {
  const { data } = await admin.from(table).select("id");
  const n = (data ?? []).reduce((m: number, row: { id: string }) => {
    const k = parseInt(String(row.id).replace(/\D/g, "")) || 0;
    return Math.max(m, k);
  }, floor);
  return `${prefix}-${n + 1}`;
}

function normPlate(s: string | null | undefined): string {
  return (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export interface LegacyPromotionResult {
  driverId: string;
  driverCreated: boolean;
  rentalId: string | null;
  vehicleId: string | null;
  note: string;
}

/**
 * Promote a signed legacy rental into real drivers + rentals rows.
 * - Matches an existing driver by license number or phone, else creates one.
 * - Matches the vehicle by plate; if found, creates a real "Returned" rental.
 * Returns the resolved ids. Idempotent-ish: if the legacy row was already
 * promoted, the caller should skip.
 */
async function promoteLegacyRental(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lr: any,
  submitted: {
    fullName: string;
    address?: string;
    licenseNumber?: string;
    dlState?: string;
    dateOfBirth?: string;
    phone?: string;
    email?: string;
  },
  agreementUrl: string | null,
  signedAtIso: string,
): Promise<LegacyPromotionResult> {
  const fullName = (submitted.fullName || lr.renter_name || "").trim();
  const license = (submitted.licenseNumber || lr.dl_number || "").trim().toUpperCase();
  const phone = (submitted.phone || lr.phone || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  const email = (submitted.email || lr.email || "").trim();

  // 1) MATCH / CREATE DRIVER
  let driverId: string | null = null;
  let driverCreated = false;
  if (license) {
    const { data: byLic } = await admin
      .from("drivers")
      .select("id")
      .ilike("license_number", license)
      .limit(1);
    if (byLic && byLic[0]) driverId = byLic[0].id;
  }
  if (!driverId && phoneDigits.length >= 7) {
    const { data: drivers } = await admin.from("drivers").select("id, phone");
    const match = (drivers ?? []).find(
      (d: { id: string; phone: string | null }) =>
        (d.phone ?? "").replace(/\D/g, "") === phoneDigits,
    );
    if (match) driverId = match.id;
  }
  if (!driverId) {
    driverId = await nextSeqId(admin, "drivers", "D", 100);
    const { error: dErr } = await admin.from("drivers").insert({
      id: driverId,
      full_name: fullName || "Unknown renter",
      phone: phone || "",
      email: email || "",
      license_number: license || "",
      license_expiry: "2099-12-31",
      dl_state: submitted.dlState || lr.dl_state || null,
      date_of_birth: submitted.dateOfBirth || lr.dob || null,
      address: submitted.address || lr.address || null,
      insurance_on_file: false,
      rideshare: "Uber",
      status: "active",
      date_added: new Date().toISOString().slice(0, 10),
      import_source: "fleet_finesse_promoted",
    } as never);
    if (dErr) throw new Error(`Driver create failed: ${dErr.message}`);
    driverCreated = true;
  }

  // 2) MATCH VEHICLE BY PLATE + CREATE RENTAL
  let vehicleId: string | null = null;
  let rentalId: string | null = null;
  const plateKey = normPlate(lr.plate);
  if (plateKey) {
    const { data: vehicles } = await admin.from("vehicles").select("id, plate");
    const v = (vehicles ?? []).find(
      (row: { id: string; plate: string | null }) => normPlate(row.plate) === plateKey,
    );
    if (v) vehicleId = v.id;
  }
  const startISO = lr.start_datetime ? String(lr.start_datetime).slice(0, 10) : null;
  if (vehicleId && startISO) {
    // Avoid creating a duplicate if one already exists for this triple.
    const { data: existing } = await admin
      .from("rentals")
      .select("id")
      .eq("driver_id", driverId)
      .eq("vehicle_id", vehicleId)
      .eq("start_date", startISO)
      .limit(1);
    if (existing && existing[0]) {
      rentalId = existing[0].id;
    } else {
      rentalId = await nextSeqId(admin, "rentals", "R", 500);
      const { error: rErr } = await admin.from("rentals").insert({
        id: rentalId,
        vehicle_id: vehicleId,
        driver_id: driverId,
        start_date: startISO,
        end_date: lr.end_datetime ? String(lr.end_datetime).slice(0, 10) : null,
        weekly_rate: 0,
        deposit_paid: 0,
        payment_status: "current",
        payment_received: false,
        reservation_status: "returned",
        agreement_pdf_url: agreementUrl,
        agreement_pdf_generated_at: signedAtIso,
        client_signed_at: signedAtIso,
        signed_by: fullName || null,
        notes: `Fleet Finesse Migration - Promoted from legacy rental ${lr.order_number || lr.id}`,
        import_source: "fleet_finesse_promoted",
      } as never);
      if (rErr) throw new Error(`Rental create failed: ${rErr.message}`);
    }
  }

  const note = `Promoted from legacy rental ${lr.order_number || lr.id} on ${signedAtIso.slice(0, 10)} — driver ${driverId}${rentalId ? `, rental ${rentalId}` : " (no vehicle match — rental not created)"}`;
  return { driverId, driverCreated, rentalId, vehicleId, note };
}

function appOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    "https://camautorentals.lovable.app"
  ).replace(/\/$/, "");
}

/** Generate + send a retroactive-agreement signing link for a migration rental. */
export const sendRetroAgreementLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { legacyId: string; phone: string; email?: string | null; message?: string | null }) =>
    z
      .object({
        legacyId: z.string().uuid(),
        phone: z.string().min(7).max(30),
        email: z.string().email().optional().nullable().or(z.literal("")),
        message: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms, sendEmail } = await import("@/lib/ghl.server");

    const { data: lr, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, start_datetime, retro_token")
      .eq("id", data.legacyId)
      .maybeSingle();
    if (error || !lr) throw new Error("Migration rental not found");

    const token = lr.retro_token || makeToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("legacy_rentals")
      .update({
        retro_token: token,
        retro_token_expires_at: expires,
        retro_sent_at: new Date().toISOString(),
        phone: data.phone,
        email: data.email || null,
      } as never)
      .eq("id", data.legacyId);
    if (upErr) throw new Error(upErr.message);

    const link = `${appOrigin()}/sign-agreement-retro/${token}`;
    const name = lr.renter_name || "there";
    const dateStr = lr.start_datetime ? new Date(lr.start_datetime).toLocaleDateString("en-US") : "your rental";
    const sms =
      (data.message && data.message.trim()) ||
      `Hi ${name}, Camauto Rentals needs you to sign a rental agreement for your rental on ${dateStr}. This is required for compliance. Click to sign: ${link}`;

    await sendSms(data.phone, sms, name);
    if (data.email) {
      try {
        await sendEmail(
          data.email,
          "Action required: sign your Camauto rental agreement",
          `<p>Hi ${name},</p><p>Camauto Rentals needs you to sign a rental agreement for your rental on ${dateStr}. This is required for compliance.</p><p><a href="${link}">Click here to sign your agreement</a></p>`,
          { name, phone: data.phone },
        );
      } catch (e) {
        console.warn("[retro] email send failed", e);
      }
    }

    return { ok: true as const, link };
  });

/** Cancel a pending retroactive-agreement link. */
export const cancelRetroAgreementLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { legacyId: string }) => z.object({ legacyId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("legacy_rentals")
      .update({ retro_token: null, retro_token_expires_at: null, retro_sent_at: null } as never)
      .eq("id", data.legacyId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Migration rentals where a retro link was sent but not yet signed. */
export const listAwaitingRetroAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select("id, renter_name, vehicle, year, plate, start_datetime, end_datetime, phone, email, retro_sent_at, retro_signed_at, agreement_pdf_url")
      .not("retro_sent_at", "is", null)
      .order("retro_sent_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      customerName: r.renter_name ?? "Unknown renter",
      vehicleLabel: vehicleLabelFromText(r.year, r.vehicle, r.plate),
      plate: r.plate ?? null,
      startDate: r.start_datetime ? r.start_datetime.slice(0, 10) : null,
      endDate: r.end_datetime ? r.end_datetime.slice(0, 10) : null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      retroSentAt: r.retro_sent_at ?? null,
      retroSignedAt: r.retro_signed_at ?? null,
      hasAgreement: Boolean(r.agreement_pdf_url),
    }));
  });

// ---- Public (token-scoped, no login) ----

export const getRetroAgreement = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => z.object({ token: z.string().min(8).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_retro_agreement_public", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("This signing link is invalid or has expired.");
    return row as {
      id: string;
      renter_name: string | null;
      vehicle: string | null;
      year: string | null;
      color: string | null;
      plate: string | null;
      start_datetime: string | null;
      end_datetime: string | null;
      address: string | null;
      dl_number: string | null;
      dl_state: string | null;
      dob: string | null;
      phone: string | null;
      email: string | null;
      retro_signed_at: string | null;
      expired: boolean;
    };
  });

async function signatureToJpeg(dataUrl: string): Promise<Buffer | null> {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const ab = Buffer.from(base64, "base64");
    // @ts-expect-error — upng-js has no types
    const UPNG = (await import("upng-js")).default;
    const jpeg = (await import("jpeg-js")).default;
    const decoded = UPNG.decode(ab);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    const w = decoded.width;
    const h = decoded.height;
    const rgb = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = rgba[i * 4 + 3] / 255;
      rgb[i * 4] = Math.round(rgba[i * 4] * a + 255 * (1 - a));
      rgb[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + 255 * (1 - a));
      rgb[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + 255 * (1 - a));
      rgb[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ data: rgb, width: w, height: h }, 90);
    return Buffer.from(encoded.data);
  } catch (e) {
    console.warn("[retro-agreement] signature convert failed", e);
    return null;
  }
}

export const submitRetroAgreement = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(8).max(80),
        fullName: z.string().min(2).max(120),
        address: z.string().max(300).optional().default(""),
        licenseNumber: z.string().max(40).optional().default(""),
        dlState: z.string().max(4).optional().default(""),
        dateOfBirth: z.string().max(20).optional().default(""),
        phone: z.string().max(30).optional().default(""),
        email: z.string().max(120).optional().default(""),
        signatureDataUrl: z.string().min(20),
        ack1: z.literal(true),
        ack2: z.literal(true),
        ack3: z.literal(true),
        ack4: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/ghl.server");

    const { data: lr, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select("*")
      .eq("retro_token", data.token)
      .maybeSingle();
    if (error || !lr) throw new Error("This signing link is invalid or has expired.");
    if (lr.retro_token_expires_at && new Date(lr.retro_token_expires_at) < new Date()) {
      throw new Error("This signing link has expired.");
    }

    const ip =
      getRequestHeader("cf-connecting-ip") ||
      (getRequestHeader("x-forwarded-for") || "").split(",")[0].trim() ||
      null;
    const nowIso = new Date().toISOString();

    // Upload signature image
    let signatureUrl: string | null = null;
    const sigJpeg = await signatureToJpeg(data.signatureDataUrl);
    if (sigJpeg) {
      const path = `retro/${lr.id}/signature-${Date.now()}.jpg`;
      const { error: sErr } = await supabaseAdmin.storage
        .from("legacy-agreements")
        .upload(path, sigJpeg, { contentType: "image/jpeg", upsert: true });
      if (!sErr) {
        const { data: signed } = await supabaseAdmin.storage
          .from("legacy-agreements")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        signatureUrl = signed?.signedUrl ?? null;
      }
    }

    // Build the signed agreement PDF
    const vehText = (lr.vehicle || "").trim();
    const [makeGuess, ...modelGuess] = vehText.split(/\s+/);
    const pdfData: RentalAgreementPDFData = {
      rental: {
        id: lr.order_number || lr.id,
        startDate: lr.start_datetime ? lr.start_datetime.slice(0, 10) : "",
        endDate: lr.end_datetime ? lr.end_datetime.slice(0, 10) : null,
        billingCadence: null,
        billingPeriod: null,
        rateAmount: null,
        rate: 0,
        weeklyRate: 0,
        depositPaid: 0,
        signedBy: data.fullName,
        signedAt: nowIso,
        clientSignedAt: nowIso,
        agreementVersion: DEFAULT_SETTINGS.agreementVersion,
      },
      driver: {
        fullName: data.fullName,
        firstName: null,
        lastName: null,
        middleInitial: null,
        dateOfBirth: data.dateOfBirth || lr.dob || null,
        licenseNumber: data.licenseNumber || lr.dl_number || "",
        licenseExpiry: null,
        dlState: data.dlState || lr.dl_state || null,
        phone: data.phone || lr.phone || "",
        email: data.email || lr.email || "",
        streetAddress: null,
        aptUnit: null,
        city: null,
        state: null,
        zipCode: null,
        address: data.address || lr.address || null,
        altContactName: null,
        altContactPhone: null,
      },
      vehicle: {
        year: lr.year || "",
        make: makeGuess || vehText || "",
        model: modelGuess.join(" "),
        color: lr.color || null,
        plate: lr.plate || "",
        vin: "",
        mileage: 0,
        fuelLevelPickup: null,
        ezPassTag: null,
      },
      extensions: [],
      settings: DEFAULT_SETTINGS,
      signaturePng: sigJpeg,
    };
    const bytes = await renderRentalAgreementPdf(pdfData);
    const pdfPath = `retro/${lr.id}/agreement-${Date.now()}.pdf`;
    const { error: pErr } = await supabaseAdmin.storage
      .from("legacy-agreements")
      .upload(pdfPath, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (pErr) throw new Error(pErr.message);
    const { data: signedPdf } = await supabaseAdmin.storage
      .from("legacy-agreements")
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 365 * 5);
    const agreementUrl = signedPdf?.signedUrl ?? null;

    const { error: upErr } = await supabaseAdmin
      .from("legacy_rentals")
      .update({
        retro_signed_at: nowIso,
        retro_signed_ip: ip,
        retro_signature_url: signatureUrl,
        agreement_pdf_url: agreementUrl,
        address: data.address || lr.address || null,
        dl_number: data.licenseNumber || lr.dl_number || null,
        dl_state: data.dlState || lr.dl_state || null,
        dob: data.dateOfBirth || lr.dob || null,
        phone: data.phone || lr.phone || null,
        email: data.email || lr.email || null,
        retro_token: null,
        retro_token_expires_at: null,
      } as never)
      .eq("id", lr.id);
    if (upErr) throw new Error(upErr.message);

    // Notify renter + admin
    const renterPhone = data.phone || lr.phone;
    if (renterPhone) {
      try {
        await sendSms(renterPhone, "✓ Agreement signed. Thank you. — Camauto Rentals", data.fullName);
      } catch (e) {
        console.warn("[retro] renter confirm sms failed", e);
      }
    }
    try {
      await sendSms(
        ADMIN_SMS,
        `✓ ${data.fullName} signed retroactive agreement for rental ${lr.order_number || lr.id}`,
      );
    } catch (e) {
      console.warn("[retro] admin sms failed", e);
    }

    return { ok: true as const };
  });