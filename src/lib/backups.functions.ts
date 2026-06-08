import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBackup, currentMonthPeriod } from "@/lib/backups.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin access required");
}

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("backups")
      .select("*")
      .order("period_month", { ascending: false })
      .order("generated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { backups: data ?? [] };
  });

export const generateBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const period = data.period ?? currentMonthPeriod();
    const result = await runBackup({ period, triggeredBy: "admin" });
    return result;
  });