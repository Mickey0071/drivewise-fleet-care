/**
 * Simple one-page vehicle rental agreement generated for a manually created
 * renter: auto-filled renter/vehicle details, admin-entered rental terms,
 * lessor-exemption boilerplate, and two signature blocks.
 */
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

const GREEN: [number, number, number] = [45, 184, 75];
const TEXT: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [102, 102, 102];

export interface BlankAgreementInput {
  renterName: string;
  renterAddress: string;
  renterPhone?: string | null;
  plate: string | null;
  incidentDate: string | null;
  startDate: string;
  endDate: string;
  weeklyRate: number;
  /** PNG data URL from the signature pad. */
  signatureDataUrl?: string | null;
  signedDate: string;
}

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export async function renderBlankRentalAgreementPdf(
  input: BlankAgreementInput,
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 44;
  const right = pageW - 44;
  let y = 44;

  try {
    doc.addImage(CAMAUTO_LOGO_BASE64, "PNG", left, y, 110, 30);
  } catch {
    /* logo optional */
  }
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...TEXT);
  doc.text("VEHICLE RENTAL AGREEMENT", right, y + 14, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text("Camauto Rentals — Lessor", right, y + 28, { align: "right" });
  y += 52;
  doc.setDrawColor(...GREEN).setLineWidth(2).line(left, y, right, y);
  y += 22;

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), left, y);
    doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(...TEXT);
    doc.text(value || "—", left + 150, y);
    y += 20;
  };

  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TEXT);
  doc.text("Renter", left, y);
  y += 16;
  row("Name", input.renterName);
  row("Address", input.renterAddress);
  if (input.renterPhone) row("Phone", input.renterPhone);

  y += 6;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("Vehicle & Rental Term", left, y);
  y += 16;
  row("License plate", input.plate ?? "—");
  row("Incident date", fmt(input.incidentDate));
  row("Rental start", fmt(input.startDate));
  row("Rental end", fmt(input.endDate));
  row("Weekly rate", `$${Number(input.weeklyRate || 0).toFixed(2)}`);

  y += 8;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("Terms — Lessor Exemption & Renter Responsibility", left, y);
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...TEXT);
  const terms =
    "The renter named above took exclusive possession and control of the vehicle identified above for the rental term stated. " +
    "During that term the renter is solely responsible for all tolls, toll violations, parking violations, traffic citations, red-light and camera notices, " +
    "administrative fees, and any related penalties incurred while operating the vehicle. " +
    "Camauto Rentals is a motor vehicle rental company and the registered owner (lessor) of the vehicle. Pursuant to applicable rental-vehicle lessor provisions, " +
    "including N.J.S.A. 39:4-138.1 and the corresponding toll authority regulations, liability for such notices transfers to the lessee named above. " +
    "The renter authorizes Camauto Rentals to furnish this agreement and the renter's identifying information to any toll authority, municipality, or law enforcement agency " +
    "for the purpose of transferring liability. The renter agrees to pay or contest such notices directly.";
  const lines = doc.splitTextToSize(terms, right - left);
  doc.text(lines, left, y);
  y += lines.length * 12 + 24;

  const sigW = (right - left - 30) / 2;
  const sigY = Math.min(y, 640);
  if (input.signatureDataUrl) {
    try {
      doc.addImage(input.signatureDataUrl, "PNG", left, sigY - 46, sigW, 44);
    } catch {
      /* ignore bad signature image */
    }
  }
  doc.setDrawColor(150).setLineWidth(0.8);
  doc.line(left, sigY, left + sigW, sigY);
  doc.line(left + sigW + 30, sigY, right, sigY);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text(`Renter signature — ${input.renterName}`, left, sigY + 13);
  doc.text("Camauto Rentals representative", left + sigW + 30, sigY + 13);
  doc.text(`Date: ${fmt(input.signedDate)}`, left, sigY + 27);
  doc.text("Date: ______________________", left + sigW + 30, sigY + 27);

  return new Uint8Array(doc.output("arraybuffer"));
}
