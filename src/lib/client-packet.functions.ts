import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import JSZip from "jszip";
import { z } from "zod";

/**
 * Bundle the rental agreement PDF + license + selfie + signature for a
 * single rental into a zip file. Returns base64-encoded zip the client
 * triggers as a download.
 */
export const downloadClientPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id, driver_id, agreement_pdf_url, receipt_pdf_url, license_image_url, selfie_image_url, client_signature_url",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error("Rental not found");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("full_name, last_name, first_name")
      .eq("id", rental.driver_id)
      .maybeSingle();

    const safeName = (driver?.full_name || driver?.last_name || rental.driver_id || "renter")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "renter";

    const zip = new JSZip();
    const missing: string[] = [];

    async function add(url: string | null | undefined, name: string) {
      if (!url) {
        missing.push(name);
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) {
          missing.push(`${name} (http ${res.status})`);
          return;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const ext = guessExt(url, res.headers.get("content-type"));
        zip.file(`${name}${ext}`, buf);
      } catch (e) {
        missing.push(`${name} (${e instanceof Error ? e.message : "fetch failed"})`);
      }
    }

    await Promise.all([
      add(rental.agreement_pdf_url, "SIGNED_RENTAL_AGREEMENT"),
      add(rental.receipt_pdf_url, "RECEIPT"),
      add(rental.license_image_url, "DRIVER_LICENSE"),
      add(rental.selfie_image_url, "SELFIE"),
      add(rental.client_signature_url, "SIGNATURE"),
    ]);

    if (missing.length > 0) {
      zip.file(
        "MISSING.txt",
        `The following items were not available for ${rental.id}:\n\n- ${missing.join("\n- ")}\n`,
      );
    }

    const buf = await zip.generateAsync({ type: "uint8array" });
    // Base64 encode without exhausting the call stack on large buffers
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);

    return {
      filename: `${rental.id}_${safeName}_packet.zip`,
      base64,
      missing,
    };
  });

function guessExt(url: string, contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("webp")) return ".webp";
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? `.${m[1].toLowerCase()}` : "";
}