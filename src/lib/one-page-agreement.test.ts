import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { fitAgreementToOnePage, normalizeAgreementPdf } from "./one-page-agreement";

describe("one-page rental agreement", () => {
  for (const count of [1, 2, 3, 6]) {
    it(`preserves all ${count} original uploaded pages including the last signature on one page`, async () => {
      const source = await PDFDocument.create();
      for (let i = 0; i < count; i++) {
        const page = source.addPage([612, 792]);
        page.drawText(i === count - 1 ? "ORIGINAL SIGNATURE" : `RENTAL TERMS ${i}`);
      }
      const result = await PDFDocument.load(await normalizeAgreementPdf(await source.save()));
      expect(result.getPageCount()).toBe(1);
      expect(result.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
      if (count > 1) {
        const resources = result.getPage(0).node.Resources();
        const { PDFDict, PDFName } = await import("pdf-lib");
        const objects = resources?.lookup(PDFName.of("XObject"), PDFDict);
        expect(objects?.keys()).toHaveLength(count);
      }
    });
  }
  for (const height of [700, 1200, 4000]) {
    it(`fits all ${height} points of agreement content onto one Letter page`, async () => {
      const source = new jsPDF({ unit: "pt", format: [612, 14400] });
      source.text("Rental terms", 32, 40);
      source.text("Renter signature __________________", 32, height - 30);
      const bytes = await fitAgreementToOnePage(new Uint8Array(source.output("arraybuffer")), height);
      const result = await PDFDocument.load(bytes);
      expect(result.getPageCount()).toBe(1);
      expect(result.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    });
  }
});