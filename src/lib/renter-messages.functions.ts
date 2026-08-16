import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchRenterConversation, sendSms } from "@/lib/ghl.server";

export type RenterMessage = {
  id: string;
  message: string;
  direction: "sent" | "received";
  sentAt: string;
  read: boolean;
};

/**
 * Loads the SMS thread for a renter: syncs the latest GHL conversation into
 * renter_messages (deduped on ghl_message_id) and returns the stored thread.
 */
export const listRenterMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driverId: string; phone?: string | null; name?: string | null }) => {
    if (!input?.driverId) throw new Error("driverId required");
    return { driverId: input.driverId, phone: input.phone ?? null, name: input.name ?? null };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let syncError: string | null = null;

    if (data.phone) {
      try {
        const conv = await fetchRenterConversation(data.phone, data.name);
        const rows = conv.messages
          .filter((m) => m.body?.trim())
          .map((m) => ({
            driver_id: data.driverId,
            phone: data.phone,
            message: m.body,
            direction: m.direction === "inbound" ? "received" : "sent",
            sent_at: m.dateAdded,
            ghl_message_id: m.id,
            read: m.direction !== "inbound",
          }));
        if (rows.length) {
          await supabase
            .from("renter_messages")
            .upsert(rows, { onConflict: "ghl_message_id", ignoreDuplicates: true });
        }
      } catch (e) {
        syncError = e instanceof Error ? e.message : String(e);
      }
    }

    const { data: stored, error } = await supabase
      .from("renter_messages")
      .select("id, message, direction, sent_at, read")
      .eq("driver_id", data.driverId)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    return {
      syncError,
      messages: (stored ?? []).map((r) => ({
        id: r.id,
        message: r.message,
        direction: r.direction as "sent" | "received",
        sentAt: r.sent_at,
        read: r.read,
      })) satisfies RenterMessage[],
    };
  });

export const sendRenterProfileMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driverId: string; phone: string; message: string; name?: string | null }) => {
    if (!input?.driverId) throw new Error("driverId required");
    if (!input?.phone) throw new Error("phone required");
    const message = (input.message ?? "").trim();
    if (!message) throw new Error("message required");
    if (message.length > 1000) throw new Error("message too long (max 1000 chars)");
    return { driverId: input.driverId, phone: input.phone, message, name: input.name ?? null };
  })
  .handler(async ({ data, context }) => {
    await sendSms(data.phone, data.message, data.name);
    const { error } = await context.supabase.from("renter_messages").insert({
      driver_id: data.driverId,
      phone: data.phone,
      message: data.message,
      direction: "sent",
      read: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markRenterMessagesRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driverId: string }) => {
    if (!input?.driverId) throw new Error("driverId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("renter_messages")
      .update({ read: true })
      .eq("driver_id", data.driverId)
      .eq("direction", "received")
      .eq("read", false);
    return { ok: true };
  });