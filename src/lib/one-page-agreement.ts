/** Fit older uploaded agreements without dropping any source page or signature. */
export async function normalizeAgreementPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = source.getPages();
  if (pages.length === 0) throw new Error("The rental agreement PDF has no pages");
  if (pages.length === 1 && pages[0]?.getWidth() === 612 && pages[0]?.getHeight() === 792) return bytes;
  const output = await PDFDocument.create();
  const page = output.addPage([612, 792]);
  const cols = pages.length <= 2 ? 1 : 2;
  const rows = Math.ceil(pages.length / cols);
  const cellWidth = 576 / cols;
  const cellHeight = 756 / rows;
  const embedded = await output.embedPages(pages);
  embedded.forEach((original, index) => {
    const scale = Math.min(cellWidth / original.width, cellHeight / original.height);
    const width = original.width * scale;
    const height = original.height * scale;
    page.drawPage(original, {
      x: 18 + (index % cols) * cellWidth + (cellWidth - width) / 2,
      y: 774 - Math.floor(index / cols) * cellHeight - (cellHeight + height) / 2,
      width, height,
    });
  });
  return output.save();
}

/** Preserve vector text and images while fitting the entire agreement on Letter. */
export async function fitAgreementToOnePage(bytes: Uint8Array, contentHeight: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes);
  if (source.getPageCount() !== 1) return normalizeAgreementPdf(bytes);
  const sourcePage = source.getPage(0);
  const output = await PDFDocument.create();
  const page = output.addPage([612, 792]);
  const height = Math.min(sourcePage.getHeight(), contentHeight);
  const embedded = await output.embedPage(sourcePage, {
    left: 0, right: 612, bottom: sourcePage.getHeight() - height, top: sourcePage.getHeight(),
  });
  const scale = Math.min(1, 756 / height);
  page.drawPage(embedded, { x: (612 - 612 * scale) / 2, y: 792 - 18 - height * scale, width: 612 * scale, height: height * scale });
  return output.save();
}