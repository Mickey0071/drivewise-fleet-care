import { BRAND_RGB } from "@/lib/branding";

/** Both print entry points use the same two-page layout and wait for signatures. */
export async function printRtoDocument(popup: Window, documentHtml: string) {
  const color = (rgb: number[]) => `rgb(${rgb.join(",")})`;
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><title>Rent-To-Own — Camauto Rentals</title><style>
    @page { size: letter; margin: .5in; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 11px/1.2 Georgia, serif; color: ${color(BRAND_RGB.dark)}; }
    .rto-doc { width: 720px; }
    .rto-agreement { display: flow-root; }
    h1 { font-size: 17px; margin: 4px 0; color: ${color(BRAND_RGB.green)}; }
    h2 { font-size: 11px; margin: 7px 0 3px; }
    p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; font-size: inherit; }
    td, th { border: 1px solid ${color(BRAND_RGB.muted)}; padding: 3px 5px; text-align: left; }
    tr { break-inside: avoid; }
    .grid { display: grid; gap: 3px 14px; grid-template-columns: repeat(2, minmax(0,1fr)); }
    .grid:has(.rto-field) { grid-template-columns: repeat(3, minmax(0,1fr)); }
    .rto-field { border-bottom: 1px solid ${color(BRAND_RGB.muted)}; padding: 3px 0; min-width: 0; }
    .rto-l { display: block; font-size: 8px; color: ${color(BRAND_RGB.muted)}; }
    .rto-v { display: block; overflow-wrap: anywhere; }
    .text-center { text-align: center; }
    .text-xs { font-size: 9px; }
    .h-16 { height: 38px; }
    .border-b { border-bottom: 1px solid ${color(BRAND_RGB.muted)}; }
    .flex { display: flex; } .items-end { align-items: flex-end; }
    img { max-height: 38px; max-width: 100%; object-fit: contain; }
    .text-center img { display: block; margin: 0 auto; }
    .rto-break { break-before: page; padding-top: 2px; }
    .rto-break h2 { margin-top: 0; }
    .rto-break table { margin: 10px 0; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body>${documentHtml}</body></html>`);
  popup.document.close();
  await Promise.all(Array.from(popup.document.images).map(img => img.decode().catch(() => {})));
  await popup.document.fonts.ready;
  // Letter minus half-inch margins is 720 × 960 CSS pixels. Leave spare height
  // for rounding; fit each page without dropping agreement text or payment rows.
  for (const selector of [".rto-agreement", ".rto-break"]) {
    const page = popup.document.querySelector<HTMLElement>(selector);
    if (!page) continue;
    const scale = Math.min(1, 930 / page.scrollHeight);
    page.style.zoom = String(scale);
  }
  popup.focus();
  popup.print();
}