/**
 * Renter Profile PDF — print-ready 2-3 page export of a renter's profile.
 * Page 1: cover sheet. Page 2: personal information & summary.
 * Page 3+: rental history table. Letter size, 0.75" margins, black on white.
 */
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export interface RenterProfilePdfData {
  renterId: string;
  fullName: string;
  status: string;
  printedAt: Date;
  personal: {
    phone: string;
    email: string;
    license: string;
    dob: string;
    address: string;
  };
  stats: {
    totalRentals: number;
    totalSpent: number;
    violations: number;
    outstanding: number;
  };
  violations: Array<{ id: string; type: string; amount: number; dateIssued: string; status: string }>;
  rentals: Array<{
    id: string;
    vehicle: string;
    plate: string;
    startDate: string;
    endDate: string;
    status: string;
    rateLabel: string;
    cost: number;
  }>;
}

const GREEN: [number, number, number] = [0, 168, 84];
const TEXT: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [102, 102, 102];
const BORDER: [number, number, number] = [221, 221, 221];

function fmtMoney(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export async function renderRenterProfilePdf(data: RenterProfilePdfData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 54; // 0.75"
  const right = pageW - 54;
  const bottom = pageH - 54;
  let y = 54;

  const ensure = (space: number) => {
    if (y + space > bottom) {
      doc.addPage();
      y = 54;
    }
  };
  const heading = (label: string) => {
    ensure(28);
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...TEXT);
    doc.text(label, left, y);
    y += 6;
    doc.setDrawColor(...BORDER).setLineWidth(0.75).line(left, y, right, y);
    y += 16;
  };
  const field = (label: string, value: string, x = left, labelW = 110) => {
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(...TEXT);
    const wrapped = doc.splitTextToSize(value || "—", right - x - labelW);
    doc.text(wrapped, x + labelW, y);
    y += 13 * (Array.isArray(wrapped) ? wrapped.length : 1) + 4;
  };

  // ================= PAGE 1 — COVER SHEET =================
  try {
    doc.addImage(CAMAUTO_LOGO_BASE64, "JPEG", left, y, 120, 78);
  } catch {
    /* logo optional */
  }
  y += 92;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TEXT);
  doc.text("Camauto Rentals", left, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text("Rentalprise LLC", left, y + 13);
  doc.text("416 Sicklerville Road, Sicklerville, NJ 08081", left, y + 25);
  doc.text("Phone: (866) 625-5550", left, y + 37);
  doc.text("Email: violations@camautorentals.com", left, y + 49);
  y += 90;

  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...GREEN);
  doc.text("Renter Profile", left, y);
  y += 34;
  doc.setFontSize(18).setTextColor(...TEXT);
  doc.text(data.fullName, left, y);
  y += 24;

  // Highlighted renter ID
  const idText = data.renterId;
  doc.setFont("helvetica", "bold").setFontSize(13);
  const idW = doc.getTextWidth(idText) + 20;
  doc.setFillColor(...GREEN);
  doc.roundedRect(left, y - 14, idW, 22, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(idText, left + 10, y + 1);
  y += 34;

  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  doc.text(
    `Printed ${data.printedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} at ${data.printedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    left,
    y,
  );

  // ================= PAGE 2 — PERSONAL INFO & SUMMARY =================
  doc.addPage();
  y = 54;
  heading("Personal Information");

  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...TEXT);
  doc.text(data.fullName, left, y);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  doc.text(`${data.renterId} · Status: ${data.status || "—"}`, left, y + 14);
  y += 34;

  field("Phone", data.personal.phone);
  field("Email", data.personal.email);
  field("License", data.personal.license);
  field("Date of Birth", data.personal.dob);
  field("Address", data.personal.address);
  y += 6;

  heading("Summary");
  const statW = (right - left - 18) / 4;
  const stats: Array<[string, string]> = [
    ["Total Rentals", String(data.stats.totalRentals)],
    ["Total Spent", fmtMoney(data.stats.totalSpent)],
    ["Violations", String(data.stats.violations)],
    ["Outstanding", fmtMoney(data.stats.outstanding)],
  ];
  ensure(56);
  stats.forEach(([label, value], i) => {
    const x = left + i * (statW + 6);
    doc.setDrawColor(...BORDER).setLineWidth(0.75).rect(x, y, statW, 46);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x + statW / 2, y + 14, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...TEXT);
    doc.text(value, x + statW / 2, y + 33, { align: "center" });
  });
  y += 62;

  heading("Violations");
  if (data.violations.length === 0) {
    doc.setFont("helvetica", "italic").setFontSize(11).setTextColor(...MUTED);
    doc.text("No violations", left, y);
    y += 16;
  } else {
    doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(...TEXT);
    doc.text(`${data.violations.length} violation(s) on record:`, left, y);
    y += 15;
    for (const v of data.violations) {
      ensure(14);
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...TEXT);
      doc.text(
        `• ${v.id} — ${v.type.toUpperCase()} · ${fmtDate(v.dateIssued)} · ${fmtMoney(v.amount)} · ${v.status}`,
        left + 8,
        y,
      );
      y += 14;
    }
  }

  // ================= PAGE 3+ — RENTAL HISTORY =================
  doc.addPage();
  y = 54;
  heading("Rental History");
  if (data.rentals.length === 0) {
    doc.setFont("helvetica", "italic").setFontSize(11).setTextColor(...MUTED);
    doc.text("No rental history", left, y);
    y += 16;
  } else {
    const cols = [
      { label: "Vehicle", w: 150 },
      { label: "Plate", w: 58 },
      { label: "Start", w: 62 },
      { label: "End", w: 62 },
      { label: "Status", w: 62 },
      { label: "Rate", w: 62 },
      { label: "Cost", w: 0 }, // remainder
    ];
    const tableW = right - left;
    cols[cols.length - 1].w = tableW - cols.slice(0, -1).reduce((s, c) => s + c.w, 0);

    const drawHeader = () => {
      ensure(34);
      let x = left;
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...MUTED);
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x + 3, y);
        x += c.w;
      }
      y += 6;
      doc.setDrawColor(...BORDER).setLineWidth(1).line(left, y, right, y);
      y += 13;
    };
    drawHeader();

    let totalCost = 0;
    for (const r of data.rentals) {
      ensure(18);
      totalCost += r.cost;
      const cells = [
        r.vehicle || "—",
        r.plate || "—",
        fmtDate(r.startDate),
        r.endDate ? fmtDate(r.endDate) : "ongoing",
        r.status || "—",
        r.rateLabel || "—",
        fmtMoney(r.cost),
      ];
      let x = left;
      doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...TEXT);
      cells.forEach((cell, i) => {
        const clipped = doc.splitTextToSize(cell, cols[i].w - 6)[0] ?? "";
        doc.text(clipped, x + 3, y);
        x += cols[i].w;
      });
      y += 6;
      doc.setDrawColor(...BORDER).setLineWidth(0.5).line(left, y, right, y);
      y += 12;
    }

    // Subtotal row
    ensure(24);
    y += 2;
    doc.setDrawColor(...TEXT).setLineWidth(1).line(left, y, right, y);
    y += 15;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TEXT);
    doc.text(`Total: ${data.rentals.length} rental(s)`, left + 3, y);
    doc.text(fmtMoney(totalCost), right - 3, y, { align: "right" });
    y += 16;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDER).setLineWidth(0.75).line(left, pageH - 36, right, pageH - 36);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(
      `Camauto Rentals — Renter Profile for ${data.fullName} (${data.renterId}). Confidential.`,
      left,
      pageH - 24,
    );
    doc.text(`Page ${i} of ${pages}`, right, pageH - 24, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
