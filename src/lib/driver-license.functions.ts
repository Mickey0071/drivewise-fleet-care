import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "driver-licenses";

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : "bin";
  if (!contentType.startsWith("image/")) throw new Error("File must be an image");
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("File exceeds 8MB");
  return { buffer, contentType, ext };
}

/** Upload a renter's driver-license image to private storage and save a long-lived signed URL on the driver profile. */
export const uploadDriverLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driverId: string; dataUrl: string }) => {
    if (!input.driverId || typeof input.driverId !== "string") throw new Error("driverId required");
    if (!input.dataUrl || typeof input.dataUrl !== "string") throw new Error("dataUrl required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buffer, contentType, ext } = dataUrlToBuffer(data.dataUrl);
    const path = `${data.driverId}/license-${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signErr || !signed?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message ?? "unknown"}`);
    const { error: updErr } = await (supabaseAdmin as any)
      .from("drivers")
      .update({ license_image_url: signed.signedUrl })
      .eq("id", data.driverId);
    if (updErr) throw new Error(`Save failed: ${updErr.message}`);
    return { url: signed.signedUrl };
  });
