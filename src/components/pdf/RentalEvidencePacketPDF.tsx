/**
 * Lightweight Evidence Packet PDF — for external use (parking authority,
 * insurance carriers, towing companies, etc.).
 *
 * Contains only: renter ID (license + selfie), violation/incident details
 * with date and amount, rental + vehicle context. Images embedded at low
 * resolution with PDF stream compression to keep size in the ~2-5MB range.
 */
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export interface EvidencePacketData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    returnedAt: string | null;
  };
  driver: {
    fullName: string;
    phone: string;
    email: string;
    licenseNumber: string;
    dlState: string;
    address: string;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    plate: string;
    vin: string;
    color: string;
  };
  violations: Array<{
    id: string;
    type: string;
    amount: number;
    dateIssued: string;
    status: string;
    notes: string | null;
  }>;
  images: {
    license: { mime: string; bytes: Uint8Array } | null;
    selfie: { mime: string; bytes: Uint8Array } | null;
  };
  /** Optional location string (e.g. parking ticket location). */
  location?: string | null;
}

const RGB_GREEN: [number, number, number] = [45, 184, 75];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [102, 102, 102];
const COLOR_BORDER: [number, number, number] = [204, 204, 204];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${(Math.round(v * 100) / 100).toFixed(2)}`;
}

export async function renderEvidencePacketPdf(data: EvidencePacketData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { rental, driver, vehicle, violations, images, location } = data;

  // `compress: true` enables FlateDecode on PDF object streams — typically
  // ~30-50% reduction on text-heavy PDFs and helps overall size.
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 40;

  function ensure(space: number) {
    if (y + space > pageH - 50) {
      doc.addPage();
      y = 40;
    }
  }
  function sectionBar(label: string) {
    ensure(28);
    doc.setFillColor(...RGB_GREEN);
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
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_TEXT);
    const wrapped = doc.splitTextToSize(value || "—", right - left - 140);
    doc.text(wrapped, left + 140, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  }

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...RGB_GREEN);
  doc.text("EVIDENCE PACKET", left, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Reservation #${rental.id}`, left, y + 28);
  doc.text(`Generated ${new Date().toLocaleString("en-US")}`, right, y + 14, { align: "right" });
  doc.text("Camauto Rentals", right, y + 28, { align: "right" });
  y += 40;
  doc.setDrawColor(...RGB_GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);
  y += 10;

  // ---- Renter ----
  sectionBar("Renter Identification");
  field("Name", driver.fullName);
  field("Phone", driver.phone);
  field("Email", driver.email);
  field("License #", `${driver.licenseNumber}${driver.dlState ? ` (${driver.dlState})` : ""}`);
  if (driver.address) field("Address", driver.address);

  // ---- Vehicle ----
  sectionBar("Vehicle");
  field("Vehicle", `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim());
  field("Plate", vehicle.plate);
  field("VIN", vehicle.vin);
  if (vehicle.color) field("Color", vehicle.color);

  // ---- Rental period ----
  sectionBar("Rental Period");
  field("Pickup", fmtDate(rental.startDate));
  field("Scheduled End", fmtDate(rental.endDate));
  field("Returned", rental.returnedAt ? fmtDate(rental.returnedAt) : "—");
  if (location) field("Location", location);

  // ---- Violations / Incidents ----
  sectionBar("Violations & Incidents");
  if (violations.length === 0) {
    ensure(16);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_MUTED);
    doc.text("No violations recorded for this rental period.", left, y);
    y += 14;
  } else {
    let total = 0;
    for (const v of violations) {
      ensure(38);
      total += Number(v.amount);
      doc.setDrawColor(...COLOR_BORDER);
      doc.setLineWidth(0.5);
      doc.rect(left, y, right - left, 32);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_TEXT);
      doc.text(`${v.type.toUpperCase()} — ${fmtDate(v.dateIssued)}`, left + 8, y + 13);
      doc.text(fmtMoney(v.amount), right - 8, y + 13, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_MUTED);
      const meta = [
        v.id ? `Ref: ${v.id}` : null,
        v.status ? `Status: ${v.status}` : null,
      ].filter(Boolean).join("    ");
      doc.text(meta, left + 8, y + 25);

      y += 36;
      if (v.notes) {
        ensure(14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...COLOR_TEXT);
        const wrapped = doc.splitTextToSize(`Notes: ${v.notes}`, right - left - 8);
        doc.text(wrapped, left + 4, y);
        y += 11 * wrapped.length + 4;
      }
    }
    ensure(20);
    y += 4;
    doc.setDrawColor(...COLOR_BORDER);
    doc.line(left, y, right, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_TEXT);
    doc.text("Total Violations", left, y);
    doc.setTextColor(...RGB_GREEN);
    doc.text(fmtMoney(total), right, y, { align: "right" });
    y += 18;
  }

  // ---- ID images (one per page, scaled down to keep file size small) ----
  function addImagePage(title: string, img: { mime: string; bytes: Uint8Array } | null) {
    if (!img) return;
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...RGB_GREEN);
    doc.text(title, left, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Reservation #${rental.id} — ${driver.fullName}`, left, 64);
    try {
      const fmt = img.mime.includes("png") ? "PNG" : "JPEG";
      // Constrain to half-page max to reduce embedded image size in the PDF.
      const maxW = (right - left) * 0.85;
      const maxH = (pageH - 120) * 0.7;
      const xCenter = left + (right - left - maxW) / 2;
      // "FAST" = lowest jsPDF image-compression overhead; embedded JPEGs
      // pass through and the doc-level `compress: true` flate-encodes streams.
      doc.addImage(img.bytes as unknown as string, fmt, xCenter, 80, maxW, maxH, undefined, "FAST");
    } catch (e) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(`Could not embed ${title}: ${e instanceof Error ? e.message : String(e)}`, left, 100);
    }
  }
  addImagePage("Driver's License", images.license);
  addImagePage("Renter Selfie", images.selfie);

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RGB_GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 30, right, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(
      `Camauto Rentals — Evidence Packet for #${rental.id}. For authorized recipient use only.`,
      left,
      pageH - 18,
    );
    doc.text(`Page ${i} of ${pages}`, right, pageH - 18, { align: "right" });
  }

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}