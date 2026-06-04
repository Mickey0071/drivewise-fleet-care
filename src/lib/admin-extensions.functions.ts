import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_PHONE = "267-221-3977";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin access required");
}

export interface AdminOffer {
  id: string;
  token: string;
  rentalId: string;
  status: string;
  offerType: string;
  extensionChoice: string | null;
  autoPayEnabled: boolean;
  sentAt: string;
  openedAt: string | null;
  consumedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  resentCount: number;
  amount: number | null;
  signedAt: string | null;
  paidAt: string | null;
  newEndDate: string | null;
  customerName: string | null;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
}

/** List all auto-extension offers with related rental / vehicle / customer info. */
export const listAutoExtensionOffers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ offers: AdminOffer[] }> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: offers, error } = await supabaseAdmin
      .from("auto_extension_offers")
      .select("*")
      .order("sent_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = offers ?? [];
    if (list.length === 0) return { offers: [] };

    const rentalIds = [...new Set(list.map((o) => o.rental_id as string))];
    const extTokens = list.map((o) => o.extension_token as string | null).filter(Boolean) as string[];

    const { data: rentals } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id")
      .in("id", rentalIds);
    const rentalMap = new Map((rentals ?? []).map((r) => [r.id as string, r]));

    const vehicleIds = [...new Set((rentals ?? []).map((r) => r.vehicle_id as string).filter(Boolean))];
    const driverIds = [...new Set((rentals ?? []).map((r) => r.driver_id as string).filter(Boolean))];

    const { data: vehicles } = vehicleIds.length
      ? await supabaseAdmin.from("vehicles").select("id, make, model, year, plate").in("id", vehicleIds)
      : { data: [] as any[] };
    const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id as string, v]));

    const { data: drivers } = driverIds.length
      ? await supabaseAdmin.from("drivers").select("id, full_name, phone, email").in("id", driverIds)
      : { data: [] as any[] };
    const driverMap = new Map((drivers ?? []).map((d) => [d.id as string, d]));

    const { data: exts } = extTokens.length
      ? await supabaseAdmin
          .from("extension_requests")
          .select("token, additional_amount, signed_at, paid_at, new_end_date")
          .in("token", extTokens)
      : { data: [] as any[] };
    const extMap = new Map((exts ?? []).map((e) => [e.token as string, e]));

    const result: AdminOffer[] = list.map((o) => {
      const r = rentalMap.get(o.rental_id as string);
      const v = r ? vehicleMap.get(r.vehicle_id as string) : null;
      const d = r ? driverMap.get(r.driver_id as string) : null;
      const ext = o.extension_token ? extMap.get(o.extension_token as string) : null;
      return {
        id: o.id as string,
        token: o.token as string,
        rentalId: o.rental_id as string,
        status: o.status as string,
        offerType: o.offer_type as string,
        extensionChoice: (o.extension_choice as string | null) ?? null,
        autoPayEnabled: !!o.auto_pay_enabled,
        sentAt: o.sent_at as string,
        openedAt: (o.opened_at as string | null) ?? null,
        consumedAt: (o.consumed_at as string | null) ?? null,
        cancelledAt: (o.cancelled_at as string | null) ?? null,
        expiresAt: o.expires_at as string,
        resentCount: (o.resent_count as number) ?? 0,
        amount: ext ? (ext.additional_amount as number) : null,
        signedAt: ext ? ((ext.signed_at as string | null) ?? null) : null,
        paidAt: ext ? ((ext.paid_at as string | null) ?? null) : null,
        newEndDate: ext ? ((ext.new_end_date as string | null) ?? null) : null,
        customerName: d ? ((d.full_name as string | null) ?? null) : null,
        phone: d ? ((d.phone as string | null) ?? null) : null,
        email: d ? ((d.email as string | null) ?? null) : null,
        vehicle: v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : null,
      };
    });
    return { offers: result };
  });

/** Resend an extension offer link to the customer; resets expiry + bumps count. */
export const resendAutoExtensionOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().min(16).max(128) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyRenter } = await import("@/lib/renter-notify.server");

    const { data: offer, error } = await supabaseAdmin
      .from("auto_extension_offers")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!offer) throw new Error("Offer not found");
    if (offer.status === "consumed") throw new Error("This offer was already completed.");

    const r = await supabaseAdmin
      .from("rentals")
      .select("driver_id")
      .eq("id", offer.rental_id as string)
      .maybeSingle();
    const driverId = r.data?.driver_id as string | undefined;
    const d = driverId
      ? (await supabaseAdmin.from("drivers").select("full_name, phone, email").eq("id", driverId).maybeSingle()).data
      : null;

    const origin = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
    const link = `${origin}/auto-extend/${offer.token}`;

    await supabaseAdmin
      .from("auto_extension_offers")
      .update({
        status: offer.status === "expired" || offer.status === "cancelled" ? "pending" : offer.status,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        cancelled_at: null,
        resent_count: ((offer.resent_count as number) ?? 0) + 1,
      })
      .eq("token", data.token);

    try {
      await notifyRenter({
        phone: (d?.phone as string | null) ?? null,
        email: (d?.email as string | null) ?? null,
        name: (d?.full_name as string | null) ?? null,
        sms: `Camauto Rentals: Extend your rental here: ${link}`,
        emailSubject: "Extend Your Rental — Camauto Rentals",
        emailHeading: "Extend Your Rental",
        emailIntro: "Tap the button below to extend your rental.",
        emailCta: { label: "Extend Now", url: link },
      });
    } catch (e) {
      console.error("[resendAutoExtensionOffer] notify failed", e);
    }
    return { ok: true, link };
  });

/** Cancel (void) an offer link. */
export const cancelAutoExtensionOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().min(16).max(128) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("auto_extension_offers")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("token", data.token);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin manual override: extend the rental end date without payment. */
export const manualOverrideExtension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(16).max(128),
        choice: z.enum(["daily", "weekly"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: offer, error } = await supabaseAdmin
      .from("auto_extension_offers")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!offer) throw new Error("Offer not found");

    const rental = await supabaseAdmin
      .from("rentals")
      .select("id, end_date")
      .eq("id", offer.rental_id as string)
      .maybeSingle();
    if (!rental.data) throw new Error("Rental not found");

    const base = rental.data.end_date ? new Date(rental.data.end_date + "T00:00:00") : new Date();
    base.setDate(base.getDate() + (data.choice === "daily" ? 1 : 7));
    const newEnd = base.toISOString().slice(0, 10);

    await supabaseAdmin.from("rentals").update({ end_date: newEnd }).eq("id", offer.rental_id as string);
    await supabaseAdmin
      .from("auto_extension_offers")
      .update({
        status: "consumed",
        extension_choice: data.choice,
        consumed_at: new Date().toISOString(),
      })
      .eq("token", data.token);
    return { ok: true, newEndDate: newEnd };
  });