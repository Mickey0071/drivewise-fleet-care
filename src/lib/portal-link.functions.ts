import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequestHeader } from "@tanstack/react-start/server";
import { notifyRenter } from "@/lib/renter-notify.server";

export interface PortalLinkSend {
  at: string;
  phone: string | null;
  email: string | null;
}

function genPortalToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveOrigin(provided?: string): string {
  if (provided) {
    try {
      return new URL(provided).origin;
    } catch {
      /* fall through */
    }
  }
  const header = getRequestHeader("origin") || getRequestHeader("referer");
  if (header) {
    try {
      return new URL(header).origin;
    } catch {
      /* fall through */
    }
  }
  return (process.env.PUBLIC_APP_ORIGIN ?? "").replace(/\/+$/, "");
}

/**
 * Send the renter a link to create their account and view their rental.
 * Sends SMS + branded email (no password is ever included — the renter sets
 * their own on the signup page). Each send is appended to the rental's
 * portal_link_sends log so staff can see when links went out.
 */
export const sendPortalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rentalId: z.string().min(1).max(100),
        origin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, reservation_status, portal_link_sends")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Reservation not found");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, full_name, email, phone")
      .eq("id", rental.driver_id)
      .maybeSingle();

    const phone = driver?.phone ?? null;
    const email = driver?.email ?? null;
    if (!phone && !email) {
      throw new Error("No phone or email on file for this renter");
    }

    const origin = resolveOrigin(data.origin);
    if (!origin) throw new Error("App origin not configured");

    // Generate a unique token tied to this reservation and store it (30-day
    // expiry handled by the DB default). The token is the only key that
    // unlocks the renter-facing portal page.
    const token = genPortalToken();
    const { error: tokErr } = await supabaseAdmin
      .from("portal_tokens")
      .insert({ reservation_id: rental.id, token });
    if (tokErr) throw new Error(tokErr.message);
    const portalUrl = `${origin}/portal/${encodeURIComponent(token)}`;

    const result = await notifyRenter({
      phone,
      email,
      name: driver?.full_name ?? null,
      sms: `View your rental, extensions & make a payment: ${portalUrl}`,
      emailSubject: "Your Rental Portal",
      emailHeading: "Your Rental Portal",
      emailIntro:
        "Click the button below to view your reservation, extensions, and make a payment anytime — no login required.",
      emailCta: { label: "Open My Rental Portal", url: portalUrl },
      emailFootnote:
        "This secure link is personal to you. This link expires in 30 days.",
    });

    if (!result.smsSent && !result.emailSent) {
      throw new Error(result.errors.join("; ") || "Could not send portal link");
    }

    const entry: PortalLinkSend = {
      at: new Date().toISOString(),
      phone: result.smsSent ? phone : null,
      email: result.emailSent ? email : null,
    };
    const existing = Array.isArray(rental.portal_link_sends)
      ? (rental.portal_link_sends as unknown as PortalLinkSend[])
      : [];
    const sends = [...existing, entry];
    await supabaseAdmin
      .from("rentals")
      .update({ portal_link_sends: sends as any })
      .eq("id", rental.id);

    return {
      ok: true as const,
      url: portalUrl,
      smsSent: result.smsSent,
      emailSent: result.emailSent,
      sends,
    };
  });

/**
 * Public — let a renter create (or claim) their account from the portal-signup
 * page using the rental UUID they received in their SMS/email. They set their
 * own password; the account is linked to the rental's driver record and given
 * the "driver" role so they can sign in and see /my-rentals.
 */
export const createPortalAccount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        rentalId: z.string().min(1).max(100),
        password: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Reservation not found");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, full_name, email, phone")
      .eq("id", rental.driver_id)
      .maybeSingle();
    if (!driver) throw new Error("Renter record not found");

    const rawEmail = (driver.email ?? "").trim().toLowerCase();
    const email =
      rawEmail && rawEmail.includes("@") && !rawEmail.endsWith("@camauto.local")
        ? rawEmail
        : `${driver.id.toLowerCase()}@camauto.local`;

    let userId: string | null = null;
    const { data: byDriver } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("driver_ref", driver.id)
      .maybeSingle();
    if (byDriver?.id) userId = byDriver.id;
    if (!userId) {
      const { data: byEmail } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (byEmail?.id) userId = byEmail.id;
    }

    if (userId) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password: data.password, email_confirm: true },
      );
      if (updErr) throw new Error(updErr.message);
    } else {
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: driver.full_name ?? null,
            phone: driver.phone ?? null,
          },
        });
      if (createErr || !created.user) {
        throw new Error(createErr?.message ?? "Failed to create account");
      }
      userId = created.user.id;
    }

    await supabaseAdmin
      .from("profiles")
      .update({
        driver_ref: driver.id,
        full_name: driver.full_name ?? null,
        phone: driver.phone ?? null,
        email,
      })
      .eq("id", userId);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(roles ?? []).some((r) => r.role === "driver")) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "driver" });
    }

    return { ok: true as const, email };
  });
