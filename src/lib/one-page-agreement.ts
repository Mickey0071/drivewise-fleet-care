/** Preserve vector text and images while fitting the entire agreement on Letter. */
export async function fitAgreementToOnePage(bytes: Uint8Array, contentHeight: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes);
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