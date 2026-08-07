import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

export async function sendRenewalLinkForRental(
  rentalId: string,
  reminder: boolean,
  userId: string,
) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  const allowed = (roles ?? []).some(
    (r: any) => r.role === "admin" || r.role === "runner" || r.role === "va",
  );
  if (!allowed) throw new Error("Not authorized");

  const { data: rental } = await supabaseAdmin
    .from("rentals")
    .select("id, driver_id, end_date")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) throw new Error("Rental not found");

  const { data: driver } = await supabaseAdmin
    .from("drivers").select("full_name, phone").eq("id", rental.driver_id).maybeSingle();

  const origin = (process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app")
    .replace(/\/+$/, "");
  const link = `${origin}/my-rentals/${encodeURIComponent(rental.id)}`;

  const message = reminder
    ? `Camauto Rentals: Your rental term has passed its end date. Please renew now to stay covered: ${link}`
    : `Camauto Rentals: Your rental is due for renewal. Renew here: ${link}`;

  if (!driver?.phone) throw new Error("No phone number on file for renter");
  await sendSms(driver.phone, message, driver.full_name);

  const nowIso = new Date().toISOString();
  await supabaseAdmin.from("rentals")
    .update({ renewal_link_sent: true, renewal_link_sent_at: nowIso })
    .eq("id", rental.id);

  return { success: true, renterName: driver.full_name ?? "renter", link };
}
