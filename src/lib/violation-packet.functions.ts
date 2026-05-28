import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import JSZip from "jszip";
import { z } from "zod";

/**
 * Build a downloadable evidence packet (ZIP) for a violation — for the
 * EZPass / toll authority / parking authority. Includes a cover-sheet PDF
 * with all violation/rental/customer details plus the signed agreement,
 * driver's license, selfie, receipt, and violation photo when available.
 */
export const downloadViolationPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ violationId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: v, error: vErr } = await supabaseAdmin
      .from("violations")
      .select("*")
      .eq("id", data.violationId)
      .maybeSingle();
    if (vErr || !v) throw new Error("Violation not found");

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
              "id, start_date, end_date, returned_at, agreement_pdf_url, receipt_pdf_url, license_image_url, selfie_image_url, client_signature_url, stripe_payment_method_id",
            )
            .eq("id", v.rental_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const vehicle = vehicleRes.data;
    const driver = driverRes.data;
    const rental = rentalRes.data;

    const coverPdf = await buildCoverPdf({ v, vehicle, driver, rental });

    const zip = new JSZip();
    const missing: string[] = [];
    zip.file("00_COVER_SHEET.pdf", coverPdf);

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
      add(rental?.agreement_pdf_url, "01_SIGNED_RENTAL_AGREEMENT"),
      add(rental?.license_image_url, "02_DRIVER_LICENSE"),
      add(rental?.selfie_image_url, "03_RENTER_SELFIE"),
      add(rental?.client_signature_url, "04_SIGNATURE"),
      add(rental?.receipt_pdf_url, "05_RENTAL_RECEIPT"),
      add(v.photo_url, "06_VIOLATION_PHOTO"),
    ]);

    if (missing.length > 0) {
      zip.file(
        "MISSING.txt",
        `The following items were not available for ${v.id}:\n\n- ${missing.join("\n- ")}\n`,
      );
    }

    const buf = await zip.generateAsync({ type: "uint8array" });
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);

    const plate = (vehicle?.plate || v.license_plate || "NOPLATE")
      .toString()
      .replace(/[^a-z0-9]+/gi, "")
      .toUpperCase() || "NOPLATE";
    const dateStr = (v.date_issued || "").replace(/-/g, "");
    const filename = `VIOLATION_${v.id}_${plate}_${dateStr}.zip`;

    return { filename, base64, missing };
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
  field("Violation ID", String(v.id ?? "—"));
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