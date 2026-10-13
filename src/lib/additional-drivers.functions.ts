import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { extractLicenseFieldsFromImage } from "@/lib/payer-id-ocr.server";
import { buildAddendumPdf, ACKNOWLEDGEMENTS, type AckKey } from "@/lib/additional-driver-addendum";

const BUCKET = "rental-signing";
const ADMIN_ALERT_PHONE = "267-221-3977";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VIEW_URL_TTL = 60 * 60; // 1 hour signed URLs for admin viewing

function appOrigin(): string {
  return process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
}

function genToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Only admins can manage additional drivers");
}

async function urgentAdminSms(message: string) {
  try {
    const { getAlertGlobalConfig } = await import("@/lib/alerts.server");
    const g = await getAlertGlobalConfig();
    if (!g.masterSmsEnabled) return;
    await sendSms(g.adminPhone || ADMIN_ALERT_PHONE, message, "Admin");
  } catch (e) {
    console.error("[additional-driver] admin SMS failed", e);
  }
}

async function safeSms(phone: string | null | undefined, msg: string, name?: string | null) {
  if (!phone) return;
  try { await sendSms(phone, msg, name ?? null); } catch (e) { console.error("[additional-driver] SMS failed", e); }
}

function dataUrlToBytes(dataUrl: string) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid image");
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB");
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return { bytes, contentType, ext };
}

async function uploadPrivate(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path; // store the private path; URLs are minted on demand.
}

async function signedUrl(path: string | null | undefined, ttl = VIEW_URL_TTL): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, ttl);
  return data?.signedUrl ?? null;
}

function vehicleLabel(v: any): string {
  if (!v) return "";
  return [v.year, v.make, v.model].filter(Boolean).join(" ") + (v.plate ? ` · ${v.plate}` : "");
}

const normLic = (s: string | null | undefined) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function loadRentalContext(rentalId: string) {
  const { data: rental } = await supabaseAdmin
    .from("rentals")
    .select("id, driver_id, vehicle_id, start_date, end_date, signed_at, client_signed_at, created_at")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) throw new Error("Rental not found");
  const [{ data: vehicle }, { data: driver }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("year, make, model, plate, vin, color").eq("id", rental.vehicle_id).maybeSingle(),
    supabaseAdmin.from("drivers").select("full_name, phone, email").eq("id", rental.driver_id).maybeSingle(),
  ]);
  return { rental, vehicle, driver };
}

/* ───────────────────────── Admin: invite ───────────────────────── */

export const inviteAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      rentalId: z.string().min(1).max(64),
      invitedName: z.string().trim().max(120).optional(),
      isAlsoPayer: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { rental, driver } = await loadRentalContext(data.rentalId);
    if (!driver?.phone) throw new Error("The primary renter has no phone number on file");
    const token = genToken();
    const { error } = await supabaseAdmin.from("additional_drivers").insert({
      rental_id: rental.id,
      invited_name: data.invitedName || null,
      is_also_payer: data.isAlsoPayer,
      status: "invited",
      token,
      token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      invited_by: context.userId,
    });
    if (error) throw new Error(`Could not create invite: ${error.message}`);
    const link = `${appOrigin()}/add-driver/${token}`;
    const msg = `Camauto Rentals: to add an additional driver to your rental, forward this link to them. They'll need their driver's license. ${link}`;
    try {
      await sendSms(driver.phone, msg, driver.full_name ?? null);
    } catch (e) {
      console.error("[additional-driver] invite SMS failed", e);
      throw new Error("Invite saved, but the text could not be sent. Check the renter's phone number.");
    }
    return { ok: true, link };
  });

/* ───────────────────────── Public: token page ───────────────────────── */

async function loadInvite(token: string) {
  const { data: row } = await supabaseAdmin
    .from("additional_drivers")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return row as any;
}

