export interface PdfRenderResult {
  pageCount: number;
  /** Render a single 1-based page to a JPEG data URL. */
  renderPage: (pageNumber: number) => Promise<string>;
}

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdfjs-dist (and its worker) on demand so it never lands in the eager bundle. */
export function getPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjsLib, workerMod] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

export async function loadPdf(file: File): Promise<PdfRenderResult> {
  const pdfjsLib = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const renderPage = async (pageNumber: number) => {
    const page = await doc.getPage(pageNumber);
    // Scale so the largest dimension is ~1600px for legible OCR without huge payloads.
    const base = page.getViewport({ scale: 1 });
    const target = 1600;
    const scale = Math.min(3, target / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  };
  return { pageCount: doc.numPages, renderPage };
}