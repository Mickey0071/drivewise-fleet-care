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
import { extractRefAndAuthorityFromUrl } from "@/lib/ezpass.server";

const VALID_AUTHORITY_KEYS = new Set([
  "nj_ezpass",
  "ny_ezpass",
  "nj_turnpike",
  "pa_turnpike",
  "ppa",
  "philadelphia_parking",
  "nj_mvc",
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
    }): Promise<{ generated: number; matched: number; unmatched: number; total: number }> => {
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

      for (const item of rows) {
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
      if (fullyResolved) {
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

      return { generated, matched, unmatched, total: rows.length };
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