export const getAdditionalDriverInvite = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(16).max(128) }).parse(d))
  .handler(async ({ data }) => {
    const row = await loadInvite(data.token);
    if (!row) return { found: false as const, reason: "invalid" as const };
    const expired = new Date(row.token_expires_at).getTime() < Date.now();
    const used = !!row.token_used_at || row.status !== "invited";
    const { rental, vehicle, driver } = await loadRentalContext(row.rental_id);
    const payload = {
      found: true as const,
      expired,
      used,
      invitedName: (row.invited_name as string) || "",
      isAlsoPayer: !!row.is_also_payer,
      vehicle: vehicle
        ? { year: String(vehicle.year ?? ""), make: vehicle.make ?? "", model: vehicle.model ?? "", plate: vehicle.plate ?? "", vin: vehicle.vin ?? "", color: vehicle.color ?? "" }
        : null,
      renterName: driver?.full_name ?? "",
      startDate: rental.start_date ?? null,
      endDate: rental.end_date ?? null,
      agreementNumber: rental.id,
    };
    return JSON.parse(JSON.stringify(payload)) as typeof payload;
  });

const submitSchema = z.object({
  token: z.string().min(16).max(128),
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().trim().min(7).max(32),
  email: z.string().trim().max(200).optional(),
  streetAddress: z.string().trim().min(2).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(40),
  zipCode: z.string().trim().min(3).max(12),
  licenseNumber: z.string().trim().min(3).max(40),
  licenseState: z.string().trim().min(2).max(40),
  licenseExpiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licenseDataUrl: z.string().startsWith("data:image/"),
  selfieDataUrl: z.string().startsWith("data:image/"),
  signatureDataUrl: z.string().startsWith("data:image/"),
  printedName: z.string().trim().min(2).max(120),
  acks: z.record(z.string(), z.literal(true)),
});

