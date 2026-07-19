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