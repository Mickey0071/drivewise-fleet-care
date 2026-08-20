/**
 * Multi-violation dispute packet PDF: header, violation table, pre-filled
 * dispute language chosen by dispute type, and a signature block.
 */
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";
import type { PacketDisputeType, PacketViolationItem } from "@/lib/dispute-packets.functions";

const GREEN: [number, number, number] = [45, 184, 75];
const TEXT: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [102, 102, 102];
const BORDER: [number, number, number] = [204, 204, 204];

export interface DisputePacketPdfInput {
  packetName: string;
  renterName: string | null;
  disputeType: PacketDisputeType;
  items: PacketViolationItem[];
}

export const DISPUTE_LANGUAGE: Record<PacketDisputeType, { title: string; body: string }> = {
  lessor_exemption_ezpass: {
    title: "Lessor Exemption — Rental Vehicle Toll Liability",
    body:
      "Camauto Rentals is a motor vehicle rental company and the registered owner (lessor) of the vehicle identified in this packet. At the date and time of each toll transaction listed above, the vehicle was under a written rental agreement with the renter identified in this packet. " +
      "By executing that rental agreement, the renter expressly agreed to accept full financial and legal responsibility for all tolls, toll violations, administrative fees, fines, and penalties incurred during the rental period, and acknowledged that such charges would be transferred to them as the operator of record. " +
      "Pursuant to applicable rental-vehicle lessor provisions, including N.J.S.A. 39:4-138.1 and the corresponding toll authority regulations, liability for these toll transactions transfers to the lessee named above. " +
      "We respectfully request that these notices be dismissed as to Camauto Rentals and re-issued to the renter of record. Signed rental agreement documentation and renter identification are available upon request and are enclosed where applicable.",
  },
  improper_notice_ppa: {
    title: "Improper Notice — Parking Violation Notices",
    body:
      "Camauto Rentals disputes the notices listed above on the grounds of improper notice. The notices were not served upon the registered owner within the time and manner required, and the vehicle was in the exclusive possession and control of the renter identified in this packet at the time of each cited incident. " +
      "The renter executed a written rental agreement in which they expressly agreed to be responsible for all parking violations, citations, fines, and related administrative fees incurred while the vehicle was in their possession. " +
      "We respectfully request that these notices be dismissed as to Camauto Rentals and, where permitted, re-issued to the operator of record. Supporting rental documentation is available upon request.",
  },
  other: {
    title: "Statement of Dispute",
    body:
      "Camauto Rentals disputes the violations listed above. The vehicle identified in this packet was under a written rental agreement and in the exclusive possession and control of the renter identified above at the time of each cited incident. " +
      "Under the executed rental agreement, the renter accepted responsibility for all violations, tolls, fines, and penalties arising during the rental period. " +
      "We respectfully request review and dismissal of these notices as to Camauto Rentals, with re-issuance to the renter of record where applicable.",
  },
};

/** Contractual clause quoted on every dispute packet. */
const AGREEMENT_CLAUSE =
  '"The Renter agrees to assume full responsibility for, and to pay, all tolls, toll violations, ' +
  "parking tickets, traffic and camera citations, red-light and speed violations, impound charges, " +
  "administrative fees, fines and penalties incurred during the rental period, and authorizes Camauto " +
  "Rentals to transfer liability for any such notice to the Renter as the operator of record and to " +
  'charge the Renter for any amounts advanced on their behalf."';

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
const money = (n: number) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;

