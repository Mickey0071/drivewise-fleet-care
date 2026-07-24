import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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

    const missing: string[] = [];
    const parts: Array<{ label: string; url?: string | null }> = [
      { label: "Signed Rental Agreement", url: rental.agreement_pdf_url },
      { label: "Rental Receipt", url: rental.receipt_pdf_url },
      { label: "Driver's License", url: rental.license_image_url },
      { label: "Renter Selfie", url: rental.selfie_image_url },
      { label: "Renter Signature", url: rental.client_signature_url },
    ];

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const out = await PDFDocument.create();
    for (const part of parts) {
      if (!part.url) {
        missing.push(part.label);
        continue;
      }
      try {
        const res = await fetch(part.url);
        if (!res.ok) {
          missing.push(`${part.label} (http ${res.status})`);
          continue;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        const looksPdf = ct.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
        if (looksPdf) {
          const src = await PDFDocument.load(buf);
          const pages = await out.copyPages(src, src.getPageIndices());
          for (const p of pages) out.addPage(p);
        } else {
          const isPng = ct.includes("png") || (buf[0] === 0x89 && buf[1] === 0x50);
          const img = isPng ? await out.embedPng(buf) : await out.embedJpg(buf);
          const page = out.addPage([612, 792]);
          const margin = 36;
          const maxW = 612 - margin * 2;
          const maxH = 792 - margin * 2 - 20;
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          const font = await out.embedFont(StandardFonts.HelveticaBold);
          page.drawText(part.label, { x: margin, y: 792 - margin, size: 11, font, color: rgb(0.1, 0.4, 0.2) });
          page.drawImage(img, { x: (612 - w) / 2, y: (792 - h) / 2 - 10, width: w, height: h });
        }
      } catch (e) {
        missing.push(`${part.label} (${e instanceof Error ? e.message : "fetch failed"})`);
      }
    }
    const merged = await out.save();
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < merged.length; i += chunk) {
      bin += String.fromCharCode(...merged.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);

    return {
      filename: `${rental.id}_${safeName}_packet.pdf`,
      base64,
      missing,
    };
  });
