import type { AccidentReport } from "@/lib/mock/data";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const reportSchema = z.object({
  occurredAt: z.string().min(1, "Date and time of accident is required"),
  location: z.string().max(500).optional().default(""),
  description: z.string().max(4000).optional().default(""),
  fault: z.string().max(2000).optional().default(""),
  otherPartyName: z.string().max(200).optional().default(""),
  otherPartyPhone: z.string().max(60).optional().default(""),
  otherPartyInsurance: z.string().max(300).optional().default(""),
  otherPartyPlate: z.string().max(40).optional().default(""),
  injuries: z.string().max(2000).optional().default(""),
  policeReport: z.string().max(300).optional().default(""),
});

/** Public: load basic rental info + any existing accident report by share token. */
export const getAccidentIntake = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => z.object({ token: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any).rpc("get_accident_intake_public", { _token: data.token });
    if (error) throw new Error("Unable to load accident form");
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };
    return {
      found: true as const,
      rentalId: row.rental_id as string,
      vehicle: (row.vehicle as string) ?? "",
      plate: (row.plate as string) ?? "",
      driverName: (row.driver_full_name as string) ?? "",
      startDate: (row.start_date as string) ?? null,
      endDate: (row.end_date as string) ?? null,
      report: (row.accident_report as AccidentReport | null) ?? null,
    };
  });

/** Public: renter submits the accident report via their share token. */
export const submitAccidentReport = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; report: unknown }) =>
    z.object({ token: z.string().min(1), report: reportSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const report = { ...data.report, reportedBy: "renter", updatedAt: new Date().toISOString() };
    const { data: updated, error } = await (supabaseAdmin as any)
      .from("rentals")
      .update({ accident_report: report })
      .eq("accident_token", data.token)
      .select("id");
    if (error) throw new Error("Could not save report");
    if (!updated || updated.length === 0) throw new Error("Invalid or expired link");
    return { ok: true as const };
  });