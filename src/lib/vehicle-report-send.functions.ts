import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const schema = z.object({
  channel: z.enum(["email", "sms", "both"]),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  recipientName: z.string().trim().optional(),
  subject: z.string().min(1),
  html: z.string().min(1),
  smsText: z.string().min(1),
});

export const sendVehicleReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { sendSms, sendEmail } = await import("@/lib/ghl.server");
    const errors: string[] = [];
    let smsSent = false;
    let emailSent = false;

    const wantEmail = data.channel === "email" || data.channel === "both";
    const wantSms = data.channel === "sms" || data.channel === "both";

    if (wantEmail) {
      const email = (data.email || "").trim();
      if (!email || !email.includes("@")) {
        errors.push("A valid email address is required.");
      } else {
        try {
          await sendEmail(email, data.subject, data.html, {
            name: data.recipientName ?? null,
            phone: data.phone ?? null,
          });
          emailSent = true;
        } catch (e) {
          errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (wantSms) {
      const phone = (data.phone || "").trim();
      if (!phone) {
        errors.push("A phone number is required.");
      } else {
        try {
          await sendSms(phone, data.smsText, data.recipientName ?? null);
          smsSent = true;
        } catch (e) {
          errors.push(`SMS failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return { smsSent, emailSent, errors };
  });