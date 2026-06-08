import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Only admins can manage parts");
}

function partQuoteLink(token: string): string {
  const origin = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
  return `${origin}/part-quote/${token}`;
}

const db = supabaseAdmin as any;

/** Admin: list parts suppliers for the dropdown. */
export const listPartsSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await db
      .from("parts_suppliers")
      .select("id, name, phone, active")
      .eq("active", true)
      .order("name", { ascending: true });
    return { suppliers: (data ?? []) as Array<{ id: string; name: string; phone: string; active: boolean }> };
  });

/** Admin: add a new parts supplier. */
export const addPartsSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; phone: string }) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(7).max(32),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await db
      .from("parts_suppliers")
      .insert({ name: data.name, phone: data.phone })
      .select("id, name, phone, active")
      .single();
    if (error) throw new Error(error.message);
    return { supplier: row };
  });

/** Admin: create a part inquiry and text the supplier a no-login lookup link. */
export const createPartInquiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    supplierId: string;
    partName: string;
    vin?: string;
    plate?: string;
    year?: string;
    make?: string;
    model?: string;
    subModel?: string;
    notes?: string;
  }) =>
    z.object({
      supplierId: z.string().uuid(),
      partName: z.string().trim().min(1, "Part name is required").max(200),
      vin: z.string().trim().max(32).optional(),
      plate: z.string().trim().max(16).optional(),
      year: z.string().trim().regex(/^\d{0,4}$/, "Year must be numeric").max(4).optional(),
      make: z.string().trim().max(60).optional(),
      model: z.string().trim().max(60).optional(),
      subModel: z.string().trim().max(60).optional(),
      notes: z.string().trim().max(800).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: supplier } = await db
      .from("parts_suppliers")
      .select("id, name, phone, active")
      .eq("id", data.supplierId)
      .maybeSingle();
    if (!supplier) throw new Error("Supplier not found");
    if (!supplier.active) throw new Error("This supplier is no longer active");

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const year = data.year ? parseInt(data.year, 10) : null;

    const { data: row, error } = await db
      .from("part_inquiries")
      .insert({
        token,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        supplier_phone: supplier.phone,
        part_name: data.partName,
        vin: data.vin || null,
        plate: data.plate || null,
        year: Number.isFinite(year as number) ? year : null,
        make: data.make || null,
        model: data.model || null,
        sub_model: data.subModel || null,
        notes: data.notes || null,
        status: "pending",
        link_sent_at: new Date().toISOString(),
        sent_by: context.userId,
        token_expires_at: expires,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const vehicle = [data.year, data.make, data.model, data.subModel].filter(Boolean).join(" ");
    const msg =
      `Hi ${supplier.name}, Camauto needs a price on a part:\n\n` +
      `Part: ${data.partName}\n` +
      (vehicle ? `Vehicle: ${vehicle}\n` : "") +
      `Open to look it up & send your price:\n${partQuoteLink(token)}`;
    try {
      await sendSms(supplier.phone, msg, supplier.name);
    } catch (e) {
      console.error("[parts] supplier SMS failed", e);
      throw new Error("Inquiry saved, but the text could not be sent. Check the supplier's phone number.");
    }
    return { ok: true, id: row.id };
  });

/** Admin: list all part inquiries with their quotes. */
export const listPartInquiries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await db
      .from("part_inquiries")
      .select(
        "id, supplier_name, supplier_phone, part_name, vin, plate, year, make, model, sub_model, notes, status, quote_price, quote_availability, quote_notes, quoted_at, link_sent_at, viewed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    return { items: (data ?? []) as any[] };
  });

/** Public: resolve a quote token for the supplier-facing page. */
export const getPartInquiryByToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => {
    if (!input?.token || typeof input.token !== "string") throw new Error("token required");
    return { token: input.token.slice(0, 128) };
  })
  .handler(async ({ data }) => {
    const { data: rows } = await db.rpc("get_part_inquiry_public", { _token: data.token });
    const row = (Array.isArray(rows) ? rows[0] : rows) as any;
    if (!row) return { found: false } as const;
    // Mark as viewed (best-effort, first view only)
    try {
      await db
        .from("part_inquiries")
        .update({ viewed_at: new Date().toISOString() })
        .eq("token", data.token)
        .is("viewed_at", null);
    } catch {
      /* ignore */
    }
    return {
      found: true as const,
      supplierName: (row.supplier_name as string) || "",
      partName: (row.part_name as string) || "",
      vin: (row.vin as string) || "",
      plate: (row.plate as string) || "",
      year: row.year ?? null,
      make: (row.make as string) || "",
      model: (row.model as string) || "",
      subModel: (row.sub_model as string) || "",
      notes: (row.notes as string) || "",
      status: (row.status as string) || "pending",
      quotePrice: row.quote_price ?? null,
      quoteAvailability: (row.quote_availability as string) || "",
      quoteNotes: (row.quote_notes as string) || "",
      expired: row.expired === true,
    };
  });

/** Public: supplier submits a price/availability for the part. */
export const submitPartQuote = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    price: string;
    availability: string;
    notes?: string;
  }) =>
    z.object({
      token: z.string().min(1).max(128),
      price: z.string().trim().min(1, "Enter a price").max(20).regex(/^\$?\d+(\.\d{1,2})?$/, "Enter a valid dollar amount"),
      availability: z.enum(["in_stock", "order", "unavailable"]),
      notes: z.string().trim().max(800).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: inquiry } = await db
      .from("part_inquiries")
      .select("id, status, token_expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!inquiry) throw new Error("This link is invalid.");
    const exp = inquiry.token_expires_at;
    if (exp && new Date(exp).getTime() < Date.now()) {
      throw new Error("This link has expired. Please ask Camauto to resend it.");
    }
    if (inquiry.status === "closed") {
      throw new Error("This request has been closed and can no longer be quoted.");
    }
    const price = parseFloat(data.price.replace(/[$,]/g, ""));
    if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid price.");

    const { error } = await db
      .from("part_inquiries")
      .update({
        quote_price: price,
        quote_availability: data.availability,
        quote_notes: data.notes || null,
        quoted_at: new Date().toISOString(),
        status: "quoted",
      })
      .eq("id", inquiry.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: close an inquiry once handled. */
export const closePartInquiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await db
      .from("part_inquiries")
      .update({ status: "closed" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });