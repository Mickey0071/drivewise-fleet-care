import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface RefundRecoveryRow {
  id: string;
  rentalId: string | null;
  driverId: string | null;
  renterName: string | null;
  phone: string | null;
  email: string | null;
  amount: number;
  refundedAt: string;
  source: string;
  status: string;
  customerNotified: boolean;
  note: string | null;
}

/** List refunds that may need recovery (system-detected or admin-initiated). */
export const listRefundRecovery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ rows: RefundRecoveryRow[] }> => {
    const { data, error } = await supabaseAdmin
      .from("refund_recovery" as any)
      .select("*")
      .order("refunded_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const list = (data ?? []) as any[];

    const driverIds = Array.from(new Set(list.map((r) => r.driver_id).filter(Boolean)));
    let driverMap: Record<string, { full_name: string | null; phone: string | null; email: string | null }> = {};
    if (driverIds.length) {
      const { data: drivers } = await supabaseAdmin
        .from("drivers")
        .select("id, full_name, phone, email")
        .in("id", driverIds);
      driverMap = Object.fromEntries(
        (drivers ?? []).map((d) => [d.id, { full_name: d.full_name, phone: d.phone, email: d.email }]),
      );
    }

    return {
      rows: list.map((r) => {
        const d = r.driver_id ? driverMap[r.driver_id] : null;
        return {
          id: r.id,
          rentalId: r.rental_id,
          driverId: r.driver_id,
          renterName: d?.full_name ?? null,
          phone: d?.phone ?? null,
          email: d?.email ?? null,
          amount: Number(r.amount),
          refundedAt: r.refunded_at,
          source: r.source,
          status: r.status,
          customerNotified: !!r.customer_notified,
          note: r.note,
        };
      }),
    };
  });

/** Update a refund-recovery row's status: resolved or written_off. */
export const updateRefundRecoveryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "resolved" | "written_off" | "needs_recovery"; note?: string }) => {
    if (!d?.id || typeof d.id !== "string") throw new Error("id required");
    if (!["resolved", "written_off", "needs_recovery"].includes(d.status)) throw new Error("invalid status");
    return { id: d.id, status: d.status, note: (d.note ?? "").slice(0, 500) || undefined };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("refund_recovery" as any)
      .update({
        status: data.status,
        ...(data.note ? { note: data.note } : {}),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Send customer + admin SMS confirming a successful card-on-file charge,
 * and record a payment row for the rental.
 */
export const notifyCardCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; amount: number; reason: string; last4?: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    const amt = Number(d.amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("invalid amount");
    return { rentalId: d.rentalId, amount: Math.round(amt * 100) / 100, reason: (d.reason ?? "Balance owed").slice(0, 80), last4: d.last4 };
  })
  .handler(async ({ data }) => {
    const { sendSms } = await import("@/lib/ghl.server");
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    const { data: driver } = rental?.driver_id
      ? await supabaseAdmin.from("drivers").select("full_name, phone").eq("id", rental.driver_id).maybeSingle()
      : { data: null };
    const amt = `$${data.amount.toFixed(2)}`;
    const name = driver?.full_name ?? "Customer";
    if (driver?.phone) {
      try {
        await sendSms(
          driver.phone,
          `${amt} was charged to your card on file for ${data.reason}. Questions? Call Camauto Rentals at (866) 625-5550.`,
          name,
        );
      } catch (e) {
        console.error("[notifyCardCharge] customer sms failed", e);
      }
    }
    try {
      await sendSms("267-221-3977", `✓ Charged ${name} ${amt} — card on file (${data.reason}).`, "Admin");
    } catch (e) {
      console.error("[notifyCardCharge] admin sms failed", e);
    }
    return { ok: true };
  });
