import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PacketDisputeType = "lessor_exemption_ezpass" | "improper_notice_ppa" | "other";

export interface PacketViolationItem {
  plate: string | null;
  incident_date: string | null;
  notice_date: string | null;
  document_type: string;
  amount: number;
  reference_number: string | null;
  location: string | null;
  ocr_confidence: number | null;
  requires_manual_review: boolean;
  source_filename: string | null;
}

const itemSchema = z.object({
  plate: z.string().nullable(),
  incident_date: z.string().nullable(),
  notice_date: z.string().nullable(),
  document_type: z.string(),
  amount: z.number(),
  reference_number: z.string().nullable(),
  location: z.string().nullable(),
  ocr_confidence: z.number().nullable(),
  requires_manual_review: z.boolean(),
  source_filename: z.string().nullable(),
});

/** Parse one uploaded violation document (already rendered to page images). */
export const parseViolationUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        images: z.array(z.string().min(10)).min(1).max(20),
        filename: z.string().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ items: PacketViolationItem[] }> => {
    const { extractTollsAndDocFromImages } = await import("@/lib/ezpass.server");
    const { tolls, doc } = await extractTollsAndDocFromImages(data.images);
    const filename = data.filename ?? null;
    if (tolls.length === 0) {
      return {
        items: [
          {
            plate: null,
            incident_date: doc.incident_date,
            notice_date: doc.notice_date,
            document_type: doc.document_type,
            amount: 0,
            reference_number: null,
            location: null,
            ocr_confidence: doc.ocr_confidence,
            requires_manual_review: true,
            source_filename: filename,
          },
        ],
      };
    }
    return {
      items: tolls.map((t) => ({
        plate: t.plate,
        incident_date: t.violation_date ?? doc.incident_date,
        notice_date: doc.notice_date,
        document_type: doc.document_type,
        amount: Number(t.amount || 0),
        reference_number: t.reference_number ?? null,
        location: t.location ?? null,
        ocr_confidence: doc.ocr_confidence,
        requires_manual_review:
          doc.requires_manual_review || !(t.violation_date ?? doc.incident_date),
        source_filename: filename,
      })),
    };
  });

export interface PacketRenterOption {
  id: string;
  name: string;
}

export const listPacketRenters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PacketRenterOption[]> => {
    const { data, error } = await context.supabase
      .from("drivers")
      .select("id, full_name")
      .order("full_name", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((d) => Boolean(d.full_name))
      .map((d) => ({ id: d.id as string, name: d.full_name as string }));
  });

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(160),
  renterId: z.string().nullable(),
  renterName: z.string().nullable(),
  disputeType: z.enum(["lessor_exemption_ezpass", "improper_notice_ppa", "other"]),
  status: z.enum(["DRAFT", "DISPUTED"]),
  items: z.array(itemSchema).min(1).max(500),
  notes: z.string().max(4000).nullable().optional(),
  createdVia: z.enum(["upload", "manual"]).optional(),
  /** base64 PDF, only when generating. */
  pdfBase64: z.string().optional(),
});

export const saveDisputePacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; pdfUrl: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dates = data.items
      .map((i) => i.incident_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    const total = data.items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const plates = Array.from(new Set(data.items.map((i) => i.plate).filter(Boolean)));

    const row = {
      name: data.name,
      renter_id: data.renterId,
      renter_name: data.renterName,
      dispute_type: data.disputeType,
      status: data.status,
      plate: plates.join(", ") || null,
      violation_count: data.items.length,
      total_amount: Number(total.toFixed(2)),
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
      items: data.items as unknown,
      created_by: context.userId ?? null,
      notes: data.notes ?? null,
      created_via: data.createdVia ?? "upload",
      generated_at: data.status === "DISPUTED" ? new Date().toISOString() : null,
    };

    let id = data.id ?? null;
    if (id) {
      const { error } = await supabaseAdmin
        .from("dispute_packets")
        .update(row as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await supabaseAdmin
        .from("dispute_packets")
        .insert(row as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = (ins as { id: string }).id;
    }

    let pdfUrl: string | null = null;
    if (data.pdfBase64) {
      const bytes = Buffer.from(data.pdfBase64, "base64");
      const path = `violations/${id}.pdf`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("violation-affidavits")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(upErr.message);
      await supabaseAdmin
        .from("dispute_packets")
        .update({ pdf_path: path } as never)
        .eq("id", id);
      const { data: signed } = await supabaseAdmin.storage
        .from("violation-affidavits")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      pdfUrl = signed?.signedUrl ?? null;
    }

    return { id: id!, pdfUrl };
  });

/* ---------------- Draft list / resume / delete ---------------- */

export interface PacketDraftSummary {
  id: string;
  name: string;
  createdAt: string;
  violationCount: number;
  totalAmount: number;
}

export const listPacketDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PacketDraftSummary[]> => {
    const { data, error } = await context.supabase
      .from("dispute_packets")
      .select("id, name, created_at, violation_count, total_amount")
      .eq("status", "DRAFT")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: d.id as string,
      name: (d.name as string) ?? "Untitled packet",
      createdAt: d.created_at as string,
      violationCount: Number(d.violation_count ?? 0),
      totalAmount: Number(d.total_amount ?? 0),
    }));
  });

