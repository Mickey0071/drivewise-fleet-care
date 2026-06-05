import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
  extractTollsFromImages,
  autoMatchToll,
  type MatchCandidate,
} from "@/lib/ezpass.server";
import { buildAffidavitPdf } from "@/lib/ezpass-affidavit.server";

export interface EzpassBatchItem {
  id: string;
  batch_id: string;
  violation_date: string | null;
  violation_time: string | null;
  plate: string | null;
  location: string | null;
  amount: number;
  match_status: string;
  rental_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_name: string | null;
  candidates: MatchCandidate[] | null;
  violation_id: string | null;
  affidavit_pdf_url: string | null;
}

export interface EzpassBatch {
  id: string;
  source_filename: string | null;
  file_url: string | null;
  status: string;
  total_count: number;
  matched_count: number;
  total_amount: number;
  created_at: string;
}

function genId(prefix: string) {
  return (
    prefix +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase() +
    Date.now().toString(36).slice(-3).toUpperCase()
  );
}

/** Process an uploaded EZPass statement: extract, auto-match, persist a batch. */
export const processEzpassDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        images: z.array(z.string().min(10)).min(1).max(30),
        filename: z.string().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ batchId: string; found: number }> => {
    const tolls = await extractTollsFromImages(data.images);
    if (tolls.length === 0) {
      throw new Error(
        "No toll violations could be read from this document. Try a clearer scan or a different page.",
      );
    }

    const batchId = genId("EZ");
    let fileUrl: string | null = null;
    try {
      const first = data.images[0];
      const m = /^data:([^;]+);base64,(.+)$/.exec(first);
      if (m) {
        const buffer = Buffer.from(m[2], "base64");
        const path = `ezpass/${batchId}.jpg`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("violation-photos")
          .upload(path, buffer, { contentType: m[1], upsert: true });
        if (!upErr) {
          const { data: signed } = await supabaseAdmin.storage
            .from("violation-photos")
            .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
          fileUrl = signed?.signedUrl ?? null;
        }
      }
    } catch (e) {
      console.error("[ezpass] file store failed:", e);
    }

    const matched = await Promise.all(tolls.map((t) => autoMatchToll(t)));

    let matchedCount = 0;
    let totalAmount = 0;
    const itemsToInsert = tolls.map((t, i) => {
      const mr = matched[i];
      if (mr.match_status === "matched") matchedCount++;
      totalAmount += Number(t.amount || 0);
      return {
        batch_id: batchId,
        violation_date: t.violation_date,
        violation_time: t.violation_time,
        plate: t.plate,
        location: t.location,
        amount: t.amount,
        match_status: mr.match_status,
        rental_id: mr.rental_id,
        driver_id: mr.driver_id,
        vehicle_id: mr.vehicle_id,
        driver_name: mr.driver_name,
        candidates: mr.candidates as unknown,
      };
    });

    const { error: bErr } = await supabaseAdmin.from("ezpass_batches").insert({
      id: batchId,
      source_filename: data.filename ?? null,
      file_url: fileUrl,
      status: "reviewing",
      total_count: tolls.length,
      matched_count: matchedCount,
      total_amount: Number(totalAmount.toFixed(2)),
      created_by: context.userId ?? null,
    } as never);
    if (bErr) throw new Error(bErr.message);

    const { error: iErr } = await supabaseAdmin
      .from("ezpass_batch_items")
      .insert(itemsToInsert as never);
    if (iErr) throw new Error(iErr.message);

    return { batchId, found: tolls.length };
  });

/** Fetch a batch and its items for the review screen. */
export const getEzpassBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ batchId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }): Promise<{ batch: EzpassBatch; items: EzpassBatchItem[] }> => {
    const { data: batch, error: bErr } = await supabaseAdmin
      .from("ezpass_batches")
      .select("*")
      .eq("id", data.batchId)
      .maybeSingle();
    if (bErr || !batch) throw new Error("Batch not found");
    const { data: items, error: iErr } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("*")
      .eq("batch_id", data.batchId)
      .order("violation_date", { ascending: true });
    if (iErr) throw new Error(iErr.message);
    return {
      batch: batch as EzpassBatch,
      items: (items ?? []) as EzpassBatchItem[],
    };
  });

