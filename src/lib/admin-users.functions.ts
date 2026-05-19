import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const createUserSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8).max(128),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.enum(["admin", "runner", "driver"]),
  must_reset_password: z.boolean(),
});

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Verify caller is admin
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Admins only");

    // Uniqueness check (case-insensitive)
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", data.username)
      .maybeSingle();
    if (existErr) throw new Error(existErr.message);
    if (existing) throw new Error("Username already taken.");

    const fakeEmail = `${data.username}@camauto.local`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: fakeEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        full_name: `${data.first_name} ${data.last_name}`.trim(),
        phone: data.phone ?? null,
        username: data.username,
      },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create user");

    const userId = created.user.id;

    // Ensure profile reflects metadata + must_reset_password flag
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        full_name: `${data.first_name} ${data.last_name}`.trim(),
        phone: data.phone ?? null,
        email: fakeEmail,
        username: data.username,
        must_reset_password: data.must_reset_password,
      })
      .eq("id", userId);
    if (profErr) throw new Error(profErr.message);

    // Wipe any roles (shouldn't exist) and insert chosen role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role });
    if (insErr) throw new Error(insErr.message);

    return { user_id: userId, username: data.username };
  });

export const clearMustResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ must_reset_password: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });