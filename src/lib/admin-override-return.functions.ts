import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

/**
 * Admin-only override: close out a rental without going through the
 * normal return-inspection workflow. Logs who did it + when in
 * rentals.notes and rentals.final_charge_breakdown.
 */
export const adminOverrideReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rental_id: string }) =>
    z.object({ rental_id: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller is an admin (NOT runner / driver / va).
    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Look up actor name for the audit trail.
    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const actorLabel =
      actorProfile?.full_name?.trim() ||
      actorProfile?.email ||
      userId;

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, returned_at, reservation_status, notes, final_charge_breakdown")
      .eq("id", data.rental_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Rental not found");

    if (
      rental.returned_at &&
      (rental.reservation_status === "returned" ||
        rental.reservation_status === "completed")
    ) {
      return { ok: true, alreadyReturned: true as const };
    }

    const nowIso = new Date().toISOString();
    const stamp = `[${nowIso}] Admin override return by ${actorLabel} (no inspection)`;
    const newNotes = rental.notes ? `${rental.notes}\n${stamp}` : stamp;

    const prevBreakdown =
      (rental.final_charge_breakdown as Record<string, unknown> | null) ?? {};
    const breakdown = {
      ...prevBreakdown,
      admin_override: true,
      admin_override_by: actorLabel,
      admin_override_user_id: userId,
      admin_override_at: nowIso,
      actual_return: nowIso,
    };

    const { data: updatedRental, error: upErr } = await supabaseAdmin
      .from("rentals")
      .update({
        returned_at: nowIso,
        reservation_status: "returned",
        notes: newNotes,
        final_charge_breakdown: breakdown,
      })
      .eq("id", rental.id)
      .select("id, reservation_status, returned_at")
      .maybeSingle();
    if (upErr) throw new Error(`Failed to close out rental: ${upErr.message}`);
    if (!updatedRental || updatedRental.reservation_status !== "returned") {
      throw new Error("Failed to close out rental: returned status did not persist");
    }

    // Flip vehicle back to available immediately after the rental is returned.
    const { data: updatedVehicle, error: vehicleErr } = await supabaseAdmin
      .from("vehicles")
      .update({ status: "available" })
      .eq("id", rental.vehicle_id)
      .select("id, status")
      .maybeSingle();
    if (vehicleErr) throw new Error(`Failed to mark vehicle available: ${vehicleErr.message}`);
    if (!updatedVehicle || updatedVehicle.status !== "available") {
      throw new Error("Failed to mark vehicle available after return");
    }

    // Notify renter via SMS (best-effort).
    let smsStatus: "sent" | "skipped_no_phone" | "failed" = "skipped_no_phone";
    try {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("phone, full_name")
        .eq("id", rental.driver_id)
        .maybeSingle();
      if (driver?.phone) {
        try {
          await sendSms(
            driver.phone,
            "Camauto: Your rental has been returned. Thanks for renting with us.",
            driver.full_name ?? null,
          );
          smsStatus = "sent";
        } catch (e) {
          smsStatus = "failed";
          console.error(
            `[admin-override-return] rental=${rental.id} sms FAILED:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    } catch (e) {
      console.error(`[admin-override-return] driver lookup failed:`, e);
    }

    console.log(
      `[admin-override-return] rental=${rental.id} by=${actorLabel} at=${nowIso} sms=${smsStatus}`,
    );

    return {
      ok: true,
      alreadyReturned: false as const,
      returned_at: nowIso,
      override_by: actorLabel,
      sms_status: smsStatus,
    };
  });