export const submitAdditionalDriver = createServerFn({ method: "POST" })
  .inputValidator((d) => submitSchema.parse(d))
  .handler(async ({ data }) => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (data.acks[a.key] !== true) throw new Error("All acknowledgements are required");
    }
    const row = await loadInvite(data.token);
    if (!row) throw new Error("This link is not valid.");
    if (row.token_used_at || row.status !== "invited") throw new Error("This link has already been used.");
    if (new Date(row.token_expires_at).getTime() < Date.now()) throw new Error("This link has expired. Ask the renter to request a new one.");

    // Claim the token first (single use).
    const { data: claimed } = await supabaseAdmin
      .from("additional_drivers")
      .update({ token_used_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("token_used_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) throw new Error("This link has already been used.");

    const { rental, vehicle, driver } = await loadRentalContext(row.rental_id);
    const base = `${rental.id}/additional-drivers/${row.id}`;
    const lic = dataUrlToBytes(data.licenseDataUrl);
    const self = dataUrlToBytes(data.selfieDataUrl);
    const sig = dataUrlToBytes(data.signatureDataUrl);
    const [licensePath, selfiePath, signaturePath] = await Promise.all([
      uploadPrivate(`${base}/license.${lic.ext}`, lic.bytes, lic.contentType),
      uploadPrivate(`${base}/selfie.${self.ext}`, self.bytes, self.contentType),
      uploadPrivate(`${base}/signature.${sig.ext}`, sig.bytes, sig.contentType),
    ]);

    // OCR cross-check (flag only, never blocks).
    let ocrStatus = "unreadable";
    let ocrLicense: string | null = null;
    try {
      const fields = await extractLicenseFieldsFromImage(data.licenseDataUrl);
      ocrLicense = fields?.licenseNumber ?? null;
      if (ocrLicense) ocrStatus = normLic(ocrLicense) === normLic(data.licenseNumber) ? "match" : "mismatch";
    } catch (e) {
      console.error("[additional-driver] OCR failed", e);
    }

    const now = new Date();
    const acknowledgements: Record<string, { checked: true; at: string; text: string }> = {};
    for (const a of ACKNOWLEDGEMENTS) acknowledgements[a.key] = { checked: true, at: now.toISOString(), text: a.text };
    const address = `${data.streetAddress}, ${data.city}, ${data.state} ${data.zipCode}`;

    // Addendum PDF
    let addendumPath: string | null = null;
    try {
      const pdf = await buildAddendumPdf({
        agreementNumber: rental.id,
        agreementDate: (rental.client_signed_at || rental.signed_at || rental.created_at || rental.start_date || "").slice(0, 10),
        vehicle: { label: vehicleLabel(vehicle), vin: vehicle?.vin ?? "", color: vehicle?.color ?? "" },
        rentalPeriod: `${rental.start_date ?? "?"} to ${rental.end_date ?? "open-ended"}`,
        primaryRenter: driver?.full_name ?? "",
        driver: {
          fullName: data.fullName, dateOfBirth: data.dateOfBirth, phone: data.phone, email: data.email ?? "",
          address, licenseNumber: data.licenseNumber, licenseState: data.licenseState, licenseExpiration: data.licenseExpiration,
        },
        acknowledgedAt: now.toISOString(),
        signatureBytes: sig.bytes,
        signatureIsPng: sig.contentType.includes("png"),
        printedName: data.printedName,
        signedDate: now.toISOString().slice(0, 10),
      });
      addendumPath = await uploadPrivate(`${base}/addendum.pdf`, pdf, "application/pdf");
    } catch (e) {
      console.error("[additional-driver] addendum PDF failed", e);
    }

    const { error: upErr } = await supabaseAdmin
      .from("additional_drivers")
      .update({
        full_name: data.fullName,
        date_of_birth: data.dateOfBirth,
        phone: data.phone,
        email: data.email || null,
        address,
        street_address: data.streetAddress,
        city: data.city,
        state: data.state,
        zip_code: data.zipCode,
        license_number: data.licenseNumber,
        license_state: data.licenseState,
        license_expiration: data.licenseExpiration,
        license_photo_url: licensePath,
        selfie_url: selfiePath,
        signature_url: signaturePath,
        printed_name: data.printedName,
        addendum_pdf_url: addendumPath,
        acknowledgements,
        ocr_match_status: ocrStatus,
        ocr_license_number: ocrLicense,
        status: "pending",
        submitted_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    if (upErr) throw new Error(`Could not save your submission: ${upErr.message}`);

    // Payer → route into the existing cardholder verification flow.
    let paymentLink: string | null = null;
    if (row.is_also_payer) {
      const vToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      await supabaseAdmin
        .from("rentals")
        .update({
          verification_token: vToken,
          verification_token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          verification_link_sent_at: now.toISOString(),
          cardholder_name: data.fullName,
          updated_at: now.toISOString(),
        } as any)
        .eq("id", rental.id);
      paymentLink = `${appOrigin()}/verify-card/${vToken}`;
    }

    await safeSms(
      data.phone,
      `Camauto Rentals: we received your additional driver application for the ${vehicleLabel(vehicle)}. You are NOT authorized to drive until we approve it — we'll text you once reviewed.` +
        (paymentLink ? ` Complete payment verification here: ${paymentLink}` : ""),
      data.fullName,
    );
    await urgentAdminSms(
      `REVIEW NEEDED - Additional driver\n\n${data.fullName} wants to be added to ${driver?.full_name ?? "renter"}'s rental (${vehicleLabel(vehicle)}).\nOCR: ${ocrStatus}${row.is_also_payer ? "\nAlso paying: yes" : ""}\n\nReview: ${appOrigin()}/rentals?detail=${encodeURIComponent(rental.id)}`,
    );
    return { ok: true, paymentLink };
  });

/* ───────────────────────── Admin: list + review ───────────────────────── */

function ageOn(dob: string, at: Date): number {
  const d = new Date(dob + "T00:00:00");
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--;
  return age;
}

export const listAdditionalDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rentalId: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rental } = await supabaseAdmin.from("rentals").select("id, end_date").eq("id", data.rentalId).maybeSingle();
    const { data: rows } = await supabaseAdmin
      .from("additional_drivers")
      .select("*")
      .eq("rental_id", data.rentalId)
      .order("created_at", { ascending: false });
    const list = (rows ?? []) as any[];

    // Duplicate license on other active rentals
    const lics = list.map((r) => r.license_number).filter(Boolean) as string[];
    const dupMap = new Map<string, string[]>();
    if (lics.length) {
      const { data: others } = await supabaseAdmin
        .from("additional_drivers")
        .select("rental_id, license_number, status")
        .neq("rental_id", data.rentalId)
        .in("status", ["pending", "approved"]);
      const { data: active } = await supabaseAdmin
        .from("rentals")
        .select("id, status")
        .in("id", Array.from(new Set((others ?? []).map((o: any) => o.rental_id))));
      const activeIds = new Set((active ?? []).filter((r: any) => !/returned|completed|cancel/i.test(String(r.status ?? ""))).map((r: any) => r.id));
      for (const o of (others ?? []) as any[]) {
        if (!activeIds.has(o.rental_id)) continue;
        const k = normLic(o.license_number);
        dupMap.set(k, [...(dupMap.get(k) ?? []), o.rental_id]);
      }
    }

    const today = new Date();
    const rentalEnd = rental?.end_date ? new Date(rental.end_date + "T23:59:59") : null;
    const out = await Promise.all(
      list.map(async (r) => {
        const flags: string[] = [];
        if (r.license_expiration) {
          const exp = new Date(r.license_expiration + "T23:59:59");
          if (exp < today) flags.push("License is expired");
          else if (rentalEnd && exp < rentalEnd) flags.push("License expires during the rental period");
        }
        if (r.date_of_birth && ageOn(r.date_of_birth, today) < 21) flags.push("Under 21 based on date of birth");
        if (r.ocr_match_status === "mismatch") flags.push(`License number on photo (${r.ocr_license_number}) does not match typed entry`);
        if (r.ocr_match_status === "unreadable" && r.status !== "invited") flags.push("License photo could not be read automatically");
        const dups = r.license_number ? dupMap.get(normLic(r.license_number)) : undefined;
        if (dups?.length) flags.push(`Same license number on another active rental (${dups.join(", ")})`);
        const [licenseUrl, selfieUrl, signatureUrl, addendumUrl] = await Promise.all([
          signedUrl(r.license_photo_url), signedUrl(r.selfie_url), signedUrl(r.signature_url), signedUrl(r.addendum_pdf_url),
        ]);
        return {
          id: r.id as string,
          status: r.status as string,
          invitedName: (r.invited_name as string) || null,
          isAlsoPayer: !!r.is_also_payer,
          fullName: r.full_name as string | null,
          dateOfBirth: r.date_of_birth as string | null,
          phone: r.phone as string | null,
          email: r.email as string | null,
          address: r.address as string | null,
          licenseNumber: r.license_number as string | null,
          licenseState: r.license_state as string | null,
          licenseExpiration: r.license_expiration as string | null,
          ocrMatchStatus: r.ocr_match_status as string | null,
          acknowledgements: (r.acknowledgements ?? {}) as Record<string, { checked: boolean; at: string; text: string }>,
          submittedAt: r.submitted_at as string | null,
          reviewedAt: r.reviewed_at as string | null,
          rejectionReason: r.rejection_reason as string | null,
          revokedAt: r.revoked_at as string | null,
          tokenExpiresAt: r.token_expires_at as string,
          createdAt: r.created_at as string,
          licenseUrl, selfieUrl, signatureUrl, addendumUrl,
          flags,
        };
      }),
    );
    return out;
  });

export const reviewAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["approve", "reject", "revoke"]),
      reason: z.string().trim().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row } = await supabaseAdmin.from("additional_drivers").select("*").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Submission not found");
    const r = row as any;
    const { vehicle, driver } = await loadRentalContext(r.rental_id);
    const now = new Date().toISOString();
    const veh = vehicleLabel(vehicle);
    let patch: Record<string, unknown>;
    let toDriver: string;
    let toRenter: string;
    if (data.action === "approve") {
      if (r.status !== "pending") throw new Error("Only pending submissions can be approved");
      patch = { status: "approved", reviewed_at: now, reviewed_by: context.userId, rejection_reason: null };
      toDriver = `Camauto Rentals: you are now approved as an additional driver on the ${veh}. The rental agreement terms apply to you.`;
      toRenter = `Camauto Rentals: ${r.full_name} has been approved as an additional driver on your rental (${veh}).`;
    } else if (data.action === "reject") {
      if (!data.reason) throw new Error("A reason is required to reject");
      if (r.status !== "pending") throw new Error("Only pending submissions can be rejected");
      patch = { status: "rejected", reviewed_at: now, reviewed_by: context.userId, rejection_reason: data.reason };
      toDriver = `Camauto Rentals: your additional driver application for the ${veh} was not approved. Reason: ${data.reason}. You may NOT drive this vehicle.`;
      toRenter = `Camauto Rentals: ${r.full_name} was not approved as an additional driver on your rental. Reason: ${data.reason}. They may NOT drive the vehicle.`;
    } else {
      if (r.status !== "approved") throw new Error("Only approved drivers can be revoked");
      patch = { status: "revoked", revoked_at: now, revoked_by: context.userId, rejection_reason: data.reason || null };
      toDriver = `Camauto Rentals: your authorization to drive the ${veh} has been revoked as of now. You may no longer drive this vehicle.`;
      toRenter = `Camauto Rentals: ${r.full_name}'s authorization as an additional driver on your rental has been revoked. They may no longer drive the vehicle.`;
    }
    const { error } = await supabaseAdmin.from("additional_drivers").update({ ...patch, updated_at: now } as any).eq("id", r.id);
    if (error) throw new Error(error.message);
    await Promise.all([safeSms(r.phone, toDriver, r.full_name), safeSms(driver?.phone, toRenter, driver?.full_name)]);
    return { ok: true };
  });