export interface PacketDraftDetail {
  id: string;
  name: string;
  renterId: string | null;
  renterName: string | null;
  disputeType: PacketDisputeType;
  notes: string | null;
  items: PacketViolationItem[];
}

export const getPacketDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PacketDraftDetail> => {
    const { data: row, error } = await context.supabase
      .from("dispute_packets")
      .select("id, name, renter_id, renter_name, dispute_type, notes, items")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      name: (row.name as string) ?? "",
      renterId: (row.renter_id as string | null) ?? null,
      renterName: (row.renter_name as string | null) ?? null,
      disputeType: (row.dispute_type as PacketDisputeType) ?? "lessor_exemption_ezpass",
      notes: (row.notes as string | null) ?? null,
      items: (row.items as unknown as PacketViolationItem[]) ?? [],
    };
  });

export const deletePacketDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("dispute_packets")
      .update({ status: "DELETED" } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Manual renter creation + blank agreement ---------------- */

export const createManualRenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(2).max(160),
        address: z.string().min(3).max(300),
        phone: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ id: string; name: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const digits = (s: string) => (s || "").replace(/\D/g, "");
    const rand = Math.random().toString(36).slice(2, 12).toUpperCase();
    const id = `DR-${rand}`;
    const phone = data.phone?.trim() || "";
    const { error } = await supabaseAdmin.from("drivers").insert({
      id,
      full_name: data.name.trim(),
      address: data.address.trim(),
      phone: phone || null,
      email: `${digits(phone) || rand.toLowerCase()}@manual.camauto.local`,
      license_number: "",
      license_expiry: "1970-01-01",
      status: "active",
      created_via: "manual",
      import_source: "manual_violation_match",
    } as never);
    if (error) throw new Error(error.message);
    return { id, name: data.name.trim() };
  });

export const saveBlankAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        renterId: z.string().min(1),
        plate: z.string().max(20).nullable(),
        pdfBase64: z.string().min(10),
        signedDate: z.string().min(10).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ path: string; url: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizePlate } = await import("@/lib/plate");
    const plate = normalizePlate(data.plate) || "NOPLATE";
    const path = `agreements/${data.renterId}_${plate}.pdf`;
    const bytes = Buffer.from(data.pdfBase64, "base64");
    const { error } = await supabaseAdmin.storage
      .from("agreements")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(error.message);
    const { data: signed } = await supabaseAdmin.storage
      .from("agreements")
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    const url = signed?.signedUrl ?? null;

    if (data.plate) {
      const { data: vios } = await supabaseAdmin
        .from("violations")
        .select("id, license_plate")
        .limit(2000);
      const ids = (vios ?? [])
        .filter((v) => normalizePlate(v.license_plate as string | null) === plate)
        .map((v) => v.id as string);
      if (ids.length > 0) {
        await supabaseAdmin
          .from("violations")
          .update({
            driver_id: data.renterId,
            agreement_pdf_url: url,
            agreement_signed_date: data.signedDate,
          } as never)
          .in("id", ids);
      }
    }
    return { path, url };
  });
