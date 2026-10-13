import type { jsPDF as JsPDF } from "jspdf";
import { BRAND_COMPANY, BRAND_LOGO_DATA_URL, BRAND_RGB, generatedStamp } from "@/lib/branding";

export const PDF_HEADER_H = 92;

/** Draws the branded header block at the top of the current page. Returns y below it. */
export function drawBrandedPdfHeader(doc: JsPDF, title?: string, period?: string): number {
  const pageW = doc.internal.pageSize.getWidth();
  const left = 36, right = pageW - 36;
  doc.addImage(BRAND_LOGO_DATA_URL, "JPEG", left, 18, 72, 46);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...BRAND_RGB.green);
  doc.text(BRAND_COMPANY.legal, left + 84, 32);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_RGB.dark);
  doc.text(BRAND_COMPANY.address, left + 84, 44);
  doc.text(BRAND_COMPANY.contact, left + 84, 55);
  if (title) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BRAND_RGB.dark);
    doc.text(title, right, 32, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_RGB.muted);
    if (period) doc.text(`Period: ${period}`, right, 44, { align: "right" });
    doc.text(`Generated: ${generatedStamp()}`, right, period ? 55 : 44, { align: "right" });
  }
  doc.setDrawColor(...BRAND_RGB.green); doc.setLineWidth(2);
  doc.line(left, 72, right, 72);
  doc.setTextColor(...BRAND_RGB.dark);
  return PDF_HEADER_H;
}

/**
 * Call once right before saving. Stamps the logo header on every page that
 * doesn't have it yet (pages > skipHeaderOnFirst) plus page numbers + confidential footer.
 */
export function finalizeBrandedPdf(doc: JsPDF, opts: { title?: string; period?: string; headerOnPages?: "all" | "after-first" | "none" } = {}) {
  const n = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const mode = opts.headerOnPages ?? "after-first";
    if (mode === "all" || (mode === "after-first" && i > 1)) drawBrandedPdfHeader(doc, opts.title, opts.period);
    doc.setDrawColor(...BRAND_RGB.green); doc.setLineWidth(0.6);
    doc.line(36, pageH - 30, pageW - 36, pageH - 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_RGB.muted);
    doc.text(BRAND_COMPANY.footer, 36, pageH - 18);
    doc.text(`Page ${i} of ${n}`, pageW - 36, pageH - 18, { align: "right" });
  }
  doc.setTextColor(...BRAND_RGB.dark);
}

type Cell = string | number | null | undefined;

/** Branded landscape table PDF for any tabular report. */
export async function downloadBrandedTablePdf(filename: string, spec: { title: string; period?: string; headers: string[]; rows: Cell[][] }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 36, width = pageW - 72;
  const colW = width / Math.max(spec.headers.length, 1);
  const fmt = (v: Cell) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? ""));
  const clip = (s: string) => {
    let t = s;
    while (t.length > 1 && doc.getTextWidth(t) > colW - 6) t = t.slice(0, -2);
    return t === s ? s : t + "…";
  };
  const drawHead = (y: number) => {
    doc.setFillColor(...BRAND_RGB.dark); doc.rect(left, y, width, 18, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    spec.headers.forEach((h, i) => doc.text(clip(h), left + i * colW + 3, y + 12));
    return y + 18;
  };
  let y = drawBrandedPdfHeader(doc, spec.title, spec.period);
  y = drawHead(y);
  spec.rows.forEach((r, ri) => {
    if (y + 16 > pageH - 40) { doc.addPage(); y = drawHead(drawBrandedPdfHeader(doc, spec.title, spec.period)); }
    if (ri % 2 === 1) { doc.setFillColor(...BRAND_RGB.band); doc.rect(left, y, width, 16, "F"); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    r.forEach((v, i) => {
      if (typeof v === "number") doc.setTextColor(...(v < 0 ? BRAND_RGB.red : BRAND_RGB.dark));
      else doc.setTextColor(...BRAND_RGB.dark);
      doc.text(clip(fmt(v)), left + i * colW + 3, y + 11);
    });
    y += 16;
  });
  finalizeBrandedPdf(doc, { headerOnPages: "none" });
  doc.save(filename.endsWith(".pdf") ? filename : `${filename.replace(/\.(csv|xlsx)$/i, "")}.pdf`);
}
