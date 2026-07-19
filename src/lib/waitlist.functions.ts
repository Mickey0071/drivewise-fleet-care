import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "waitlist-uploads";
const DOCS_BUCKET = "waitlist-docs";
const db = supabaseAdmin as any;

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid image data");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  if (!contentType.startsWith("image/")) throw new Error("File must be an image");
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error("Image exceeds 12MB");
  return { buffer, contentType, ext };
}

async function uploadImage(
  entryId: string,
  kind: "license" | "selfie" | "license-front" | "license-back" | "rideshare-proof",
  dataUrl: string,
): Promise<string> {
  const bucket =
    kind === "license-front" || kind === "license-back" || kind === "rideshare-proof"
      ? DOCS_BUCKET
      : BUCKET;
  const { buffer, contentType, ext } = dataUrlToBuffer(dataUrl);
  const path = `${entryId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (signErr || !signed?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message ?? "unknown"}`);
  return signed.signedUrl;
}

/** Public: create a waitlist entry from the /waitlist form. No auth required. */
export const submitWaitlistEntry = createServerFn({ method: "POST" })
  .inputValidator((input: {
    name: string;
    phone: string;
    email: string;
    licenseFrontDataUrl: string;
    licenseBackDataUrl: string;
    rideshareProofDataUrl: string;
    vehiclePreference?: string;
    rentalCadence: "Daily" | "Weekly";
  }) => {
    const name = (input.name ?? "").trim();
    const phone = (input.phone ?? "").trim();
    const email = (input.email ?? "").trim();
    if (name.length < 2 || name.length > 120) throw new Error("Please enter your full name");
    if (phone.length < 7 || phone.length > 40) throw new Error("Please enter a valid phone number");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new Error("Please enter a valid email");
    if (!input.licenseFrontDataUrl?.startsWith("data:image/")) throw new Error("License front photo required");
    if (!input.licenseBackDataUrl?.startsWith("data:image/")) throw new Error("License back photo required");
    if (!input.rideshareProofDataUrl?.startsWith("data:image/")) throw new Error("Rideshare proof screenshot required");
    const cadence = input.rentalCadence === "Daily" ? "Daily" : "Weekly";
    const vehiclePreference = (input.vehiclePreference ?? "").trim() || null;
    return {
      name, phone, email,
      licenseFrontDataUrl: input.licenseFrontDataUrl,
      licenseBackDataUrl: input.licenseBackDataUrl,
      rideshareProofDataUrl: input.rideshareProofDataUrl,
      vehiclePreference,
      rentalCadence: cadence,
    };
  })
  .handler(async ({ data }) => {
    const { data: inserted, error } = await db
      .from("waitlist_entries")
      .insert({
        name: data.name,
        phone: data.phone,
        email: data.email,
        status: "Waitlisted",
        vehicle_preference: data.vehiclePreference,
        rental_cadence: data.rentalCadence,
        source: "Form",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Could not save: ${error?.message ?? "unknown"}`);
    const entryId = inserted.id as string;
    const [licenseFrontUrl, licenseBackUrl, rideshareUrl] = await Promise.all([
      uploadImage(entryId, "license-front", data.licenseFrontDataUrl),
      uploadImage(entryId, "license-back", data.licenseBackDataUrl),
      uploadImage(entryId, "rideshare-proof", data.rideshareProofDataUrl),
    ]);
    const { error: updErr } = await db
      .from("waitlist_entries")
      .update({
        license_url: licenseFrontUrl,
        license_front_url: licenseFrontUrl,
        license_back_url: licenseBackUrl,
        rideshare_proof_url: rideshareUrl,
      })
      .eq("id", entryId);
    if (updErr) throw new Error(`Could not attach uploads: ${updErr.message}`);
    return { ok: true as const, id: entryId };
  });

/** Admin: list waitlist entries, oldest-first. */
export const listWaitlistEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("waitlist_entries")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { entries: (data ?? []) as any[] };
  });

/** Admin: count of new (unseen) waitlist entries for badges. */
export const countNewWaitlistEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await (context.supabase as any)
      .from("waitlist_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "Waitlisted")
      .is("admin_seen_at", null);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/** Admin: mark the waitlist tab as seen (clears the notification badge). */
export const markWaitlistSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any)
      .from("waitlist_entries")
      .update({ admin_seen_at: new Date().toISOString() })
      .is("admin_seen_at", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: create a waiter manually (name + phone required, docs optional). */
export const createWaitlistEntryAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    name: string;
    phone: string;
    email?: string;
    licenseFrontDataUrl?: string;
    licenseBackDataUrl?: string;
    rideshareProofDataUrl?: string;
    vehiclePreference?: string;
    rentalCadence?: "Daily" | "Weekly";
    adminNotes?: string;
  }) => {
    const name = (input.name ?? "").trim();
    const phone = (input.phone ?? "").trim();
    if (name.length < 2) throw new Error("Name required");
    if (phone.length < 7) throw new Error("Phone required");
    const email = (input.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    const cadence = input.rentalCadence === "Daily" ? "Daily" : input.rentalCadence === "Weekly" ? "Weekly" : null;
    return {
      name, phone, email: email || null,
      licenseFrontDataUrl: input.licenseFrontDataUrl ?? null,
      licenseBackDataUrl: input.licenseBackDataUrl ?? null,
      rideshareProofDataUrl: input.rideshareProofDataUrl ?? null,
      vehiclePreference: (input.vehiclePreference ?? "").trim() || null,
      rentalCadence: cadence,
      adminNotes: (input.adminNotes ?? "").trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { data: inserted, error } = await db
      .from("waitlist_entries")
      .insert({
        name: data.name,
        phone: data.phone,
        email: data.email ?? "",
        status: "Waitlisted",
        source: "Admin",
        vehicle_preference: data.vehiclePreference,
        rental_cadence: data.rentalCadence,
        admin_notes: data.adminNotes,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Could not save: ${error?.message ?? "unknown"}`);
    const entryId = inserted.id as string;
    const patch: Record<string, string> = {};
    if (data.licenseFrontDataUrl) {
      const u = await uploadImage(entryId, "license-front", data.licenseFrontDataUrl);
      patch.license_front_url = u;
      patch.license_url = u;
    }
    if (data.licenseBackDataUrl) {
      patch.license_back_url = await uploadImage(entryId, "license-back", data.licenseBackDataUrl);
    }
    if (data.rideshareProofDataUrl) {
      patch.rideshare_proof_url = await uploadImage(entryId, "rideshare-proof", data.rideshareProofDataUrl);
    }
    if (Object.keys(patch).length) {
      const { error: uErr } = await db.from("waitlist_entries").update(patch).eq("id", entryId);
      if (uErr) throw new Error(uErr.message);
    }
    const { data: row } = await db
      .from("waitlist_entries")
      .select("upload_token")
      .eq("id", entryId)
      .single();
    return { ok: true as const, id: entryId, uploadToken: (row?.upload_token as string) ?? null };
  });

/** Public: fetch minimal waitlist entry state by upload token (for the SMS upload link). */
export const getWaitlistEntryByToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => {
    const token = (input.token ?? "").trim();
    if (!token) throw new Error("Missing token");
    return { token };
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await db
      .from("waitlist_entries")
      .select("id, name, license_front_url, license_back_url, rideshare_proof_url, vehicle_preference, rental_cadence")
      .eq("upload_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This link is invalid or has expired.");
    return {
      id: row.id as string,
      name: (row.name as string) ?? "",
      hasLicenseFront: !!row.license_front_url,
      hasLicenseBack: !!row.license_back_url,
      hasRideshareProof: !!row.rideshare_proof_url,
      vehiclePreference: (row.vehicle_preference as string) ?? "",
      rentalCadence: (row.rental_cadence as string) ?? "",
    };
  });

