import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { fitAgreementToOnePage } from "./one-page-agreement";

describe("one-page rental agreement", () => {
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