/** List recent batches for the bulk-upload landing/history. */
export const listEzpassBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<EzpassBatch[]> => {
    const { data, error } = await supabaseAdmin
      .from("ezpass_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as EzpassBatch[];
  });

/** Search rentals by customer name or phone for manual matching. */
export const searchRentalsForMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ query: z.string().max(120) }).parse(input))
  .handler(async ({ data }) => {
    const q = data.query.trim();
    let driverIds: string[] = [];
    if (q) {
      const { data: drivers } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(25);
      driverIds = (drivers ?? []).map((d) => d.id);
      if (driverIds.length === 0) return [];
    }
    let query = supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, start_date, end_date")
      .order("start_date", { ascending: false })
      .limit(50);
    if (driverIds.length) query = query.in("driver_id", driverIds);
    const { data: rentals } = await query;
    const rows = rentals ?? [];
    const dIds = Array.from(new Set(rows.map((r) => r.driver_id).filter(Boolean))) as string[];
    const vIds = Array.from(new Set(rows.map((r) => r.vehicle_id).filter(Boolean))) as string[];
    const [{ data: ds }, { data: vs }] = await Promise.all([
      dIds.length
        ? supabaseAdmin.from("drivers").select("id, full_name, phone").in("id", dIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string; phone: string }[] }),
      vIds.length
        ? supabaseAdmin.from("vehicles").select("id, plate, make, model, year").in("id", vIds)
        : Promise.resolve({ data: [] as { id: string; plate: string; make: string; model: string; year: number }[] }),
    ]);
    const dMap = new Map((ds ?? []).map((d) => [d.id, d]));
    const vMap = new Map((vs ?? []).map((v) => [v.id, v]));
    return rows.map((r) => {
      const dr = r.driver_id ? dMap.get(r.driver_id) : undefined;
      const ve = r.vehicle_id ? vMap.get(r.vehicle_id) : undefined;
      return {
        rental_id: r.id,
        driver_id: r.driver_id ?? null,
        vehicle_id: r.vehicle_id ?? null,
        driver_name: dr?.full_name ?? null,
        phone: dr?.phone ?? null,
        vehicle_label: ve ? `${ve.year} ${ve.make} ${ve.model} (${ve.plate})` : null,
        start_date: r.start_date,
        end_date: r.end_date ?? null,
      };
    });
  });

/** Manually attach a rental to an unmatched item (or pick among candidates). */
export const manualMatchEzpassItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ itemId: z.string().uuid(), rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr || !rental) throw new Error("Rental not found");
    let driverName: string | null = null;
    if (rental.driver_id) {
      const { data: dr } = await supabaseAdmin
        .from("drivers")
        .select("full_name")
        .eq("id", rental.driver_id)
        .maybeSingle();
      driverName = dr?.full_name ?? null;
    }
    const { data: item } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("batch_id")
      .eq("id", data.itemId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("ezpass_batch_items")
      .update({
        match_status: "matched",
        rental_id: rental.id,
        driver_id: rental.driver_id ?? null,
        vehicle_id: rental.vehicle_id ?? null,
        driver_name: driverName,
        candidates: null,
      } as never)
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    if (item?.batch_id) await recomputeBatchCounts(item.batch_id);
    return { ok: true as const };
  });

async function recomputeBatchCounts(batchId: string) {
  const { data: items } = await supabaseAdmin
    .from("ezpass_batch_items")
    .select("match_status, amount")
    .eq("batch_id", batchId);
  const rows = items ?? [];
  const matched = rows.filter((r) => r.match_status === "matched").length;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  await supabaseAdmin
    .from("ezpass_batches")
    .update({
      matched_count: matched,
      total_count: rows.length,
      total_amount: Number(total.toFixed(2)),
    } as never)
    .eq("id", batchId);
}

/** Approve a fully-matched batch: create violation records + affidavit PDFs. */
export const approveEzpassBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ batchId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }): Promise<{ generated: number }> => {
    const { data: items, error: iErr } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("*")
      .eq("batch_id", data.batchId);
    if (iErr) throw new Error(iErr.message);
    const rows = (items ?? []) as EzpassBatchItem[];
    if (rows.length === 0) throw new Error("Batch has no items");
    const unmatched = rows.filter((r) => r.match_status !== "matched");
    if (unmatched.length > 0) {
      throw new Error(`Resolve all ${unmatched.length} unmatched violation(s) before approving.`);
    }

    let generated = 0;
    for (const item of rows) {
      if (item.violation_id && item.affidavit_pdf_url) {
        generated++;
        continue;
      }
      // Load rental/vehicle/driver context
      const [{ data: rental }, { data: driver }, { data: vehicle }] = await Promise.all([
        item.rental_id
          ? supabaseAdmin
              .from("rentals")
              .select("id, start_date, end_date, vehicle_id, driver_id")
              .eq("id", item.rental_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        item.driver_id
          ? supabaseAdmin
              .from("drivers")
              .select(
                "full_name, first_name, last_name, phone, email, license_number, dl_state, address, street_address, city, state, zip_code",
              )
              .eq("id", item.driver_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        item.vehicle_id
          ? supabaseAdmin
              .from("vehicles")
              .select("year, make, model, vin, plate")
              .eq("id", item.vehicle_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const violationId = item.violation_id || genId("VIO");
      // Create the violation record if it doesn't exist yet
      if (!item.violation_id) {
        await supabaseAdmin.from("violations").insert({
          id: violationId,
          rental_id: item.rental_id,
          vehicle_id: item.vehicle_id ?? "UNKNOWN",
          driver_id: item.driver_id,
          type: "toll",
          date_issued: item.violation_date,
          license_plate: item.plate,
          amount: item.amount,
          fee: 0,
          total_amount: item.amount,
          description: `EZPass toll — ${item.location ?? ""}`.trim(),
          notes: `Imported from EZPass batch ${data.batchId}`,
          status: "pending",
          created_by: context.userId ?? null,
        } as never);
      }

      // Generate affidavit PDF
      let affidavitUrl: string | null = item.affidavit_pdf_url;
      try {
        const pdf = await buildAffidavitPdf({
          violationId,
          violationDate: item.violation_date,
          violationTime: item.violation_time,
          location: item.location,
          amount: Number(item.amount || 0),
          plate: item.plate,
          vehicle: vehicle ?? null,
          driver: driver ?? null,
          rental: rental ?? null,
        });
        const path = `ezpass/${data.batchId}/affidavit-${violationId}.pdf`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("violation-photos")
          .upload(path, pdf, { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          const { data: signed } = await supabaseAdmin.storage
            .from("violation-photos")
            .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
          affidavitUrl = signed?.signedUrl ?? null;
        }
      } catch (e) {
        console.error("[ezpass] affidavit gen failed:", e);
      }

      await supabaseAdmin
        .from("ezpass_batch_items")
        .update({ violation_id: violationId, affidavit_pdf_url: affidavitUrl } as never)
        .eq("id", item.id);
      generated++;
    }

    await supabaseAdmin
      .from("ezpass_batches")
      .update({ status: "approved" } as never)
      .eq("id", data.batchId);

    return { generated };
  });

/** Download all affidavit PDFs for a batch as a ZIP. */
export const downloadAffidavitsZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ batchId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }): Promise<{ filename: string; base64: string }> => {
    const JSZip = (await import("jszip")).default;
    const { data: items } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("violation_id, affidavit_pdf_url, plate")
      .eq("batch_id", data.batchId);
    const rows = (items ?? []).filter((r) => r.affidavit_pdf_url);
    if (rows.length === 0) throw new Error("No affidavits generated yet");
    const zip = new JSZip();
    await Promise.all(
      rows.map(async (r) => {
        try {
          const res = await fetch(r.affidavit_pdf_url as string);
          if (!res.ok) return;
          const buf = new Uint8Array(await res.arrayBuffer());
          const plate = (r.plate || "NOPLATE").toString().replace(/[^a-z0-9]+/gi, "").toUpperCase();
          zip.file(`AFFIDAVIT_${r.violation_id}_${plate}.pdf`, buf);
        } catch {
          /* skip */
        }
      }),
    );
    const buf = await zip.generateAsync({ type: "uint8array" });
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return { filename: `EZPASS_AFFIDAVITS_${data.batchId}.zip`, base64: btoa(bin) };
  });