/** Public: waiter uploads their docs via tokenized SMS link. */
export const submitWaitlistDocsByToken = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    licenseFrontDataUrl?: string;
    licenseBackDataUrl?: string;
    rideshareProofDataUrl?: string;
    vehiclePreference?: string;
    rentalCadence?: "Daily" | "Weekly";
  }) => {
    const token = (input.token ?? "").trim();
    if (!token) throw new Error("Missing token");
    for (const [k, v] of Object.entries({
      licenseFrontDataUrl: input.licenseFrontDataUrl,
      licenseBackDataUrl: input.licenseBackDataUrl,
      rideshareProofDataUrl: input.rideshareProofDataUrl,
    })) {
      if (v && !v.startsWith("data:image/")) throw new Error(`Invalid ${k}`);
    }
    return {
      token,
      licenseFrontDataUrl: input.licenseFrontDataUrl ?? null,
      licenseBackDataUrl: input.licenseBackDataUrl ?? null,
      rideshareProofDataUrl: input.rideshareProofDataUrl ?? null,
      vehiclePreference: (input.vehiclePreference ?? "").trim() || null,
      rentalCadence:
        input.rentalCadence === "Daily" ? "Daily" : input.rentalCadence === "Weekly" ? "Weekly" : null,
    };
  })
  .handler(async ({ data }) => {
    const { data: row, error: findErr } = await db
      .from("waitlist_entries")
      .select("id")
      .eq("upload_token", data.token)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!row) throw new Error("This link is invalid or has expired.");
    const entryId = row.id as string;
    const patch: Record<string, string | null> = {};
    if (data.licenseFrontDataUrl) {
      const u = await uploadImage(entryId, "license-front", data.licenseFrontDataUrl);
      patch.license_front_url = u;
      patch.license_url = u;
    }
    if (data.licenseBackDataUrl) {
      patch.license_back_url = await uploadImage(entryId, "license-back", data.licenseBackDataUrl);
    }
    if (data.rideshareProofDataUrl) {
      patch.rideshare_proof_url = await uploadImage(entryId, "rideshare-proof", data.rideshareProofDataUrl);
    }
    if (data.vehiclePreference) patch.vehicle_preference = data.vehiclePreference;
    if (data.rentalCadence) patch.rental_cadence = data.rentalCadence;
    if (Object.keys(patch).length) {
      const { error: uErr } = await db.from("waitlist_entries").update(patch).eq("id", entryId);
      if (uErr) throw new Error(uErr.message);
    }
    return { ok: true as const };
  });

