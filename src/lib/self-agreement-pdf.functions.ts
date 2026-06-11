import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { renderRentalAgreementPdf, type RentalAgreementPDFData } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";

const schema = z.object({
  firstName: z.string(), middleInitial: z.string(), lastName: z.string(),
  fullName: z.string(),
  dateOfBirth: z.string(), licenseNumber: z.string(), dlState: z.string(), licenseExpiry: z.string(),
  phone: z.string(), email: z.string(),
  streetAddress: z.string(), aptUnit: z.string(), city: z.string(), state: z.string(), zipCode: z.string(),
  altContactName: z.string(), altContactPhone: z.string(),
  year: z.string(), make: z.string(), model: z.string(), color: z.string(), plate: z.string(), vin: z.string(),
  fuelLevelPickup: z.string(), ezPassTag: z.string(),
  billingPeriod: z.string(),
  rate: z.string(), depositPaid: z.string(), startDate: z.string(), endDate: z.string(),
  signedAt: z.string(),
  /** data URL of the signature PNG from the canvas */
  signatureDataUrl: z.string(),
});

/** Convert a base64 PNG data URL to JPEG bytes that jsPDF can embed in the Worker runtime. */
async function signatureToJpeg(dataUrl: string): Promise<Buffer | null> {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const ab = Buffer.from(base64, "base64");
    // @ts-expect-error — upng-js has no types
    const UPNG = (await import("upng-js")).default;
    const jpeg = (await import("jpeg-js")).default;
    const decoded = UPNG.decode(ab);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    const w = decoded.width;
    const h = decoded.height;
    const rgb = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = rgba[i * 4 + 3] / 255;
      rgb[i * 4]     = Math.round(rgba[i * 4]     * a + 255 * (1 - a));
      rgb[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + 255 * (1 - a));
      rgb[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + 255 * (1 - a));
      rgb[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ data: rgb, width: w, height: h }, 90);
    return Buffer.from(encoded.data);
  } catch (e) {
    console.warn("[self-agreement-pdf] signature convert failed", e);
    return null;
  }
}

/**
 * Generate a clean, fully-populated rental agreement PDF directly from the
 * form data entered on the Rental Agreement Violation page. Returns the PDF
 * as a base64 string for the client to download — no screenshot, no print dialog.
 */
export const generateSelfAgreementPdf = createServerFn({ method: "POST" })
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }): Promise<{ base64: string }> => {
    const signaturePng = data.signatureDataUrl ? await signatureToJpeg(data.signatureDataUrl) : null;

    const pdfData: RentalAgreementPDFData = {
      rental: {
        id: "self",
        startDate: data.startDate,
        endDate: data.endDate || null,
        billingCadence: data.billingPeriod || null,
        billingPeriod: data.billingPeriod || null,
        rateAmount: null,
        rate: Number(data.rate) || 0,
        weeklyRate: Number(data.rate) || 0,
        depositPaid: Number(data.depositPaid) || 0,
        signedBy: data.fullName || null,
        signedAt: data.signedAt || null,
        clientSignedAt: null,
        agreementVersion: DEFAULT_SETTINGS.agreementVersion,
      },
      driver: {
        fullName: data.fullName,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        middleInitial: data.middleInitial || null,
        dateOfBirth: data.dateOfBirth || null,
        licenseNumber: data.licenseNumber,
        licenseExpiry: data.licenseExpiry || null,
        dlState: data.dlState || null,
        phone: data.phone,
        email: data.email,
        streetAddress: data.streetAddress || null,
        aptUnit: data.aptUnit || null,
        city: data.city || null,
        state: data.state || null,
        zipCode: data.zipCode || null,
        address: null,
        altContactName: data.altContactName || null,
        altContactPhone: data.altContactPhone || null,
      },
      vehicle: {
        year: data.year,
        make: data.make,
        model: data.model,
        color: data.color || null,
        plate: data.plate,
        vin: data.vin,
        mileage: 0,
        fuelLevelPickup: data.fuelLevelPickup || null,
        ezPassTag: data.ezPassTag || null,
      },
      extensions: [],
      settings: DEFAULT_SETTINGS,
      signaturePng,
    };

    const bytes = await renderRentalAgreementPdf(pdfData);
    const base64 = Buffer.from(bytes).toString("base64");
    return { base64 };
  });