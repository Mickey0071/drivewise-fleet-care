import { createServerFn } from "@tanstack/react-start";
import { sendSms } from "@/lib/ghl.server";

export const sendRentalSms = createServerFn({ method: "POST" })
  .inputValidator((input: { phone: string; message: string; name?: string }) => {
    if (!input.phone || typeof input.phone !== "string") throw new Error("phone required");
    if (!input.message || typeof input.message !== "string") throw new Error("message required");
    if (input.message.length > 1000) throw new Error("message too long");
    return input;
  })
  .handler(async ({ data }) => {
    await sendSms(data.phone, data.message, data.name);
    return { ok: true };
  });