import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

function originFromEnv(): string {
  return process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
}
function genToken(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface RmItem {
  type: string;
  customId?: string;
  label: string;
  due?: string;
  status?: "Pass" | "Fail" | "";
  notes?: string;
}

export interface RmCardRow {
  id: string;
  vehicle_id: string;
  inspector_name: string | null;
  inspector_phone: string | null;
  inspector_type: string;
  token: string | null;
  token_expires_at: string | null;
  mileage_at_inspection: number | null;
  items_checked: RmItem[];
  overall_notes: string | null;
  status: string;
  created_by_admin: string | null;
  created_at: string;
  submitted_at: string | null;
}

function sanitizeItems(raw: any): RmItem[] {
  return (Array.isArray(raw) ? raw : [])
    .map((i: any) => ({
      type: String(i.type ?? "").slice(0, 40),
      customId: i.customId ? String(i.customId).slice(0, 60) : undefined,
      label: String(i.label ?? "").slice(0, 120),
      due: i.due ? String(i.due).slice(0, 120) : undefined,
      status: (["Pass", "Fail", ""].includes(i.status) ? i.status : "") as RmItem["status"],
      notes: String(i.notes ?? "").slice(0, 500),
    }))
    .filter((i: RmItem) => i.label.length > 0)
    .slice(0, 30);
}

/** Admin: submit an RM Card directly (no link). */
export const submitRmCardAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    vehicleId: string;
    items: RmItem[];
    inspectorName?: string;
    inspectorPhone?: string;
    mileage?: number | null;
    overallNotes?: string;
    createdByAdmin?: string;
  }) => {
    const vehicleId = (d.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("Vehicle required");
    const items = sanitizeItems(d.items);
    if (items.length === 0) throw new Error("No items to inspect");
    if (items.some((i) => i.status !== "Pass" && i.status !== "Fail"))
      throw new Error("Set Pass or Fail for every item");
    return {
      vehicleId,
      items,
      inspectorName: (d.inspectorName ?? "").slice(0, 120),
      inspectorPhone: (d.inspectorPhone ?? "").slice(0, 40),
      mileage: d.mileage == null ? null : Number(d.mileage),
      overallNotes: (d.overallNotes ?? "").slice(0, 2000),
      createdByAdmin: (d.createdByAdmin ?? "").slice(0, 120),
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyRmSubmission } = await import("@/lib/rm-cards.server");
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("rm_cards").insert({
      vehicle_id: data.vehicleId,
      inspector_name: data.inspectorName || data.createdByAdmin || "Admin",
      inspector_phone: data.inspectorPhone || null,
      inspector_type: "admin",
      mileage_at_inspection: data.mileage,
      items_checked: data.items as any,
      overall_notes: data.overallNotes || null,
      status: "submitted",
      created_by_admin: data.createdByAdmin || null,
      submitted_at: now,
    } as any);
    if (error) throw new Error(error.message);
    const result = await applyRmSubmission({
      vehicleId: data.vehicleId,
      items: data.items,
      inspectorName: data.inspectorName || data.createdByAdmin || "Admin",
      inspectorType: "admin",
      mileage: data.mileage,
      overallNotes: data.overallNotes,
    });
    return { ok: true as const, ...result };
  });

