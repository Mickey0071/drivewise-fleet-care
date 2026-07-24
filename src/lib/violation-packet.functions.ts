import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

/**
 * Collect signed rental agreements for a set of matched violations so the
 * client can merge them into a single printable PDF.
 */
export const getMatchedAgreementsForPrint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationIds: z.array(z.string().min(1)).min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: viols, error } = await supabaseAdmin
      .from("violations")
      .select(
        "id, rental_id, reference_number, date_issued, amount, total_amount, license_plate",
      )
      .in("id", data.violationIds);
    if (error) throw new Error(error.message);

    type Item = {
      rentalId: string;
      violationIds: string[];
      agreementUrl: string;
      header: {
        name: string;
        plate: string;
        dateIssued: string;
        refNum: string;
        amount: number;
      };
    };
    const byRental = new Map<string, Item>();
    const skipped: Array<{ violationId: string; reason: string }> = [];

    // Group violations by rental first
    type Viol = NonNullable<typeof viols>[number];
    const rentalToViols = new Map<string, Viol[]>();
    for (const v of viols ?? []) {
      const vv = v as Viol;
      if (!vv.rental_id) {
        skipped.push({ violationId: vv.id, reason: "No rental linked" });
        continue;
      }
      const arr = rentalToViols.get(vv.rental_id) ?? [];
      arr.push(vv);
      rentalToViols.set(vv.rental_id, arr);
    }

    if (rentalToViols.size > 0) {
      const { data: rentals } = await supabaseAdmin
        .from("rentals")
        .select("id, agreement_pdf_url, driver_id")
        .in("id", Array.from(rentalToViols.keys()));

      const driverIds = Array.from(
        new Set((rentals ?? []).map((r: any) => r.driver_id).filter(Boolean)),
      );
      const driverMap = new Map<string, string>();
      if (driverIds.length > 0) {
        const { data: drivers } = await supabaseAdmin
          .from("drivers")
          .select("id, full_name")
          .in("id", driverIds);
        for (const d of drivers ?? [])
          driverMap.set((d as any).id, (d as any).full_name ?? "");
      }

      for (const r of rentals ?? []) {
        const rentalId = (r as any).id as string;
        const vs = rentalToViols.get(rentalId) ?? [];
        if (!(r as any).agreement_pdf_url) {
          for (const v of vs)
            skipped.push({ violationId: v.id, reason: "No agreement on file" });
          continue;
        }
        const first = vs[0]!;
        byRental.set(rentalId, {
          rentalId,
          violationIds: vs.map((v) => v.id),
          agreementUrl: (r as any).agreement_pdf_url,
          header: {
            name:
              driverMap.get((r as any).driver_id) || "Unknown",
            plate: first.license_plate || "",
            dateIssued: first.date_issued || "",
            refNum: first.reference_number || "",
            amount: Number(first.total_amount ?? first.amount ?? 0),
          },
        });
      }

      // Rentals that were referenced by violations but not returned by query
      for (const [rentalId, vs] of rentalToViols) {
        if (!byRental.has(rentalId) &&
            !skipped.some((s) => vs.some((v) => v.id === s.violationId))) {
          for (const v of vs)
            skipped.push({ violationId: v.id, reason: "Rental not found" });
        }
      }
    }

    return { items: Array.from(byRental.values()), skipped };
  });

/**
 * Build a downloadable evidence packet (ZIP) for a violation — for the
 * EZPass / toll authority / parking authority. Includes a cover-sheet PDF
 * with all violation/rental/customer details plus the signed agreement,
 * driver's license, selfie, receipt, and violation photo when available.
 */
export const downloadViolationPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        violationId: z.string().min(1).max(64),
        include: z
          .object({
            coverLetter: z.boolean().optional(),
            agreement: z.boolean().optional(),
            license: z.boolean().optional(),
            selfie: z.boolean().optional(),
            signature: z.boolean().optional(),
            receipt: z.boolean().optional(),
            violationPhoto: z.boolean().optional(),
          })
          .optional(),
        renterAddressOverride: z.string().max(500).optional(),
        allowUnsigned: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const inc = {
      coverLetter: data.include?.coverLetter ?? true,
      agreement: data.include?.agreement ?? true,
      license: data.include?.license ?? true,
      selfie: data.include?.selfie ?? true,
      signature: data.include?.signature ?? true,
      receipt: data.include?.receipt ?? true,
      violationPhoto: data.include?.violationPhoto ?? true,
    };
    const { data: v, error: vErr } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.violationId)
      .maybeSingle();
    if (vErr || !v) throw new Error("Violation not found");

    // Persist address override up-front so it appears in the packet cover.
    if (data.renterAddressOverride && data.renterAddressOverride.trim().length > 0) {
      const addr = data.renterAddressOverride.trim();
      if (v.driver_id) {
        await supabaseAdmin.from("drivers").update({ address: addr } as never).eq("id", v.driver_id);
      } else if (v.legacy_rental_id) {
        await supabaseAdmin
          .from("legacy_rentals")
          .update({ address: addr } as never)
          .eq("id", v.legacy_rental_id);
      }
    }

    const [vehicleRes, driverRes, rentalRes] = await Promise.all([
      v.vehicle_id && v.vehicle_id !== "UNKNOWN"
        ? supabaseAdmin
            .from("vehicles")
            .select("id, plate, make, model, year, vin, color")
            .eq("id", v.vehicle_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      v.driver_id
        ? supabaseAdmin
            .from("drivers")
            .select(
              "id, full_name, first_name, last_name, phone, email, license_number, dl_state, address, street_address, city, state, zip_code",
            )
            .eq("id", v.driver_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      v.rental_id
        ? supabaseAdmin
            .from("rentals")
            .select(
              "id, start_date, end_date, returned_at, agreement_pdf_url, receipt_pdf_url, license_image_url, selfie_image_url, client_signature_url, client_signed_at, signed_at, stripe_payment_method_id, driver_id",
            )
            .eq("id", v.rental_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const vehicle = vehicleRes.data;
    const driver = driverRes.data;
    const rental = rentalRes.data;

    // Guard: agreement cannot be included without renter address + signature.
    const [{ data: legacy }] = await Promise.all([
      v.legacy_rental_id
        ? supabaseAdmin
            .from("legacy_rentals")
            .select("address, agreement_pdf_url")
            .eq("id", v.legacy_rental_id)
            .maybeSingle()
        : Promise.resolve({ data: null as any }),
    ]);
    if (inc.agreement) {
      const addr =
        (driver?.address as string) ||
        [
          driver?.street_address,
          driver?.city,
          driver?.state,
          driver?.zip_code,
        ]
          .filter(Boolean)
          .join(", ") ||
        (legacy?.address as string) ||
        "";
      if (!addr || addr.trim().length === 0) {
        return {
          ok: false as const,
          errorCode: "missing_address" as const,
          error:
            "Renter address is missing on the rental agreement — enter it before generating the packet.",
        };
      }
      const signed = rental
        ? !!(
            (rental as any).signed_at ||
            (rental as any).client_signed_at ||
            (rental as any).client_signature_url
          )
        : !!legacy?.agreement_pdf_url;
      if (!signed && !data.allowUnsigned) {
        return {
          ok: false as const,
          errorCode: "missing_signature" as const,
          error:
            "Rental agreement has no renter signature on file — send a retroactive signing link or acknowledge to override.",
        };
      }
    }

    const missing: string[] = [];
    const parts: Array<{ label: string; url?: string | null }> = [];
    if (inc.agreement) parts.push({ label: "Signed Rental Agreement", url: rental?.agreement_pdf_url });
    if (inc.license) parts.push({ label: "Driver's License", url: rental?.license_image_url });
    if (inc.selfie) parts.push({ label: "Renter Selfie", url: rental?.selfie_image_url });
    if (inc.signature) parts.push({ label: "Renter Signature", url: rental?.client_signature_url });
    if (inc.receipt) parts.push({ label: "Rental Receipt", url: rental?.receipt_pdf_url });
    if (inc.violationPhoto) parts.push({ label: "Violation Photo", url: v.photo_url as string | null | undefined });

    const coverPdf = inc.coverLetter
      ? await buildCoverPdf({ v, vehicle, driver, rental })
      : null;

    const merged = await mergePacket(coverPdf, parts, missing);

    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < merged.length; i += chunk) {
      bin += String.fromCharCode(...merged.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);

    const plate = (vehicle?.plate || v.license_plate || "NOPLATE")
      .toString()
      .replace(/[^a-z0-9]+/gi, "")
      .toUpperCase() || "NOPLATE";
    const dateStr = (v.date_issued || "").replace(/-/g, "");
    const filename = `VIOLATION_${v.id}_${plate}_${dateStr}.pdf`;

    return { ok: true as const, filename, base64, missing };
  });

async function mergePacket(
  coverPdf: Uint8Array | null,
  parts: Array<{ label: string; url?: string | null }>,
  missing: string[],
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const out = await PDFDocument.create();
  if (coverPdf) {
    const src = await PDFDocument.load(coverPdf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
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
        // Embed image on a letter-size page
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
  return await out.save();
}

function fmtMoney(n: number | null | undefined): string {
  const x = Number(n ?? 0);
  return `$${(Math.round(x * 100) / 100).toFixed(2)}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

interface CoverArgs {
  v: Record<string, unknown>;
  vehicle: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
  rental: Record<string, unknown> | null;
}

async function buildCoverPdf({ v, vehicle, driver, rental }: CoverArgs): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 50;

  const GREEN: [number, number, number] = [45, 184, 75];
  const TEXT: [number, number, number] = [26, 26, 26];
  const MUTED: [number, number, number] = [102, 102, 102];

  function ensure(space: number) {
    if (y + space > pageH - 60) {
      doc.addPage();
      y = 50;
    }
  }
  function bar(label: string) {
    ensure(28);
    doc.setFillColor(...GREEN);
    doc.rect(left, y, right - left, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), left + 6, y + 11);
    y += 22;
  }
  function field(label: string, value: string) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT);
    const wrapped = doc.splitTextToSize(value || "—", right - left - 150);
    doc.text(wrapped, left + 150, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...GREEN);
  doc.text("CAMAUTO RENTALS", left, y);
  doc.setFontSize(13);
  doc.setTextColor(...TEXT);
  doc.text("Violation Evidence Packet", left, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${new Date().toLocaleString("en-US")}`, right, y, { align: "right" });
  doc.text("Camauto Rentals · 866-625-5550", right, y + 14, { align: "right" });
  y += 32;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);
  y += 14;

  // Violation summary
  bar("Violation Summary");
  const amt = Number(v.total_amount ?? v.amount ?? 0);
  field("EZPass Ref #", String((v as any).reference_number ?? "—"));
  field("Type", String(v.type ?? "—").toUpperCase());
  field("Date Issued", fmtDate(v.date_issued as string | null));
  field("License Plate", String(v.license_plate ?? vehicle?.plate ?? "—"));
  field("Toll / Base Amount", fmtMoney(v.amount as number));
  field("Fee", fmtMoney(v.fee as number));
  field("Total Amount", fmtMoney(amt));
  field("Status", String(v.status ?? "—").toUpperCase());
  if (v.description) field("Description", String(v.description));
  if (v.notes && v.notes !== v.description) field("Notes", String(v.notes));

  // Vehicle
  bar("Vehicle");
  if (vehicle) {
    field(
      "Vehicle",
      `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || "—",
    );
    field("Plate", String(vehicle.plate ?? "—"));
    field("VIN", String(vehicle.vin ?? "—"));
    if (vehicle.color) field("Color", String(vehicle.color));
  } else {
    field("Vehicle", "Unlinked — no vehicle on file");
  }

  // Rental / Customer
  bar("Rental & Customer");
  if (rental) {
    field("Reservation #", String(rental.id ?? "—"));
    field("Rental Period", `${fmtDate(rental.start_date as string)} → ${rental.end_date ? fmtDate(rental.end_date as string) : "ongoing"}`);
    if (rental.returned_at) field("Returned", fmtDate(rental.returned_at as string));
  } else {
    field("Reservation", "Unlinked — no rental matched this plate + date");
  }
  if (driver) {
    field("Name", String(driver.full_name ?? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() ?? "—"));
    field("Phone", String(driver.phone ?? "—"));
    field("Email", String(driver.email ?? "—"));
    field(
      "License #",
      `${driver.license_number ?? "—"}${driver.dl_state ? ` (${driver.dl_state})` : ""}`,
    );
    const addr =
      driver.address ||
      [driver.street_address, driver.city, driver.state, driver.zip_code]
        .filter(Boolean)
        .join(", ");
    if (addr) field("Address", String(addr));
  }

  // Payment
  bar("Payment Status");
  field("Status", String(v.status ?? "—").toUpperCase());
  if (v.payment_method) field("Method", String(v.payment_method));
  if (v.paid_at) field("Paid At", new Date(v.paid_at as string).toLocaleString("en-US"));
  if (v.stripe_payment_intent_id) field("Stripe PaymentIntent", String(v.stripe_payment_intent_id));
  if (v.payment_link_url) field("Payment Link", String(v.payment_link_url));
  if (!v.paid_at && !v.payment_link_url) field("Note", "No payment recorded yet.");

  // Attachments index
  bar("Attachments In This Packet");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT);
  const items = [
    "00 — Cover Sheet (this document)",
    "01 — Signed Rental Agreement (PDF)",
    "02 — Driver's License (image)",
    "03 — Renter Selfie (image)",
    "04 — Renter Signature (image)",
    "05 — Rental Receipt (PDF)",
    "06 — Violation Photo / Toll Bill (image)",
  ];
  for (const line of items) {
    ensure(14);
    doc.text(`• ${line}`, left + 6, y);
    y += 14;
  }
  ensure(20);
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    "Items not on file at the time of export are listed in MISSING.txt.",
    left,
    y,
  );

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 38, right, pageH - 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Camauto Rentals — Violation Evidence Packet for ${String(v.id ?? "")}. For authorized recipient use only.`,
      left,
      pageH - 24,
    );
    doc.text(`Page ${i} of ${pages}`, right, pageH - 24, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}