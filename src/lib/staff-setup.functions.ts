import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms, normalizePhone } from "@/lib/ghl.server";

const ROLES = ["admin", "runner", "driver", "va"] as const;

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!(data ?? []).some((r) => r.role === "admin")) throw new Error("Admins only");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const sendStaffSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      email: z.string().trim().email().max(255),
      phone: z.string().trim().min(7).max(40),
      first_name: z.string().trim().max(80).optional().nullable(),
      last_name: z.string().trim().max(80).optional().nullable(),
      role: z.enum(ROLES),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // One token per email — remove any existing
    await supabaseAdmin
      .from("staff_setup_tokens")
      .delete()
      .ilike("email", data.email);

    const token = randomToken();
    const { error: insErr } = await supabaseAdmin
      .from("staff_setup_tokens")
      .insert({
        token,
        email: data.email.toLowerCase(),
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        phone: data.phone,
        role: data.role,
        created_by: context.userId,
      });
    if (insErr) throw new Error(insErr.message);

    const origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    const link = `${origin.replace(/\/+$/, "")}/setup/${token}`;
    const message = `You've been invited to set up your Camauto Rentals account. Complete setup within 24 hours: ${link}`;
    await sendSms(normalizePhone(data.phone), message, [data.first_name, data.last_name].filter(Boolean).join(" ") || null);

    return { ok: true };
  });

export const getStaffSetupToken = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(10).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("staff_setup_tokens")
      .select("token, email, first_name, last_name, phone, role, expires_at, consumed_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.consumed_at) return { ok: false as const, reason: "consumed" as const };
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false as const, reason: "expired" as const };
    }
    return {
      ok: true as const,
      email: row.email,
      role: row.role as (typeof ROLES)[number],
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
    };
  });

export const completeStaffSetup = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(10).max(128),
      password: z.string().min(8).max(128),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("staff_setup_tokens")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Invalid setup link");
    if (row.consumed_at) throw new Error("This setup link has already been used");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("This setup link has expired");
    }

    const email = (row.email as string).toLowerCase();
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ") || null;

    // Look for an existing auth user with this email
    let userId: string | null = null;
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("real_email", email)
      .maybeSingle();
    if (existingProfile?.id) userId = existingProfile.id;

    if (userId) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
      });
      if (updErr) throw new Error(updErr.message);
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          full_name: fullName,
          phone: row.phone ?? null,
        },
      });
      if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create user");
      userId = created.user.id;

      await supabaseAdmin.from("profiles").update({
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        full_name: fullName,
        phone: row.phone ?? null,
        email,
        real_email: email,
        must_reset_password: false,
      }).eq("id", userId);
    }

    // Assign role (replace any existing)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: row.role });
    if (roleErr) throw new Error(roleErr.message);

    // Consume + delete token (one-time use)
    await supabaseAdmin.from("staff_setup_tokens").delete().eq("token", data.token);

    return { ok: true, email };
  });