/** Admin: create a token link and SMS it to a runner/mechanic. */
export const createRmCardLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    vehicleId: string;
    items: RmItem[];
    inspectorName: string;
    inspectorPhone: string;
    inspectorType: "runner" | "mechanic";
    mileage?: number | null;
    vehicleLabel?: string;
    createdByAdmin?: string;
  }) => {
    const vehicleId = (d.vehicleId ?? "").trim();
    if (!vehicleId) throw new Error("Vehicle required");
    const name = (d.inspectorName ?? "").trim();
    if (!name) throw new Error("Name required");
    const phone = (d.inspectorPhone ?? "").trim();
    if (!phone) throw new Error("Phone required");
    const type = d.inspectorType === "mechanic" ? "mechanic" : "runner";
    const items = sanitizeItems(d.items).map((i) => ({ ...i, status: "" as const, notes: "" }));
    if (items.length === 0) throw new Error("No items to inspect");
    return {
      vehicleId,
      items,
      inspectorName: name.slice(0, 120),
      inspectorPhone: phone.slice(0, 40),
      inspectorType: type,
      mileage: d.mileage == null ? null : Number(d.mileage),
      vehicleLabel: (d.vehicleLabel ?? "").slice(0, 120),
      createdByAdmin: (d.createdByAdmin ?? "").slice(0, 120),
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/ghl.server");
    const token = genToken();
    const expires = new Date(Date.now() + 14 * 86400_000).toISOString();
    const { error } = await supabaseAdmin.from("rm_cards").insert({
      vehicle_id: data.vehicleId,
      inspector_name: data.inspectorName,
      inspector_phone: data.inspectorPhone,
      inspector_type: data.inspectorType,
      token,
      token_expires_at: expires,
      mileage_at_inspection: data.mileage,
      items_checked: data.items as any,
      status: "sent",
      created_by_admin: data.createdByAdmin || null,
    } as any);
    if (error) throw new Error(error.message);

    const link = `${originFromEnv()}/rm-card/${token}`;
    const msg = `Hi ${data.inspectorName}, routine maintenance check needed for ${data.vehicleLabel || "a vehicle"}. Complete here: ${link}`;
    try {
      await sendSms(data.inspectorPhone, msg, data.inspectorName);
    } catch (e) {
      console.error("rm link SMS failed", e);
    }
    return { ok: true as const, token };
  });

/** Public (no auth): load an RM Card by token. */
export const getRmCardPublic = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: card } = await supabaseAdmin
      .from("rm_cards")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!card) return { state: "invalid" as const };
    const c = card as any;
    if (c.status === "submitted") return { state: "submitted" as const };
    if (c.status === "cancelled") return { state: "cancelled" as const };
    if (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now())
      return { state: "expired" as const };

    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("year, make, model, plate, mileage, last_rm_date")
      .eq("id", c.vehicle_id)
      .maybeSingle();
    const vv = (v as any) ?? {};
    return {
      state: "ok" as const,
      card: {
        id: c.id as string,
        inspectorName: c.inspector_name as string | null,
        inspectorType: c.inspector_type as string,
        items: (c.items_checked ?? []) as RmItem[],
        mileage: c.mileage_at_inspection ?? vv.mileage ?? null,
      },
      vehicle: {
        label: `${vv.year ?? ""} ${vv.make ?? ""} ${vv.model ?? ""}`.trim(),
        plate: vv.plate ?? "",
        mileage: vv.mileage ?? null,
        lastRmDate: vv.last_rm_date ?? null,
      },
    };
  });

/** Public (no auth): submit an RM Card via token. */
export const submitRmCardByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; items: RmItem[]; overallNotes?: string }) => {
    if (!d?.token || !TOKEN_RE.test(d.token)) throw new Error("Invalid link");
    const items = sanitizeItems(d.items);
    if (items.length === 0) throw new Error("No items to inspect");
    if (items.some((i) => i.status !== "Pass" && i.status !== "Fail"))
      throw new Error("Set Pass or Fail for every item");
    return { token: d.token, items, overallNotes: (d.overallNotes ?? "").slice(0, 2000) };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyRmSubmission } = await import("@/lib/rm-cards.server");
    const { data: card } = await supabaseAdmin
      .from("rm_cards")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!card) throw new Error("This link is no longer valid.");
    const c = card as any;
    if (c.status === "submitted") throw new Error("This RM Card has already been submitted.");
    if (c.status === "cancelled") throw new Error("This RM Card has been cancelled.");
    if (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now())
      throw new Error("This link has expired.");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("rm_cards")
      .update({
        items_checked: data.items as any,
        overall_notes: data.overallNotes || null,
        status: "submitted",
        submitted_at: now,
      } as any)
      .eq("id", c.id)
      .eq("status", "sent");
    if (error) throw new Error(error.message);

    const result = await applyRmSubmission({
      vehicleId: c.vehicle_id,
      items: data.items,
      inspectorName: c.inspector_name || "Inspector",
      inspectorType: c.inspector_type || "runner",
      mileage: c.mileage_at_inspection,
      overallNotes: data.overallNotes,
    });
    return { ok: true as const, ...result };
  });

/** Admin: list RM Cards (recent + per-vehicle history). */
export const listRmCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("rm_cards")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { cards: (data ?? []) as unknown as RmCardRow[] };
  });

/** Admin: cancel an unsent RM Card link. */
export const cancelRmCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: d.id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("rm_cards")
      .update({ status: "cancelled" } as any)
      .eq("id", data.id)
      .eq("status", "sent");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
