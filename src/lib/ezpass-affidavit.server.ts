/**
 * Build a pre-filled "Affidavit of Vehicle Rental" PDF for a single toll
 * violation, attesting that the named renter was in possession of the
 * vehicle at the time of the violation. Returns raw PDF bytes.
 */
export interface AffidavitData {
  violationId: string;
  violationDate: string | null;
  violationTime: string | null;
  location: string | null;
  amount: number;
  plate: string | null;
  vehicle: { year?: unknown; make?: unknown; model?: unknown; vin?: unknown } | null;
  driver: {
    full_name?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    phone?: unknown;
    email?: unknown;
    license_number?: unknown;
    dl_state?: unknown;
    address?: unknown;
    street_address?: unknown;
    city?: unknown;
    state?: unknown;
    zip_code?: unknown;
  } | null;
  rental: { id?: unknown; start_date?: unknown; end_date?: unknown } | null;
  /** When the customer e-signs, embed their signature + metadata. */
  signature?: {
    dataUrl: string;
    name: string;
    signedAt: string;
    ip?: string | null;
    userAgent?: string | null;
  } | null;
}

function fmtMoney(n: number | null | undefined): string {
  const x = Number(n ?? 0);
  return `$${(Math.round(x * 100) / 100).toFixed(2)}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "____________";
  const s = String(iso);
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export async function buildAffidavitPdf(data: AffidavitData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 56;
  const right = pageW - 56;
  let y = 56;

  const GREEN: [number, number, number] = [45, 184, 75];
  const TEXT: [number, number, number] = [26, 26, 26];
  const MUTED: [number, number, number] = [102, 102, 102];

  const d = data.driver ?? {};
  const v = data.vehicle ?? {};
  const driverName =
    String(d.full_name ?? `${d.first_name ?? ""} ${d.last_name ?? ""}`).trim() || "____________________";
  const addr =
    String(
      d.address ||
        [d.street_address, d.city, d.state, d.zip_code].filter(Boolean).join(", "),
    ) || "____________________";
  const vehicleLabel =
    `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "____________________";

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...GREEN);
  doc.text("CAMAUTO RENTALS", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Camauto Rentals · 866-625-5550", right, y - 10, { align: "right" });
  y += 14;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);
  y += 32;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TEXT);
  doc.text("AFFIDAVIT OF VEHICLE RENTAL", pageW / 2, y, { align: "center" });
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("(Toll / Violation Liability Transfer)", pageW / 2, y, { align: "center" });
  y += 28;

  const para = (text: string, gap = 16) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...TEXT);
    const lines = doc.splitTextToSize(text, right - left);
    doc.text(lines, left, y);
    y += (Array.isArray(lines) ? lines.length : 1) * 14 + gap;
  };

  para(
    "The undersigned, an authorized agent of Camauto Rentals (the \"Company\"), being duly sworn, hereby states the following to be true and correct to the best of their knowledge:",
  );

  para(
    `1. The Company is the registered owner of the following vehicle: ${vehicleLabel}, bearing license plate ${
      data.plate || "____________"
    }${v.vin ? `, VIN ${String(v.vin)}` : ""}.`,
  );

  para(
    `2. At the time of the toll/violation described below, the vehicle was rented to and in the sole possession and control of the following individual (the "Renter"):`,
    8,
  );

  // Renter detail block
  const fieldRow = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(label, left + 12, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const wrapped = doc.splitTextToSize(value || "—", right - left - 150);
    doc.text(wrapped, left + 150, y);
    y += 14 * (Array.isArray(wrapped) ? wrapped.length : 1);
  };
  fieldRow("Renter Name", driverName);
  fieldRow("Address", addr);
  fieldRow("Phone", String(d.phone ?? "—"));
  fieldRow("Email", String(d.email ?? "—"));
  fieldRow(
    "Driver's License",
    `${d.license_number ?? "—"}${d.dl_state ? ` (${d.dl_state})` : ""}`,
  );
  fieldRow(
    "Rental Period",
    `${fmtDate(data.rental?.start_date as string)} — ${
      data.rental?.end_date ? fmtDate(data.rental?.end_date as string) : "ongoing"
    }`,
  );
  if (data.rental?.id) fieldRow("Reservation #", String(data.rental.id));
  y += 12;

  para(
    `3. The toll/violation at issue occurred on ${fmtDate(data.violationDate)}${
      data.violationTime ? ` at approximately ${data.violationTime}` : ""
    }, at ${data.location || "____________"}, in the amount of ${fmtMoney(data.amount)} (Reference: ${
      data.violationId
    }).`,
  );

  para(
    "4. Pursuant to the rental agreement executed by the Renter, the Renter is solely responsible for all tolls, fees, fines, and penalties incurred during the rental period. The Company therefore requests that liability for the above-referenced toll/violation be transferred to the Renter named herein.",
  );

  para(
    "5. A copy of the executed rental agreement and the Renter's identification are available upon request.",
    24,
  );

  // Signature block
  if (y > pageH - 160) {
    doc.addPage();
    y = 64;
  }
  doc.setDrawColor(...TEXT);
  doc.setLineWidth(0.75);
  doc.line(left, y, left + 240, y);
  doc.line(right - 160, y, right, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Authorized Agent Signature", left, y);
  doc.text("Date", right - 160, y);
  y += 40;

  doc.line(left, y, left + 240, y);
  y += 12;
  doc.text("Notary Public", left, y);
  doc.text(
    `Subscribed and sworn before me this ____ day of ____________, 20____.`,
    left,
    y + 18,
  );

  // Customer e-signature block (when signed online).
  if (data.signature?.dataUrl?.startsWith("data:image/")) {
    y += 48;
    if (y > pageH - 150) {
      doc.addPage();
      y = 64;
    }
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(1);
    doc.line(left, y, right, y);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    doc.text("RENTER ELECTRONIC SIGNATURE", left, y);
    y += 14;
    try {
      const fmt = data.signature.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      doc.addImage(data.signature.dataUrl, fmt, left, y, 200, 70);
    } catch {
      /* ignore bad image */
    }
    y += 80;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`Signed by: ${data.signature.name}`, left, y);
    y += 12;
    doc.text(
      `Signed at: ${new Date(data.signature.signedAt).toLocaleString("en-US")}`,
      left,
      y,
    );
    if (data.signature.ip) {
      y += 12;
      doc.text(`IP address: ${data.signature.ip}`, left, y);
    }
    if (data.signature.userAgent) {
      y += 12;
      const ua = doc.splitTextToSize(`Device: ${data.signature.userAgent}`, right - left);
      doc.text(ua, left, y);
    }
  }

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 40, right, pageH - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Camauto Rentals — Affidavit of Vehicle Rental for ${data.violationId}.`,
      left,
      pageH - 26,
    );
    doc.text(`Page ${i} of ${pages}`, right, pageH - 26, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
