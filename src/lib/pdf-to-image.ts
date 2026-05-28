import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfRenderResult {
  pageCount: number;
  /** Render a single 1-based page to a JPEG data URL. */
  renderPage: (pageNumber: number) => Promise<string>;
}

export async function loadPdf(file: File): Promise<PdfRenderResult> {
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
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  };
  return { pageCount: doc.numPages, renderPage };
}