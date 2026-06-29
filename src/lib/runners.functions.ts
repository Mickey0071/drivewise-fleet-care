import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SavedRunner {
  id: string;
  name: string;
  phone: string;
}

/** List saved runners (alphabetical) for the create-task dropdown. */
export const listRunners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedRunner[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("runners")
      .select("id, name, phone")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, phone: r.phone }));
  });

/** Add (or update by phone) a saved runner so it populates the dropdown next time. */
export const saveRunner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; phone: string }) => {
    const name = String(d?.name ?? "").trim();
    if (!name || name.length > 120) throw new Error("Runner name is required");
    const phone = String(d?.phone ?? "").trim();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid runner phone number");
    return { name, phone };
  })
  .handler(async ({ data, context }): Promise<SavedRunner> => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("runners")
      .upsert({ name: data.name, phone: data.phone }, { onConflict: "phone" })
      .select("id, name, phone")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, name: row.name, phone: row.phone };
  });

/** Delete a saved runner. */
export const deleteRunner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "").trim();
    if (!id || id.length > 80) throw new Error("Invalid runner id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("runners").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });