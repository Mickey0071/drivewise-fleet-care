import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface MigratedReservation {
  id: string;
  source: string | null;
  order_number: string | null;
  vehicle: string | null;
  year: string | null;
  color: string | null;
  plate: string | null;
  renter_name: string | null;
  pickup_location: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  status: string | null;
  notes: string | null;
  address: string | null;
  dl_number: string | null;
  created_at: string;
}

export const listMigratedReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MigratedReservation[]> => {
    const { data, error } = await supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, source, order_number, vehicle, year, color, plate, renter_name, pickup_location, start_datetime, end_datetime, status, notes, address, dl_number, created_at",
      )
      .order("start_datetime", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as MigratedReservation[];
  });

type CreateInput = {
  renter_name: string;
  plate?: string | null;
  vehicle?: string | null;
  year?: string | null;
  color?: string | null;
  order_number?: string | null;
  pickup_location?: string | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
  status?: string | null;
  notes?: string | null;
  address?: string | null;
  dl_number?: string | null;
};

export const createMigratedReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateInput) => {
    const renter = (input.renter_name || "").trim();
    if (!renter) throw new Error("Renter name is required");
    const clean = (v?: string | null) => {
      const s = (v ?? "").toString().trim();
      return s === "" ? null : s;
    };
    return {
      source: "migrated",
      renter_name: renter,
      plate: clean(input.plate),
      vehicle: clean(input.vehicle),
      year: clean(input.year),
      color: clean(input.color),
      order_number: clean(input.order_number),
      pickup_location: clean(input.pickup_location),
      start_datetime: clean(input.start_datetime),
      end_datetime: clean(input.end_datetime),
      status: clean(input.status) ?? "migrated",
      notes: clean(input.notes),
      address: clean(input.address),
      dl_number: clean(input.dl_number),
    };
  })
  .handler(async ({ data }): Promise<MigratedReservation> => {
    const { data: row, error } = await supabaseAdmin
      .from("legacy_rentals")
      .insert(data as never)
      .select(
        "id, source, order_number, vehicle, year, color, plate, renter_name, pickup_location, start_datetime, end_datetime, status, notes, address, dl_number, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return row as MigratedReservation;
  });

export const deleteMigratedReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = (input.id || "").trim();
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("legacy_rentals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface ParsedReservation {
  renter_name: string;
  plate: string;
  vehicle: string;
  year: string;
  color: string;
  order_number: string;
  pickup_location: string;
  start_datetime: string;
  end_datetime: string;
  address: string;
  dl_number: string;
  notes: string;
}

// Parse a pasted Fleet Finesse (or any) reservation block into structured
// fields using Lovable AI. Lookup-only data — never linked to live reports.
export const parseReservationText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    const text = (input.text || "").trim();
    if (!text) throw new Error("Paste the reservation text first");
    if (text.length > 8000) throw new Error("Text too long");
    return { text };
  })
  .handler(async ({ data }): Promise<ParsedReservation> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const toLocalDt = (s: string) => {
      // Convert "05/24/2026 9:00 AM" -> "2026-05-24T09:00" for datetime-local
      const t = (s || "").trim();
      if (!t) return "";
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return "";
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              'You extract rental reservation data from pasted text (e.g. Fleet Finesse). Return ONLY a compact JSON object in this exact shape: {"renter_name":string,"plate":string,"vehicle":string,"year":string,"color":string,"order_number":string,"pickup_location":string,"start_datetime":string,"end_datetime":string,"address":string,"dl_number":string,"notes":string}. "vehicle" is make+model (e.g. "Hyundai Elantra"). "plate" is the license plate/tag. Keep start_datetime/end_datetime in their original human format (e.g. "05/24/2026 9:00 AM"). If a field is not present, use an empty string. Do not invent a plate if none is given. No prose, no code fences.',
          },
          { role: "user", content: data.text },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit hit — try again in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted");
      console.error(`[parse-reservation] gateway ${res.status}: ${t.slice(0, 200)}`);
      throw new Error("Could not parse the reservation");
    }
    const json = (await res.json().catch(() => null)) as any;
    let raw = json?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("Could not parse the reservation");
    raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    let p: any = null;
    try { p = JSON.parse(raw); } catch { throw new Error("Could not parse the reservation"); }
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      renter_name: s(p.renter_name),
      plate: s(p.plate).toUpperCase(),
      vehicle: s(p.vehicle),
      year: s(p.year),
      color: s(p.color),
      order_number: s(p.order_number),
      pickup_location: s(p.pickup_location),
      start_datetime: toLocalDt(s(p.start_datetime)),
      end_datetime: toLocalDt(s(p.end_datetime)),
      address: s(p.address),
      dl_number: s(p.dl_number),
      notes: s(p.notes),
    };
  });

export interface BulkImportResult {
  saved: number;
  skipped: number;
  withoutPlate: number;
  names: string[];
}

// Parse a paste that may contain MANY reservations at once and save them all.
// Lookup-only data — never linked to any live report. Matching for violations
// is done by plate + date, so reservations without a plate are still saved but
// flagged (they won't match a toll/ticket until the plate is filled in).
export const bulkImportReservations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    const text = (input.text || "").trim();
    if (!text) throw new Error("Paste your reservations first");
    if (text.length > 60000) throw new Error("Too much text — paste in smaller batches");
    return { text };
  })
  .handler(async ({ data }): Promise<BulkImportResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const toIso = (s: string) => {
      const t = (s || "").trim();
      if (!t) return null;
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return null;
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              'You extract one OR MORE rental reservations from pasted text (e.g. Fleet Finesse). The paste may contain many reservations. Return ONLY a JSON array, each item in this exact shape: {"renter_name":string,"plate":string,"vehicle":string,"year":string,"color":string,"order_number":string,"pickup_location":string,"start_datetime":string,"end_datetime":string,"address":string,"dl_number":string,"notes":string}. "vehicle" is make+model (e.g. "Hyundai Elantra"). "plate" is the license plate/tag. Keep start_datetime/end_datetime in their original human format (e.g. "05/24/2026 9:00 AM"). If a field is not present, use an empty string. Do not invent a plate if none is given. Return one array item per distinct reservation. No prose, no code fences.',
          },
          { role: "user", content: data.text },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit hit — try again in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted");
      console.error(`[bulk-import] gateway ${res.status}: ${t.slice(0, 200)}`);
      throw new Error("Could not parse the reservations");
    }
    const json = (await res.json().catch(() => null)) as any;
    let raw = json?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("Could not parse the reservations");
    raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    let arr: any = null;
    try { arr = JSON.parse(raw); } catch { throw new Error("Could not parse the reservations"); }
    if (!Array.isArray(arr)) arr = [arr];

    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const rows = (arr as any[])
      .map((p) => ({
        source: "migrated",
        renter_name: s(p.renter_name),
        plate: s(p.plate).toUpperCase() || null,
        vehicle: s(p.vehicle) || null,
        year: s(p.year) || null,
        color: s(p.color) || null,
        order_number: s(p.order_number) || null,
        pickup_location: s(p.pickup_location) || null,
        start_datetime: toIso(s(p.start_datetime)),
        end_datetime: toIso(s(p.end_datetime)),
        status: "migrated",
        address: s(p.address) || null,
        dl_number: s(p.dl_number) || null,
        notes: s(p.notes) || null,
      }))
      .filter((r) => r.renter_name);

    const skipped = (Array.isArray(arr) ? arr.length : 0) - rows.length;
    if (rows.length === 0) {
      return { saved: 0, skipped, withoutPlate: 0, names: [] };
    }

    const { error } = await supabaseAdmin.from("legacy_rentals").insert(rows as never);
    if (error) throw new Error(error.message);

    return {
      saved: rows.length,
      skipped: Math.max(0, skipped),
      withoutPlate: rows.filter((r) => !r.plate).length,
      names: rows.map((r) => r.renter_name),
    };
  });