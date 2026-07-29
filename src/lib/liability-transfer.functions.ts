import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
  type AuthorityAddress,
  loadViolationCtx,
  buildCoverLetterPdf,
  generateAndStoreLiabilityTransfer,
} from "@/lib/liability-transfer.server";

export type { AuthorityAddress } from "@/lib/liability-transfer.server";

/** List authority addresses for the cover-letter target picker / admin editor. */
export const getAuthorityAddresses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<AuthorityAddress[]> => {
    const { data, error } = await supabaseAdmin
      .from("authority_addresses")
      .select("*")
      .order("region", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AuthorityAddress[];
  });

/** Create or update an authority address. */
export const upsertAuthorityAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        key: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
        address_lines: z.string().max(2000).nullable().optional(),
        region: z.string().max(20).nullable().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const row = {
      key: data.key,
      name: data.name,
      address_lines: data.address_lines ?? null,
      region: data.region ?? null,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("authority_addresses")
        .update(row as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("authority_addresses")
        .upsert(row as never, { onConflict: "key" });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

/** Generate the NJ liability-transfer cover letter PDF (no signature required). */
export const generateLiabilityTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ pdfUrl: string | null }> => {
    return generateAndStoreLiabilityTransfer(data.violationId);
  });

/** Build a single combined mail-packet PDF (cover letter + supporting docs). */
export const generateMailPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ filename: string; base64: string; missing: string[] }> => {
    const { PDFDocument } = await import("pdf-lib");
    const ctx = await loadViolationCtx(data.violationId);
    const ref = (ctx.v.reference_number as string | null)?.trim() || "";
    if (!ref) {
      throw new Error(
        "EZPass violation / reference number is required before generating a dispute packet. Enter the number from the notice, then try again.",
      );
    }
    const cover = await buildCoverLetterPdf(ctx);
    const out = await PDFDocument.create();
    const missing: string[] = [];

    async function appendPdf(bytes: Uint8Array) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    }

    // Page 1 — Liability transfer cover letter
    await appendPdf(cover);

    // Page 2+ — Signed rental agreement, appended exactly as signed. If no
    // agreement is on file we simply skip it: the cover letter is still a
    // valid liability-transfer notice on its own.
    const agreementUrl = (ctx.rental?.agreement_pdf_url as string | null) ?? null;
    if (agreementUrl) {
      try {
        const res = await fetch(agreementUrl);
        if (res.ok) {
          const ct = (res.headers.get("content-type") ?? "").toLowerCase();
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(agreementUrl)) {
            await appendPdf(bytes);
          } else {
            missing.push("Signed rental agreement (not a PDF on file)");
          }
        } else {
          missing.push(`Signed rental agreement (http ${res.status})`);
        }
      } catch (e) {
        missing.push(
          `Signed rental agreement (${e instanceof Error ? e.message : "fetch failed"})`,
        );
      }
    } else {
      missing.push("Signed rental agreement");
    }

    const buf = await out.save();
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const plate = ((ctx.v.license_plate as string) || ctx.vehicle?.plate || "NOPLATE")
      .toString()
      .replace(/[^a-z0-9]+/gi, "")
      .toUpperCase();
    return {
      filename: `MAIL_PACKET_${data.violationId}_${plate}.pdf`,
      base64: btoa(bin),
      missing,
    };
  });

/** Mark a violation stage in the liability-transfer lifecycle. */
export const markViolationStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        stage: z.enum(["printed", "mailed", "confirmed"]),
        authorityKey: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    if (data.stage === "printed") patch.mail_packet_printed_at = now;
    if (data.stage === "mailed") {
      // Gate: do not allow "mailed" until the packet has a signed agreement
      // (live client signature or retroactively-signed agreement) OR an admin
      // override is on file for an unreachable customer.
      const { data: v } = await supabaseAdmin
        .from("violations")
        .select("rental_id, legacy_rental_id, retro_legacy_rental_id, mail_override_at")
        .eq("id", data.violationId)
        .maybeSingle();
      let signed = Boolean(v?.mail_override_at);
      if (!signed && v?.rental_id) {
        const { data: r } = await supabaseAdmin
          .from("rentals")
          .select("client_signed_at")
          .eq("id", v.rental_id)
          .maybeSingle();
        signed = Boolean(r?.client_signed_at);
      }
      if (!signed) {
        const lid = v?.retro_legacy_rental_id || v?.legacy_rental_id;
        if (lid) {
          const { data: lr } = await supabaseAdmin
            .from("legacy_rentals")
            .select("retro_signed_at")
            .eq("id", lid)
            .maybeSingle();
          signed = Boolean(lr?.retro_signed_at);
        }
      }
      if (!signed) {
        throw new Error(
          "Cannot mark mailed: the packet has no signed agreement. Send a retroactive agreement link, or use the admin override for an unreachable customer.",
        );
      }
      patch.mailed_at = now;
      patch.submitted_to_authority_at = now;
    }
    if (data.stage === "confirmed") {
      patch.transfer_confirmed_at = now;
      patch.resolved_at = now;
      patch.status = "resolved";
    }
    if (data.authorityKey) patch.authority_key = data.authorityKey;
    const { error } = await supabaseAdmin
      .from("violations")
      .update(patch as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Set which authority a violation will be mailed to. */
export const setViolationAuthority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ violationId: z.string().min(1).max(64), authorityKey: z.string().min(1).max(64) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("violations")
      .update({ authority_key: data.authorityKey, updated_at: new Date().toISOString() } as never)
      .eq("id", data.violationId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
