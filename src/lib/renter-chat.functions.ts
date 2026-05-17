import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchRenterConversation, sendSms } from "@/lib/ghl.server";

export const getRenterConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; name?: string | null }) => {
    if (!input?.phone || typeof input.phone !== "string") throw new Error("phone required");
    return { phone: input.phone, name: input.name ?? null };
  })
  .handler(async ({ data }) => {
    return await fetchRenterConversation(data.phone, data.name);
  });

export const sendRenterMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; message: string; name?: string | null }) => {
    if (!input?.phone || typeof input.phone !== "string") throw new Error("phone required");
    if (!input?.message || typeof input.message !== "string") throw new Error("message required");
    if (input.message.length > 1000) throw new Error("message too long (max 1000 chars)");
    return { phone: input.phone, message: input.message, name: input.name ?? null };
  })
  .handler(async ({ data }) => {
    await sendSms(data.phone, data.message, data.name);
    return { ok: true };
  });