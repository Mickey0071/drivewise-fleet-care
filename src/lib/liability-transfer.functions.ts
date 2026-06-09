import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

export interface AuthorityAddress {
  id: string;
  key: string;
  name: string;
  address_lines: string | null;
  region: string | null;
  is_active: boolean;
}

const OWNER = {
  legal: "Rentalprise LLC d/b/a Camauto Rentals",
  address: "416 Sicklerville Rd, Sicklerville NJ 08081",
  phone: "(866) 625-5550",
  email: "violations@camautorentals.com",
  signer: "Rentalprise LLC Admin",
};

function fmtMoney(n: number | null | undefined): string {
  return `$${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

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

interface ViolationCtx {
  v: Record<string, unknown>;
  vehicle: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
  rental: Record<string, unknown> | null;
  authority: AuthorityAddress | null;
}

async function loadViolationCtx(violationId: string): Promise<ViolationCtx> {
  const { data: v, error } = await supabaseAdmin
    .from("violations")
    .select("*")
    .eq("id", violationId)
    .maybeSingle();
  if (error || !v) throw new Error("Violation not found");

  const [vehicleRes, driverRes, rentalRes] = await Promise.all([
    v.vehicle_id && v.vehicle_id !== "UNKNOWN"
      ? supabaseAdmin
          .from("vehicles")
          .select("id, plate, make, model, year, vin")
          .eq("id", v.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.driver_id
      ? supabaseAdmin
          .from("drivers")
          .select(
            "id, full_name, first_name, last_name, phone, email, license_number, dl_state, license_expiry, date_of_birth, address, street_address, city, state, zip_code",
          )
          .eq("id", v.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? supabaseAdmin
          .from("rentals")
          .select(
            "id, start_date, end_date, agreement_pdf_url, license_image_url",
          )
          .eq("id", v.rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let authority: AuthorityAddress | null = null;
  const authKey = (v.authority_key as string | null) ?? "nj_ezpass";
  const { data: auth } = await supabaseAdmin
    .from("authority_addresses")
    .select("*")
    .eq("key", authKey)
    .maybeSingle();
  authority = (auth as AuthorityAddress | null) ?? null;

  return {
    v: v as Record<string, unknown>,
    vehicle: vehicleRes.data as Record<string, unknown> | null,
    driver: driverRes.data as Record<string, unknown> | null,
    rental: rentalRes.data as Record<string, unknown> | null,
    authority,
  };
}

async function buildCoverLetterPdf(ctx: ViolationCtx): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 54;
  const right = pageW - 54;
  let y = 56;

  const { v, vehicle, driver, rental, authority } = ctx;

  const ensure = (space: number) => {
    if (y + space > pageH - 60) {
      doc.addPage();
      y = 56;
    }
  };
  const line = (text: string, opts?: { bold?: boolean; size?: number; gap?: number }) => {
    ensure(16);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(text, right - left);
    doc.text(wrapped, left, y);
    y += (opts?.gap ?? 14) * (Array.isArray(wrapped) ? wrapped.length : 1);
  };
  const blank = (h = 8) => {
    y += h;
  };

  // Letterhead
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 60);
  doc.text("CAMAUTO RENTALS", left, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`${OWNER.legal} · ${OWNER.address} · ${OWNER.phone}`, left, y);
  y += 22;

  const ref = (v.reference_number as string | null) || (v.id as string);
  line(`Date: ${fmtDate(new Date().toISOString())}`);
  line(`Reference #: ${v.id as string}`);
  blank();

  const authName = authority?.name ?? "Violation Processing Authority";
  const authLines = (authority?.address_lines ?? "").split("\n").filter(Boolean);
  line(`To: ${authName}`, { bold: true });
  for (const al of authLines) line(al);
  line(`Re: Liability Transfer for Vehicle ${(v.license_plate as string) ?? vehicle?.plate ?? "—"}`, {
    bold: true,
  });
  blank();

  line(
    `Pursuant to N.J.S.A. 39:4-138.1, Camauto Rentals (Rentalprise LLC, registered rental car company) hereby provides notice of operator identity and requests transfer of liability for the violation referenced below.`,
  );
  blank();

  line("VEHICLE INFORMATION:", { bold: true });
  line(
    `- Vehicle: ${[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "—"}`,
  );
  line(`- Plate: ${(v.license_plate as string) ?? vehicle?.plate ?? "—"}`);
  line(`- VIN: ${(vehicle?.vin as string) ?? "—"}`);
  line(`- Owner: ${OWNER.legal}`);
  line(`- Address: ${OWNER.address}`);
  line(`- Phone: ${OWNER.phone}`);
  blank();

  line("VIOLATION DETAILS:", { bold: true });
  line(`- Date: ${fmtDate(v.date_issued as string)}`);
  line(`- Time: ${(v.violation_time as string) ?? "—"}`);
  line(`- Location: ${(v.location as string) ?? (v.description as string) ?? "—"}`);
  line(`- Amount: ${fmtMoney(Number(v.total_amount ?? v.amount ?? 0))}`);
  line(`- Citation/Reference #: ${ref}`);
  blank();

  const addr =
    (driver?.address as string) ||
    [driver?.street_address, driver?.city, driver?.state, driver?.zip_code]
      .filter(Boolean)
      .join(", ");
  line("RENTER INFORMATION (at time of violation):", { bold: true });
  line(`- Full Name: ${(driver?.full_name as string) ?? "—"}`);
  line(`- Address: ${addr || "—"}`);
  line(`- Driver's License: ${(driver?.license_number as string) ?? "—"}`);
  line(`- License State: ${(driver?.dl_state as string) ?? "—"}`);
  line(`- License Expiration: ${fmtDate(driver?.license_expiry as string)}`);
  line(`- Phone: ${(driver?.phone as string) ?? "—"}`);
  line(`- Email: ${(driver?.email as string) ?? "—"}`);
  line(`- Date of Birth: ${fmtDate(driver?.date_of_birth as string)}`);
  line(`- Rental Agreement #: ${(rental?.id as string) ?? "—"}`);
  line(
    `- Rental Period: ${fmtDate(rental?.start_date as string)} to ${
      rental?.end_date ? fmtDate(rental?.end_date as string) : "ongoing"
    }`,
  );
  blank();

  line("ATTACHED DOCUMENTS:", { bold: true });
  line("- Copy of signed rental agreement");
  line("- Copy of renter's driver's license (front)");
  line("- Copy of original violation notice");
  line("- Signed affidavit (if available)");
  blank();

  line(
    `Pursuant to N.J.S.A. 39:4-138.1 and applicable rental car liability transfer statutes, we hereby formally identify the above-named individual as the sole operator of the vehicle during the violation period.`,
  );
  blank();
  line(
    `We respectfully request that liability for this violation be transferred to the renter directly. We are not disputing the validity of the violation; we are merely providing required information for liability transfer per applicable law.`,
  );
  blank();
  line(
    `Please contact the renter directly using the information provided. Camauto Rentals has no further obligation regarding this matter pursuant to NJ rental car liability transfer statutes.`,
  );
  blank();
  line(
    `If you require additional documentation or have questions, please contact us at ${OWNER.email} or ${OWNER.phone}.`,
  );
  blank(16);
  line("Respectfully,");
  blank(20);
  line(OWNER.signer, { bold: true });
  line("Camauto Rentals");
  line(`Date: ${fmtDate(new Date().toISOString())}`);
  line(`Reference #: ${v.id as string}`);

  return new Uint8Array(doc.output("arraybuffer"));
}

