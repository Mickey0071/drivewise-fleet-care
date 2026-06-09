import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

export const EXPORTABLE = [
  "drivers",
  "rentals",
  "vehicles",
  "violations",
  "maintenance",
  "payments",
] as const;

export type ExportTable = (typeof EXPORTABLE)[number];

const DATE_COLUMN: Record<ExportTable, string> = {
  drivers: "date_added",
  rentals: "start_date",
  vehicles: "created_at",
  violations: "date_issued",
  maintenance: "date_completed",
  payments: "created_at",
};

export interface ExportResult {
  headers: string[];
  rows: (string | number | null)[][];
  count: number;
}

/** Export an entire table as rows, optionally filtered by a date range. */
export const exportTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        table: z.enum(EXPORTABLE),
        from: z.string().trim().max(40).optional().nullable(),
        to: z.string().trim().max(40).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ExportResult> => {
    let q = supabaseAdmin.from(data.table).select("*");
    const col = DATE_COLUMN[data.table];
    if (data.from) q = q.gte(col, data.from);
    if (data.to) q = q.lte(col, data.to);
    const { data: rows, error } = await q.limit(50000);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Record<string, unknown>[];
    const headers = list.length ? Object.keys(list[0]) : [];
    const out = list.map((r) =>
      headers.map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return null;
        if (typeof v === "object") return JSON.stringify(v);
        return v as string | number;
      }),
    );
    return { headers, rows: out, count: out.length };
  });

export interface ImportLogRow {
  id: string;
  source: string;
  file_name: string | null;
  rows_total: number;
  drivers_created: number;
  drivers_matched: number;
  rentals_created: number;
  rentals_skipped: number;
  error_count: number;
  unmatched_plates: string[] | null;
  errors: string[] | null;
  status: string;
  created_at: string;
}

/** List recent import history entries. */
export const listImportLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ImportLogRow[]> => {
    const { data, error } = await supabaseAdmin
      .from("import_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as ImportLogRow[];
  });