/** Admin: update editable fields on a waitlist card (notes, contact info, prefs). */
export const updateWaitlistEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
    vehiclePreference?: string | null;
    rentalCadence?: string | null;
    adminNotes?: string | null;
  }) => {
    if (!input.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.phone !== undefined) patch.phone = data.phone.trim();
    if (data.email !== undefined) patch.email = data.email.trim();
    if (data.vehiclePreference !== undefined) patch.vehicle_preference = data.vehiclePreference || null;
    if (data.rentalCadence !== undefined) patch.rental_cadence = data.rentalCadence || null;
    if (data.adminNotes !== undefined) patch.admin_notes = data.adminNotes ?? null;
    if (!Object.keys(patch).length) return { ok: true as const };
    const { error } = await (context.supabase as any)
      .from("waitlist_entries").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: upload a document onto an existing waiter card. */
export const uploadWaitlistDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string;
    kind: "license-front" | "license-back" | "rideshare-proof";
    dataUrl: string;
  }) => {
    if (!input.id) throw new Error("id required");
    if (!["license-front", "license-back", "rideshare-proof"].includes(input.kind)) throw new Error("kind invalid");
    if (!input.dataUrl?.startsWith("data:image/")) throw new Error("Image required");
    return input;
  })
  .handler(async ({ data }) => {
    const url = await uploadImage(data.id, data.kind, data.dataUrl);
    const col =
      data.kind === "license-front" ? "license_front_url"
      : data.kind === "license-back" ? "license_back_url"
      : "rideshare_proof_url";
    const patch: Record<string, string> = { [col]: url };
    if (data.kind === "license-front") patch.license_url = url;
    const { error } = await db.from("waitlist_entries").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, url };
  });

/** Admin: mark a waitlist entry as Converted after a reservation is created. */
export const markWaitlistConverted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; rentalId: string }) => {
    if (!input.id) throw new Error("id required");
    if (!input.rentalId) throw new Error("rentalId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("waitlist_entries")
      .update({
        status: "Converted",
        converted_rental_id: data.rentalId,
        converted_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });