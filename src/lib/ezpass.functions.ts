import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
  extractTollsFromImages,
  autoMatchToll,
  normalizePlate,
  type MatchCandidate,
} from "@/lib/ezpass.server";
import type { ExtractedToll } from "@/lib/ezpass.server";
import { generateAndStoreLiabilityTransfer } from "@/lib/liability-transfer.server";
import { extractRefAndAuthorityFromUrl, detectAuthorityFromLocation } from "@/lib/ezpass.server";

const VALID_AUTHORITY_KEYS = new Set([
  "nj_ezpass",
  "ny_ezpass",
  "nj_turnpike",
  "pa_turnpike",
  "ppa",
  "philadelphia_parking",
  "nj_mvc",
  "drpa",
  "sjta",
]);

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
  reference_number: string | null;
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
        reference_number: t.reference_number ?? null,
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

/** Create a batch from manually-typed violation rows, then auto-match. */
export const createManualEzpassBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rows: z
          .array(
            z.object({
              violation_date: z.string().max(20).nullable().optional(),
              violation_time: z.string().max(20).nullable().optional(),
              plate: z.string().max(20).nullable().optional(),
              location: z.string().max(200).nullable().optional(),
              amount: z.number().min(0).max(100000),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ batchId: string; found: number }> => {
    const normDate = (v: string | null | undefined): string | null => {
      const s = (v || "").trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(s);
      if (m) {
        let [, mo, d, y] = m;
        if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
        return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      return null;
    };

    const tolls: ExtractedToll[] = data.rows.map((r) => ({
      violation_date: normDate(r.violation_date),
      violation_time: r.violation_time?.trim() || null,
      plate: r.plate?.trim().toUpperCase() || null,
      location: r.location?.trim() || null,
      amount: Number(r.amount || 0),
      reference_number: null,
    }));

    const batchId = genId("EZ");
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
      source_filename: "Manual entry",
      file_url: null,
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

/** Save the EZPass reference / violation number on a single batch item. Called
 *  from the bulk-review UI when OCR missed the number and the admin types it
 *  in from the physical notice. Approve is blocked until every item has one. */
export const setEzpassBatchItemRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        itemId: z.string().uuid(),
        referenceNumber: z.string().trim().min(1).max(64),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const cleaned = data.referenceNumber
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 40);
    if (!cleaned) throw new Error("Enter the EZPass reference / violation number");
    const { error } = await supabaseAdmin
      .from("ezpass_batch_items")
      .update({ reference_number: cleaned } as never)
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true as const, referenceNumber: cleaned };
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

/**
 * Approve a batch: permanently save EVERY violation (matched or not), set its
 * workflow stage, re-run the plate matcher on commit to catch backfilled plates,
 * and auto-generate liability-transfer letters for matched ones.
 */
export const approveEzpassBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        batchId: z.string().min(1).max(64),
        mode: z.enum(["all", "matched"]).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ generated: number; matched: number; unmatched: number; total: number; skippedNoRef: number }> => {
      const mode = data.mode ?? "all";
      const { data: items, error: iErr } = await supabaseAdmin
        .from("ezpass_batch_items")
        .select("*")
        .eq("batch_id", data.batchId);
      if (iErr) throw new Error(iErr.message);
      const rows = (items ?? []) as EzpassBatchItem[];
      if (rows.length === 0) throw new Error("Batch has no items");

      // The original uploaded EZPass document (first page) is stored on the
      // batch — attach it to every violation as the "original notice".
      const { data: batch } = await supabaseAdmin
        .from("ezpass_batches")
        .select("file_url")
        .eq("id", data.batchId)
        .maybeSingle();
      const originalDocUrl = (batch as { file_url: string | null } | null)?.file_url ?? null;

      let generated = 0;
      let matched = 0;
      let unmatched = 0;
      let skippedUnmatched = 0;
      let skippedNoRef = 0;

      for (const item of rows) {
        // Hard block: never persist a violation without its EZPass reference #.
        // Admin must type it from the physical notice on the review screen.
        if (!item.violation_id && !(item.reference_number && item.reference_number.trim())) {
          skippedNoRef++;
          continue;
        }
        // Re-run the matcher on commit for anything not already firmly matched
        // (picks up plates backfilled after the batch was first created).
        let rentalId = item.rental_id;
        let driverId = item.driver_id;
        let vehicleId = item.vehicle_id;
        let driverName = item.driver_name;
        let matchStatus = item.match_status;

        if (item.match_status !== "matched") {
          const mr = await autoMatchToll({
            violation_date: item.violation_date,
            violation_time: item.violation_time,
            plate: item.plate,
            location: item.location,
            amount: Number(item.amount || 0),
            reference_number: item.reference_number ?? null,
          });
          if (mr.match_status === "matched") {
            rentalId = mr.rental_id;
            driverId = mr.driver_id;
            vehicleId = mr.vehicle_id;
            driverName = mr.driver_name;
            matchStatus = "matched";
            await supabaseAdmin
              .from("ezpass_batch_items")
              .update({
                match_status: "matched",
                rental_id: rentalId,
                driver_id: driverId,
                vehicle_id: vehicleId,
                driver_name: driverName,
                candidates: null,
              } as never)
              .eq("id", item.id);
          }
        }

        const isMatched = matchStatus === "matched" && !!rentalId;
        if (isMatched) {
          matched++;
        } else {
          unmatched++;
          // "Approve Matched" only persists matched violations; unmatched
          // rows are left in the batch to resolve later.
          if (mode === "matched") {
            skippedUnmatched++;
            continue;
          }
        }

        const violationId = item.violation_id || genId("VIO");
        // Duplicate detection: same plate + same date + same amount means this
        // toll already exists as a violation. Instead of creating a duplicate,
        // update the existing record with the freshly-extracted EZPass ref #.
        let existingDupId: string | null = null;
        if (!item.violation_id && item.plate && item.violation_date) {
          const { data: dups } = await supabaseAdmin
            .from("violations")
            .select("id, reference_number")
            .eq("license_plate", item.plate)
            .eq("date_issued", item.violation_date)
            .eq("amount", item.amount)
            .limit(1);
          if (dups && dups.length > 0) existingDupId = (dups[0] as { id: string }).id;
        }

        if (existingDupId) {
          // Update the existing violation rather than creating a duplicate.
          const dupPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (item.reference_number) dupPatch.reference_number = item.reference_number;
          await supabaseAdmin
            .from("violations")
            .update(dupPatch as never)
            .eq("id", existingDupId);
          await supabaseAdmin
            .from("ezpass_batch_items")
            .update({ violation_id: existingDupId } as never)
            .eq("id", item.id);
          continue;
        }

        // Permanently save the violation record if it doesn't exist yet.
        if (!item.violation_id) {
          await supabaseAdmin.from("violations").insert({
            id: violationId,
            rental_id: rentalId,
            vehicle_id: vehicleId ?? "UNKNOWN",
            driver_id: driverId,
            type: "toll",
            date_issued: item.violation_date,
            license_plate: item.plate,
            amount: item.amount,
            fee: 0,
            total_amount: item.amount,
            description: `EZPass toll — ${item.location ?? ""}`.trim(),
            location: item.location,
            violation_time: item.violation_time,
            notes: `Imported from EZPass batch ${data.batchId}`,
            status: "pending",
            // EZPass ref # is auto-extracted from the scan when present; admin
            // can still enter/correct it manually on the violation card.
            reference_number: item.reference_number ?? null,
            // Auto-populate authority from toll location + plate state so the
            // dispute packet mailing address & statute are always ready.
            authority_key: detectAuthorityFromLocation(item.location, item.plate),
            workflow_stage: isMatched ? "matched" : "uploaded",
            is_orphan: false,
            photo_url: originalDocUrl,
            created_by: context.userId ?? null,
          } as never);
        } else {
          // Keep workflow stage in sync if it became matched on re-run.
          await supabaseAdmin
            .from("violations")
            .update({
              rental_id: rentalId,
              vehicle_id: vehicleId ?? "UNKNOWN",
              driver_id: driverId,
              workflow_stage: isMatched ? "matched" : "uploaded",
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", violationId);
        }

        // Only matched violations can get a pre-filled liability-transfer letter.
        let transferUrl: string | null = item.affidavit_pdf_url;
        if (isMatched) {
          try {
            const res = await generateAndStoreLiabilityTransfer(violationId);
            transferUrl = res.pdfUrl;
            generated++;
          } catch (e) {
            console.error("[ezpass] liability transfer gen failed:", e);
          }
        }

        await supabaseAdmin
          .from("ezpass_batch_items")
          .update({ violation_id: violationId, affidavit_pdf_url: transferUrl } as never)
          .eq("id", item.id);
      }

      // Only flip the batch to "approved" (locks editing, shows the ZIP
      // download) once everything has been persisted. In "matched" mode with
      // unmatched rows still pending, keep the batch open for further matching.
      const fullyResolved = mode === "all" || skippedUnmatched === 0;
      if (fullyResolved && skippedNoRef === 0) {
        await supabaseAdmin
          .from("ezpass_batches")
          .update({ status: "approved", matched_count: matched } as never)
          .eq("id", data.batchId);
      } else {
        await supabaseAdmin
          .from("ezpass_batches")
          .update({ matched_count: matched } as never)
          .eq("id", data.batchId);
      }

      return { generated, matched, unmatched, total: rows.length, skippedNoRef };
    },
  );

/** Download all liability-transfer letters for a batch as a ZIP. */
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
    if (rows.length === 0) throw new Error("No liability-transfer letters generated yet");
    const zip = new JSZip();
    await Promise.all(
      rows.map(async (r) => {
        try {
          const res = await fetch(r.affidavit_pdf_url as string);
          if (!res.ok) return;
          const buf = new Uint8Array(await res.arrayBuffer());
          const plate = (r.plate || "NOPLATE").toString().replace(/[^a-z0-9]+/gi, "").toUpperCase();
          zip.file(`LIABILITY_TRANSFER_${r.violation_id}_${plate}.pdf`, buf);
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
    return { filename: `EZPASS_LIABILITY_TRANSFERS_${data.batchId}.zip`, base64: btoa(bin) };
  });

export interface EzpassDebugRow {
  itemId: string;
  rawPlate: string | null;
  normPlate: string;
  rawDate: string | null;
  parsedDate: string | null;
  liveByPlate: number;
  liveByPlateAndDate: number;
  legacyByPlate: number;
  legacyByPlateAndDate: number;
}

/**
 * Read-only matcher diagnostics for a batch. Admin-only. Re-runs the same
 * read queries autoMatchToll uses, but only to COUNT candidates — both with
 * and without the date-window filter. Does NOT change any matching logic.
 */
export const debugEzpassMatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ batchId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }): Promise<EzpassDebugRow[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: items } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("id, plate, violation_date")
      .eq("batch_id", data.batchId)
      .order("violation_date", { ascending: true });

    const out: EzpassDebugRow[] = [];
    for (const it of items ?? []) {
      const rawPlate = (it.plate as string | null) ?? null;
      const np = normalizePlate(rawPlate);
      const date = (it.violation_date as string | null) ?? null;

      let liveByPlate = 0;
      let liveByPlateAndDate = 0;
      let legacyByPlate = 0;
      let legacyByPlateAndDate = 0;

      if (rawPlate) {
        // LIVE: vehicles whose normalized plate matches -> rentals on them
        const { data: vehicles } = await supabaseAdmin.from("vehicles").select("id, plate");
        const vehicleIds = (vehicles ?? [])
          .filter((v) => np && normalizePlate(v.plate) === np)
          .map((v) => v.id);
        if (vehicleIds.length > 0) {
          const { data: rentals } = await supabaseAdmin
            .from("rentals")
            .select("id, start_date, end_date")
            .in("vehicle_id", vehicleIds)
            .limit(200);
          const rows = rentals ?? [];
          liveByPlate = rows.length;
          if (date) {
            liveByPlateAndDate = rows.filter(
              (r) =>
                (!r.start_date || r.start_date <= date) &&
                (!r.end_date || r.end_date >= date),
            ).length;
          }
        }

        // LEGACY: legacy_rentals matched by normalized plate on both sides
        const { data: legacy } = await supabaseAdmin
          .from("legacy_rentals")
          .select("id, plate, start_datetime, end_datetime")
          .limit(5000);
        const lrows = (legacy ?? []).filter((lr) => np && normalizePlate(lr.plate) === np);
        legacyByPlate = lrows.length;
        if (date) {
          legacyByPlateAndDate = lrows.filter((lr) => {
            const start = lr.start_datetime ? lr.start_datetime.slice(0, 10) : null;
            const end = lr.end_datetime ? lr.end_datetime.slice(0, 10) : null;
            if (start && start > date) return false;
            if (end && end < date) return false;
            return true;
          }).length;
        }
      }

      out.push({
        itemId: it.id as string,
        rawPlate,
        normPlate: np,
        rawDate: date,
        parsedDate: date,
        liveByPlate,
        liveByPlateAndDate,
        legacyByPlate,
        legacyByPlateAndDate,
      });
    }
    return out;
  });

/**
 * Quick-return the signed rental agreement URL for a rental. Used by the
 * Manual Match dialog so an admin can preview / download the agreement before
 * committing a match. Only returns rows that already have a stored PDF; the
 * dialog decides whether to offer retro-signing instead.
 */
export const getRentalAgreementUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ url: string | null; filename: string }> => {
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, agreement_pdf_url, driver_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    const url = (rental as { agreement_pdf_url: string | null } | null)?.agreement_pdf_url ?? null;
    let name = "renter";
    if (rental?.driver_id) {
      const { data: dr } = await supabaseAdmin
        .from("drivers")
        .select("full_name, last_name")
        .eq("id", rental.driver_id)
        .maybeSingle();
      name = (dr?.full_name || dr?.last_name || "renter")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "renter";
    }
    return { url, filename: `${data.rentalId}_${name}_AGREEMENT.pdf` };
  });

/**
 * Manually match an EZPass batch item to a rental AND immediately commit it
 * as a real `violations` row (workflow_stage=matched). Returns the new
 * violation id so the caller can download an evidence packet with the
 * agreement in hand. `approveEzpassBatch` later skips items that already
 * have a `violation_id`, so this does not double-create.
 */
export const matchAndCommitEzpassItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ itemId: z.string().uuid(), rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ violationId: string }> => {
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

    const { data: item, error: iErr } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("*")
      .eq("id", data.itemId)
      .maybeSingle();
    if (iErr || !item) throw new Error("Batch item not found");

    // Persist the match on the batch item.
    await supabaseAdmin
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

    // Fetch the batch's original document (used as the violation photo).
    const { data: batch } = await supabaseAdmin
      .from("ezpass_batches")
      .select("file_url")
      .eq("id", (item as { batch_id: string }).batch_id)
      .maybeSingle();
    const originalDocUrl = (batch as { file_url: string | null } | null)?.file_url ?? null;

    // Duplicate detection — same plate + date + amount already exists.
    let violationId = (item as { violation_id: string | null }).violation_id ?? null;
    if (!violationId && item.plate && item.violation_date) {
      const { data: dups } = await supabaseAdmin
        .from("violations")
        .select("id")
        .eq("license_plate", item.plate)
        .eq("date_issued", item.violation_date)
        .eq("amount", item.amount)
        .limit(1);
      if (dups && dups.length > 0) {
        violationId = (dups[0] as { id: string }).id;
        await supabaseAdmin
          .from("violations")
          .update({
            rental_id: rental.id,
            vehicle_id: rental.vehicle_id ?? "UNKNOWN",
            driver_id: rental.driver_id,
            workflow_stage: "matched",
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", violationId);
      }
    }

    if (!violationId) {
      violationId = genId("VIO");
      await supabaseAdmin.from("violations").insert({
        id: violationId,
        rental_id: rental.id,
        vehicle_id: rental.vehicle_id ?? "UNKNOWN",
        driver_id: rental.driver_id,
        type: "toll",
        date_issued: item.violation_date,
        license_plate: item.plate,
        amount: item.amount,
        fee: 0,
        total_amount: item.amount,
        description: `EZPass toll — ${item.location ?? ""}`.trim(),
        location: item.location,
        violation_time: item.violation_time,
        notes: `Imported from EZPass batch ${(item as { batch_id: string }).batch_id} (manual match)`,
        status: "pending",
        reference_number: (item as { reference_number: string | null }).reference_number ?? null,
        authority_key: detectAuthorityFromLocation(item.location, item.plate),
        workflow_stage: "matched",
        is_orphan: false,
        photo_url: originalDocUrl,
        created_by: context.userId ?? null,
      } as never);
    }

    await supabaseAdmin
      .from("ezpass_batch_items")
      .update({ violation_id: violationId } as never)
      .eq("id", data.itemId);

    await recomputeBatchCounts((item as { batch_id: string }).batch_id);

    return { violationId: violationId! };
  });

/**
 * Dismiss a batch item as "not our plate" — takes it out of the active
 * matching queue without deleting it (so audit / undo is possible).
 * Persists match_status='dismissed' on the batch item; the review table
 * filters those rows out.
 */
export const dismissEzpassItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ itemId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { data: item } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("batch_id")
      .eq("id", data.itemId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("ezpass_batch_items")
      .update({
        match_status: "dismissed",
        rental_id: null,
        driver_id: null,
        vehicle_id: null,
        driver_name: null,
        candidates: null,
      } as never)
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    if (item?.batch_id) await recomputeBatchCounts((item as { batch_id: string }).batch_id);
    return { ok: true as const };
  });

/**
 * Create an internal "on-file" rental (minimal driver + rental row) so a
 * scanned toll that has no live reservation can still be attributed to a
 * renter and pushed through matchAndCommitEzpassItem. The rental is flagged
 * `reservation_status='internal'` and its notes reference the batch item
 * that triggered it. Returns the new rental id for the caller to feed into
 * the existing matchCommit path.
 */
export const createInternalRentalForItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        itemId: z.string().uuid(),
        renterName: z.string().min(1).max(200),
        phone: z.string().max(40).optional().nullable(),
        email: z.string().max(200).optional().nullable(),
        plate: z.string().max(20).optional().nullable(),
        startDate: z.string().min(10).max(10),
        endDate: z.string().min(10).max(10).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ rentalId: string; vehicleId: string }> => {
    const { data: item } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("id, plate, violation_date")
      .eq("id", data.itemId)
      .maybeSingle();
    if (!item) throw new Error("Batch item not found");

    const rawPlate = (data.plate || (item as { plate: string | null }).plate || "").trim();
    const plateNorm = normalizePlate(rawPlate);
    let vehicleId = "UNKNOWN";
    if (plateNorm) {
      const { data: vs } = await supabaseAdmin
        .from("vehicles")
        .select("id, plate")
        .limit(1000);
      const hit = (vs ?? []).find(
        (v) => normalizePlate((v as { plate: string | null }).plate ?? "") === plateNorm,
      );
      if (hit) vehicleId = (hit as { id: string }).id;
    }

    // Minimal driver shell — real license info can be filled in later.
    const driverId = genId("D");
    const { error: dErr } = await supabaseAdmin.from("drivers").insert({
      id: driverId,
      full_name: data.renterName.trim(),
      phone: (data.phone || "").trim(),
      email: (data.email || "").trim(),
      license_number: "",
      license_expiry: new Date().toISOString().slice(0, 10),
      status: "active",
    } as never);
    if (dErr) throw new Error("Driver create failed: " + dErr.message);

    const rentalId = genId("R");
    const { error: rErr } = await supabaseAdmin.from("rentals").insert({
      id: rentalId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      start_date: data.startDate,
      end_date: data.endDate || null,
      billing_period: "weekly",
      weekly_rate: 0,
      rate: 0,
      deposit_paid: 0,
      reservation_status: "internal",
      payment_status: "current",
      notes: `Internal / on-file rental created from EZPass batch item ${data.itemId} to cover a ticket that had no live reservation.`,
    } as never);
    if (rErr) throw new Error("Rental create failed: " + rErr.message);

    return { rentalId, vehicleId };
  });

/* --------------------------------------------------------------------------
 * MISSING REF/AUTHORITY BACKFILL
 * -------------------------------------------------------------------------- */

/** List every violation missing a reference_number OR authority_key so admins
 *  can review + backfill them from one screen. Returns the document URL plus
 *  the parent batch's file_url as a fallback. */
export const listViolationsNeedingRef = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<Array<{
    id: string;
    license_plate: string | null;
    date_issued: string | null;
    amount: number | null;
    reference_number: string | null;
    authority_key: string | null;
    photo_url: string | null;
    batch_id: string | null;
    batch_file_url: string | null;
    ocr_candidates: Array<{ label: string; number: string }> | null;
    ocr_secondary_ref: string | null;
    notes: string | null;
  }>> => {
    const { data: vs, error } = await supabaseAdmin
      .from("violations")
      .select(
        "id, license_plate, date_issued, amount, reference_number, authority_key, photo_url, ocr_candidates, ocr_secondary_ref, notes",
      )
      .or("reference_number.is.null,reference_number.eq.,authority_key.is.null,authority_key.eq.")
      .order("date_issued", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (vs ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    const { data: items } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("violation_id, batch_id")
      .in("violation_id", ids);
    const byViolation = new Map<string, string>();
    for (const it of (items ?? []) as Array<{ violation_id: string; batch_id: string }>) {
      if (!byViolation.has(it.violation_id)) byViolation.set(it.violation_id, it.batch_id);
    }
    const batchIds = Array.from(new Set([...byViolation.values()]));
    const { data: batches } = batchIds.length
      ? await supabaseAdmin
          .from("ezpass_batches")
          .select("id, file_url")
          .in("id", batchIds)
      : { data: [] as Array<{ id: string; file_url: string | null }> };
    const batchUrl = new Map(
      (batches ?? []).map((b) => [
        (b as { id: string }).id,
        (b as { file_url: string | null }).file_url,
      ]),
    );
    return rows.map((r) => {
      const bid = byViolation.get(r.id as string) ?? null;
      return {
        id: r.id as string,
        license_plate: (r.license_plate as string | null) ?? null,
        date_issued: (r.date_issued as string | null) ?? null,
        amount: (r.amount as number | null) ?? null,
        reference_number: (r.reference_number as string | null) ?? null,
        authority_key: (r.authority_key as string | null) ?? null,
        photo_url: (r.photo_url as string | null) ?? null,
        batch_id: bid,
        batch_file_url: bid ? batchUrl.get(bid) ?? null : null,
        ocr_candidates:
          (r.ocr_candidates as Array<{ label: string; number: string }> | null) ?? null,
        ocr_secondary_ref: (r.ocr_secondary_ref as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      };
    });
  });

/** Bulk re-OCR every violation missing a reference_number. Also detects the
 *  issuing authority and writes it when confidently identified. Never
 *  overwrites an already-populated value. */
export const reExtractMissingViolationRefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{
    examined: number;
    updated_ref: number;
    updated_authority: number;
    still_blank_ref: number;
    still_blank_authority: number;
    preserved_existing: number;
    no_document: number;
  }> => {
    const { data: vs, error } = await supabaseAdmin
      .from("violations")
      .select("id, reference_number, authority_key, photo_url, notes")
      .or("reference_number.is.null,reference_number.eq.,authority_key.is.null,authority_key.eq.")
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (vs ?? []) as Array<{
      id: string;
      reference_number: string | null;
      authority_key: string | null;
      photo_url: string | null;
      notes: string | null;
    }>;

    // Prefetch batch file_url fallbacks in one query.
    const ids = rows.map((r) => r.id);
    const { data: items } = ids.length
      ? await supabaseAdmin
          .from("ezpass_batch_items")
          .select("violation_id, batch_id")
          .in("violation_id", ids)
      : { data: [] as Array<{ violation_id: string; batch_id: string }> };
    const batchOf = new Map<string, string>();
    for (const it of (items ?? []) as Array<{ violation_id: string | null; batch_id: string | null }>) {
      if (!it.violation_id || !it.batch_id) continue;
      if (!batchOf.has(it.violation_id)) batchOf.set(it.violation_id, it.batch_id);
    }
    const batchIds = Array.from(new Set([...batchOf.values()]));
    const { data: batches } = batchIds.length
      ? await supabaseAdmin.from("ezpass_batches").select("id, file_url").in("id", batchIds)
      : { data: [] as Array<{ id: string; file_url: string | null }> };
    const batchUrl = new Map(
      (batches ?? []).map((b) => [
        (b as { id: string }).id,
        (b as { file_url: string | null }).file_url,
      ]),
    );

    let updated_ref = 0;
    let updated_authority = 0;
    let preserved_existing = 0;
    let no_document = 0;
    let still_blank_ref = 0;
    let still_blank_authority = 0;

    for (const v of rows) {
      const needsRef = !v.reference_number;
      const needsAuth = !v.authority_key;
      const bid = batchOf.get(v.id) ?? null;
      const url = v.photo_url || (bid ? batchUrl.get(bid) ?? null : null);
      if (!url) {
        no_document++;
        if (needsRef) still_blank_ref++;
        if (needsAuth) still_blank_authority++;
        continue;
      }

      const r = await extractRefAndAuthorityFromUrl(url);
      const patch: Record<string, unknown> = {};
      if (needsRef && r.reference_number) {
        patch.reference_number = r.reference_number;
      } else if (!needsRef) {
        preserved_existing++;
      }
      if (needsAuth && r.authority_key && VALID_AUTHORITY_KEYS.has(r.authority_key)) {
        patch.authority_key = r.authority_key;
      }
      // Always persist the OCR candidates + secondary # so the admin UI can show them
      // (especially useful when we still couldn't pick a confident reference_number).
      if (r.candidates.length > 0) {
        patch.ocr_candidates = r.candidates;
      }
      if (r.secondary_number) {
        patch.ocr_secondary_ref = r.secondary_number;
        // Also append a human-readable note so it surfaces in existing notes UIs.
        const marker = `[OCR] Secondary ref (from ${r.notice_type ?? "notice"}): ${r.secondary_number}`;
        const existing = v.notes ?? "";
        if (!existing.includes(r.secondary_number)) {
          patch.notes = existing ? `${existing}\n${marker}` : marker;
        }
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        const { error: uerr } = await supabaseAdmin
          .from("violations")
          .update(patch as never)
          .eq("id", v.id);
        if (!uerr) {
          if (patch.reference_number) updated_ref++;
          if (patch.authority_key) updated_authority++;
        }
        // Mirror the reference_number onto the source batch item(s), never
        // overwriting a value that's already there.
        if (patch.reference_number && bid) {
          await supabaseAdmin
            .from("ezpass_batch_items")
            .update({ reference_number: patch.reference_number } as never)
            .eq("violation_id", v.id)
            .or("reference_number.is.null,reference_number.eq.");
        }
      }
      if (needsRef && !patch.reference_number) still_blank_ref++;
      if (needsAuth && !patch.authority_key) still_blank_authority++;
    }

    return {
      examined: rows.length,
      updated_ref,
      updated_authority,
      still_blank_ref,
      still_blank_authority,
      preserved_existing,
      no_document,
    };
  });

/** Set / clear the authority_key on a violation from the manual review UI. */
export const setViolationAuthority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().min(1),
        authorityKey: z.string().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const key = data.authorityKey;
    if (key !== null && !VALID_AUTHORITY_KEYS.has(key)) {
      throw new Error(`Unknown authority "${key}"`);
    }
    const { error } = await supabaseAdmin
      .from("violations")
      .update({ authority_key: key, updated_at: new Date().toISOString() } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Report violations that are pointed at by more than one ezpass_batch_items
 *  row (duplicate ingest). Never deletes — admin confirms. */
export const findDuplicateEzpassLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<Array<{ violation_id: string; item_ids: string[]; batch_ids: string[] }>> => {
    const { data, error } = await supabaseAdmin
      .from("ezpass_batch_items")
      .select("id, batch_id, violation_id")
      .not("violation_id", "is", null)
      .limit(5000);
    if (error) throw new Error(error.message);
    const by = new Map<string, { item_ids: string[]; batch_ids: string[] }>();
    for (const it of (data ?? []) as Array<{ id: string; batch_id: string; violation_id: string }>) {
      const g = by.get(it.violation_id) ?? { item_ids: [], batch_ids: [] };
      g.item_ids.push(it.id);
      if (!g.batch_ids.includes(it.batch_id)) g.batch_ids.push(it.batch_id);
      by.set(it.violation_id, g);
    }
    return Array.from(by.entries())
      .filter(([, g]) => g.item_ids.length > 1)
      .map(([violation_id, g]) => ({ violation_id, ...g }));
  });