/** Admin: approved driver counts per rental (for card badges). */
export const listApprovedDriverCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await supabaseAdmin.from("additional_drivers").select("rental_id, full_name").eq("status", "approved");
    const map: Record<string, string[]> = {};
    for (const r of (data ?? []) as any[]) (map[r.rental_id] ??= []).push(r.full_name ?? "Driver");
    return map;
  });

/** Admin: approved drivers authorized on a rental at a given date (violations). */
export const listAuthorizedDriversAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rentalId: z.string().min(1).max(64), date: z.string().max(32).optional() }).parse(d))
  .handler(async ({ data }) => {
    if (data.rentalId.startsWith("LEGACY:")) return [];
    const { data: rows } = await supabaseAdmin
      .from("additional_drivers")
      .select("id, full_name, phone, license_number, license_state, status, reviewed_at, revoked_at")
      .eq("rental_id", data.rentalId)
      .in("status", ["approved", "revoked"]);
    return authorizedAt((rows ?? []) as any[], data.date).map((r) => ({
      id: r.id as string, fullName: r.full_name as string, phone: r.phone as string | null,
      license: [r.license_state, r.license_number].filter(Boolean).join(" "),
      status: r.status as string, approvedAt: r.reviewed_at as string | null, revokedAt: r.revoked_at as string | null,
    }));
  });

/** Admin: additional-driver records sharing a license number (customer profile link). */
export const listAdditionalDriverHistoryByLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ licenseNumber: z.string().trim().min(3).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseAdmin
      .from("additional_drivers")
      .select("id, rental_id, full_name, status, submitted_at, license_number")
      .not("license_number", "is", null);
    const k = normLic(data.licenseNumber);
    return ((rows ?? []) as any[])
      .filter((r) => normLic(r.license_number) === k)
      .map((r) => ({ id: r.id as string, rentalId: r.rental_id as string, fullName: r.full_name as string, status: r.status as string, submittedAt: r.submitted_at as string | null }));
  });

/* ───────────────────────── Server helpers for packets ───────────────────────── */

/** A driver counts as authorized on `date` if approved on/before that day and not revoked before it. */
export function authorizedAt<T extends { reviewed_at?: string | null; revoked_at?: string | null; status?: string }>(rows: T[], date?: string | null): T[] {
  return rows.filter((r) => {
    if (r.status !== "approved" && r.status !== "revoked") return false;
    if (!date) return r.status === "approved";
    const day = date.slice(0, 10);
    const approved = (r.reviewed_at || "").slice(0, 10);
    if (!approved || approved > day) return false;
    if (r.revoked_at && r.revoked_at.slice(0, 10) <= day) return false;
    return true;
  });
}

/** Short-lived URLs for addendum PDFs to merge into packets. */
export async function addendumPartsFor(rentalId: string | null | undefined, date?: string | null): Promise<Array<{ label: string; url: string | null }>> {
  if (!rentalId) return [];
  const { data: rows } = await supabaseAdmin
    .from("additional_drivers")
    .select("full_name, status, reviewed_at, revoked_at, addendum_pdf_url")
    .eq("rental_id", rentalId)
    .in("status", ["approved", "revoked"]);
  const list = date === undefined ? ((rows ?? []) as any[]).filter((r) => r.status === "approved") : authorizedAt((rows ?? []) as any[], date);
  return Promise.all(
    list.filter((r) => r.addendum_pdf_url).map(async (r) => ({
      label: `Additional Driver Addendum — ${r.full_name}`,
      url: await signedUrl(r.addendum_pdf_url, 600),
    })),
  );
}

export type { AckKey };