export async function renderMultiViolationDisputePdf(
  input: DisputePacketPdfInput,
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { packetName, renterName, disputeType, items } = input;

  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 36;

  const ensure = (space: number) => {
    if (y + space > pageH - 60) {
      doc.addPage();
      y = 46;
    }
  };

  const dates = items.map((i) => i.incident_date).filter((d): d is string => Boolean(d)).sort();
  const plates = Array.from(new Set(items.map((i) => i.plate).filter(Boolean))).join(", ") || "—";
  const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);

  // Header
  const logoW = 120, logoH = 78;
  doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", left, y, logoW, logoH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...GREEN);
  doc.text("DISPUTE EVIDENCE", right, y + 22, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(packetName, right, y + 38, { align: "right" });
  doc.setFontSize(8);
  doc.text("Camauto Rentals · Fleet & Compliance Department", right, y + 52, { align: "right" });
  y += logoH + 8;

  doc.setDrawColor(...GREEN);
  doc.setLineWidth(2);
  doc.line(left, y, right, y);
  y += 16;

  const field = (label: string, value: string) => {
    ensure(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT);
    doc.text(value || "—", left + 120, y);
    y += 14;
  };
  field("Plate(s)", plates);
  field("Renter", renterName || "—");
  field(
    "Date range",
    dates.length ? `${fmtDate(dates[0]!)} – ${fmtDate(dates[dates.length - 1]!)}` : "—",
  );
  field("Violations", `${items.length}   •   Total ${money(total)}`);
  y += 6;

  // Table
  const cols = [
    { label: "Plate", w: 70 },
    { label: "Incident date", w: 95 },
    { label: "Type", w: 65 },
    { label: "Amount", w: 70 },
    { label: "Notice date", w: 95 },
    { label: "Reference #", w: 0 },
  ];
  cols[cols.length - 1]!.w = right - left - cols.reduce((s, c) => s + c.w, 0);

  const headerRow = () => {
    ensure(22);
    doc.setFillColor(...GREEN);
    doc.rect(left, y, right - left, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    let x = left + 6;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, y + 11);
      x += c.w;
    }
    y += 16;
  };
  headerRow();

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.5);
  for (const it of items) {
    if (y + 18 > pageH - 60) {
      doc.addPage();
      y = 46;
      headerRow();
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT);
    const cells = [
      it.plate || "—",
      fmtDate(it.incident_date),
      it.document_type || "OTHER",
      money(it.amount),
      fmtDate(it.notice_date),
      it.reference_number || "—",
    ];
    let x = left + 6;
    cells.forEach((cell, i) => {
      const w = cols[i]!.w;
      const wrapped = doc.splitTextToSize(String(cell), w - 8);
      doc.text(Array.isArray(wrapped) ? wrapped[0]! : wrapped, x, y + 12);
      x += w;
    });
    y += 18;
    doc.line(left, y, right, y);
  }

  ensure(24);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...TEXT);
  doc.text(`Total (${items.length} violations)`, left, y);
  doc.setTextColor(...GREEN);
  doc.text(money(total), right, y, { align: "right" });
  y += 24;

  // Dispute language
  const lang = DISPUTE_LANGUAGE[disputeType];
  ensure(40);
  doc.setFillColor(...GREEN);
  doc.rect(left, y, right - left, 13, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(lang.title.toUpperCase(), left + 6, y + 9);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT);
  const body = doc.splitTextToSize(lang.body, right - left);
  for (const line of body as string[]) {
    ensure(14);
    doc.text(line, left, y);
    y += 13;
  }
  y += 20;

  // Contractual acknowledgment — quoted clause from the signed agreement.
  ensure(46);
  doc.setFillColor(...GREEN);
  doc.rect(left, y, right - left, 13, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("RENTER ACKNOWLEDGMENT OF RESPONSIBILITY (SIGNED RENTAL AGREEMENT)", left + 6, y + 9);
  y += 20;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT);
  const clause = doc.splitTextToSize(AGREEMENT_CLAUSE, right - left - 20) as string[];
  const clauseTop = y - 4;
  for (const line of clause) {
    ensure(13);
    doc.text(line, left + 14, y + 6);
    y += 12.5;
  }
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(3);
  doc.line(left + 2, clauseTop, left + 2, y + 2);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const ack = doc.splitTextToSize(
    `${renterName || "The renter"} signed the rental agreement containing the clause above prior to taking possession of the vehicle. A copy of the executed agreement is enclosed with this packet.`,
    right - left,
  ) as string[];
  for (const line of ack) {
    ensure(13);
    doc.text(line, left, y);
    y += 12;
  }
  y += 22;

  // Signature block
  ensure(90);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.5);
  doc.line(left, y + 30, left + 240, y + 30);
  doc.line(right - 180, y + 30, right, y + 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Authorized signature — Camauto Rentals", left, y + 42);
  doc.text("Date", right - 180, y + 42);
  y += 60;
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  doc.text("Camauto Rentals — Fleet & Compliance Department", left, y);

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(1);
    doc.line(left, pageH - 32, right, pageH - 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`Camauto Rentals — ${packetName}`, left, pageH - 20);
    doc.text(`Page ${i} of ${pages}`, right, pageH - 20, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