/** Generate the NJ liability-transfer cover letter PDF (no signature required). */
export const generateLiabilityTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ pdfUrl: string | null }> => {
    const ctx = await loadViolationCtx(data.violationId);
    const pdf = await buildCoverLetterPdf(ctx);
    const path = `liability-transfer/${data.violationId}/cover-letter.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("violation-photos")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await supabaseAdmin.storage
      .from("violation-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    const pdfUrl = signed?.signedUrl ?? null;
    await supabaseAdmin
      .from("violations")
      .update({
        liability_transfer_generated_at: new Date().toISOString(),
        liability_transfer_pdf_url: pdfUrl,
        authority_key: (ctx.v.authority_key as string | null) ?? "nj_ezpass",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.violationId);
    return { pdfUrl };
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
    const cover = await buildCoverLetterPdf(ctx);

    const out = await PDFDocument.create();
    const missing: string[] = [];

    async function appendPdf(bytes: Uint8Array) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    async function appendImage(bytes: Uint8Array, contentType: string) {
      const img = contentType.includes("png")
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes);
      const page = out.addPage([612, 792]);
      const margin = 36;
      const maxW = 612 - margin * 2;
      const maxH = 792 - margin * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (612 - w) / 2, y: (792 - h) / 2, width: w, height: h });
    }
    async function addUrl(url: string | null | undefined, label: string) {
      if (!url) {
        missing.push(label);
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) {
          missing.push(`${label} (http ${res.status})`);
          return;
        }
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        const bytes = new Uint8Array(await res.arrayBuffer());
        const isPdf = ct.includes("pdf") || /\.pdf(\?|$)/i.test(url);
        if (isPdf) await appendPdf(bytes);
        else await appendImage(bytes, ct || (/\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg"));
      } catch (e) {
        missing.push(`${label} (${e instanceof Error ? e.message : "fetch failed"})`);
      }
    }

    // Page 1: cover letter
    await appendPdf(cover);
    // Supporting documents
    await addUrl(ctx.v.photo_url as string | null, "Original violation notice");
    await addUrl((ctx.rental?.license_image_url as string) ?? null, "Driver's license (front)");
    await addUrl((ctx.rental?.license_back_image_url as string) ?? null, "Driver's license (back)");
    await addUrl((ctx.rental?.agreement_pdf_url as string) ?? null, "Rental agreement");
    await addUrl((ctx.v.signed_pdf_url as string) ?? null, "Signed affidavit");

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