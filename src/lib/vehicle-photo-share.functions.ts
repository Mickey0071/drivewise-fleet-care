import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSms } from "@/lib/ghl.server";

/** Staff: text a list of vehicle photo URLs to a prospective renter. */
export const sendVehiclePhotosSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    phone: string;
    recipientName?: string;
    vehicleLabel: string;
    photoUrls: string[];
  }) => {
    const phone = (input.phone || "").trim();
    if (phone.length < 7) throw new Error("Valid phone number required");
    if (!input.vehicleLabel) throw new Error("vehicleLabel required");
    if (!Array.isArray(input.photoUrls) || input.photoUrls.length === 0) {
      throw new Error("At least one photo URL required");
    }
    if (input.photoUrls.length > 12) throw new Error("Too many photos (max 12)");
    for (const u of input.photoUrls) {
      if (typeof u !== "string" || !/^https?:\/\//.test(u)) throw new Error("Invalid photo URL");
    }
    return { ...input, phone };
  })
  .handler(async ({ data }) => {
    const msg = `Camauto Rentals — ${data.vehicleLabel} photos:\n${data.photoUrls.join("\n")}`;
    await sendSms(data.phone, msg, data.recipientName ?? null);
    return { ok: true, sent: data.photoUrls.length };
  });