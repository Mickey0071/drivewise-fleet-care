import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const resolveUsernameToEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ username: z.string().min(1).max(255) }).parse(input),
  )
  .handler(async ({ data }) => {
    const uname = data.username.trim().toLowerCase();
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("username", uname)
      .maybeSingle();
    return { email: row?.email ?? null };
  });