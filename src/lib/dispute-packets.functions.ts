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
