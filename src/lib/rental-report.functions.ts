import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderRentalReportPdf, type RentalReportData } from "@/components/pdf/RentalReportPDF";
import JSZip from "jszip";
import { z } from "zod";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) {
    throw new Error("Admin access required");
  }
}

async function fetchImage(
  url: string | null | undefined,
): Promise<{ mime: string; bytes: Uint8Array; ext: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = mime.includes("png")
      ? "png"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("pdf")
          ? "pdf"
          : "jpg";
    return { mime, bytes, ext };
  } catch {
    return null;
  }
}

async function gatherReport(rentalId: string) {
  const { data: rental, error } = await supabaseAdmin
    .from("rentals")
    .select("*")
    .eq("id", rentalId)
    .maybeSingle();
  if (error || !rental) throw new Error("Rental not found");

  const [
    { data: vehicle },
    { data: driver },
    { data: payments },
    { data: violations },
    { data: inspections },
    { data: extensions },
    { data: charges },
  ] = await Promise.all([
    supabaseAdmin
      .from("vehicles")
      .select("id, year, make, model, plate, vin, color")
      .eq("id", rental.vehicle_id)
      .maybeSingle(),
    supabaseAdmin
      .from("drivers")
      .select(
        "id, full_name, email, phone, license_number, dl_state, street_address, city, state, zip_code",
      )
      .eq("id", rental.driver_id)
      .maybeSingle(),
    supabaseAdmin
      .from("payments")
      .select("id, amount, due_date, paid_date, method, status")
      .eq("rental_id", rental.id)
      .order("due_date", { ascending: true }),
    supabaseAdmin
      .from("violations")
      .select("id, type, amount, date_issued, status, notes")
      .eq("vehicle_id", rental.vehicle_id)
      .eq("driver_id", rental.driver_id)
      .gte("date_issued", rental.start_date)
      .lte(
        "date_issued",
        rental.end_date ?? new Date().toISOString().slice(0, 10),
      ),
    supabaseAdmin
      .from("inspections")
      .select(
        "id, date, type, mileage, fuel_level, damage_noted, ready_to_rent, notes, inspector_name, is_return_inspection",
      )
      .eq("rental_id", rental.id)
      .order("date", { ascending: true }),
    supabaseAdmin
      .from("rental_extensions")
      .select(
        "id, periods, period_label, additional_amount, previous_end_date, new_end_date, extended_at",
      )
      .eq("rental_id", rental.id)
      .order("extended_at", { ascending: true }),
    supabaseAdmin
      .from("rental_charges")
      .select("amount, charge_date, status, period_label")
      .eq("rental_id", rental.id)
      .order("charge_date", { ascending: true }),
  ]);

  // Try to pull last4 from any stripe payment intent (best-effort, optional)
  let cardLast4: string | null = null;
  // We do not query stripe live here; leave null unless someone persists it.

  const address = [
    driver?.street_address,
    driver?.city,
    driver?.state,
    driver?.zip_code,
  ]
    .filter(Boolean)
    .join(", ");

  const [license, selfie, signature, agreementPdf] = await Promise.all([
    fetchImage(rental.license_image_url),
    fetchImage(rental.selfie_image_url),
    fetchImage(rental.client_signature_url),
    fetchImage(rental.agreement_pdf_url),
  ]);

  const reportData: RentalReportData = {
    rental: {
      id: rental.id,
      startDate: rental.start_date,
      endDate: rental.end_date ?? null,
      returnedAt: rental.returned_at ?? null,
      reservationStatus: rental.reservation_status ?? null,
      paymentStatus: rental.payment_status ?? null,
      billingCadence: rental.billing_cadence ?? null,
      rate: rental.rate != null ? Number(rental.rate) : null,
      weeklyRate: rental.weekly_rate != null ? Number(rental.weekly_rate) : null,
      rateAmount: rental.rate_amount != null ? Number(rental.rate_amount) : null,
      depositPaid: rental.deposit_paid != null ? Number(rental.deposit_paid) : null,
      finalChargeAmount:
        rental.final_charge_amount != null ? Number(rental.final_charge_amount) : null,
      mileageOut: rental.mileage_out ?? null,
      mileageIn: rental.mileage_in ?? null,
      cardholderName: rental.cardholder_name ?? null,
    },
    driver: {
      fullName: driver?.full_name ?? "",
      phone: driver?.phone ?? "",
      email: driver?.email ?? "",
      licenseNumber: driver?.license_number ?? "",
      dlState: driver?.dl_state ?? "",
      address,
    },
    vehicle: {
      year: vehicle?.year ?? "",
      make: vehicle?.make ?? "",
      model: vehicle?.model ?? "",
      plate: vehicle?.plate ?? "",
      vin: vehicle?.vin ?? "",
      color: vehicle?.color ?? "",
    },
    payments: (payments ?? []).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      dueDate: p.due_date,
      paidDate: p.paid_date,
      method: p.method,
      status: p.status,
    })),
    charges: (charges ?? []).map((c: any) => ({
      amount: Number(c.amount),
      chargeDate: c.charge_date,
      status: c.status,
      periodLabel: c.period_label,
    })),
    violations: (violations ?? []).map((v: any) => ({
      id: v.id,
      type: v.type,
      amount: Number(v.amount),
      dateIssued: v.date_issued,
      status: v.status,
      notes: v.notes,
    })),
    extensions: (extensions ?? []).map((e: any) => ({
      id: e.id,
      periods: e.periods,
      periodLabel: e.period_label,
      additionalAmount: Number(e.additional_amount),
      previousEndDate: e.previous_end_date,
      newEndDate: e.new_end_date,
      extendedAt: e.extended_at,
    })),
    inspections: (inspections ?? []).map((i: any) => ({
      id: i.id,
      date: i.date,
      type: i.type,
      mileage: i.mileage,
      fuelLevel: i.fuel_level,
      damageNoted: !!i.damage_noted,
      readyToRent: i.ready_to_rent,
      isReturn: !!i.is_return_inspection,
      notes: i.notes,
      inspector: i.inspector_name,
    })),
    cardLast4,
    images: {
      license: license ? { mime: license.mime, bytes: license.bytes } : null,
      selfie: selfie ? { mime: selfie.mime, bytes: selfie.bytes } : null,
      signature: signature ? { mime: signature.mime, bytes: signature.bytes } : null,
    },
  };

  const safeName = (driver?.full_name || rental.driver_id || "renter")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "renter";

  return {
    rental,
    driver,
    vehicle,
    reportData,
    safeName,
    files: { license, selfie, signature, agreementPdf },
    raw: { payments: payments ?? [], violations: violations ?? [], inspections: inspections ?? [], extensions: extensions ?? [], charges: charges ?? [] },
  };
}

function toBase64(buf: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export const exportRentalReportPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const gathered = await gatherReport(data.rentalId);
    const pdf = await renderRentalReportPdf(gathered.reportData);
    return {
      filename: `${gathered.rental.id}_${gathered.safeName}_report.pdf`,
      mime: "application/pdf",
      base64: toBase64(pdf),
    };
  });

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\n");
}

export const exportRentalReportZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rentalId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const gathered = await gatherReport(data.rentalId);
    const pdf = await renderRentalReportPdf(gathered.reportData);

    const zip = new JSZip();
    zip.file(`${gathered.rental.id}_report.pdf`, pdf);
    if (gathered.files.agreementPdf) {
      zip.file(`rental-agreement.${gathered.files.agreementPdf.ext}`, gathered.files.agreementPdf.bytes);
    }
    if (gathered.files.license) {
      zip.file(`drivers-license.${gathered.files.license.ext}`, gathered.files.license.bytes);
    }
    if (gathered.files.selfie) {
      zip.file(`selfie.${gathered.files.selfie.ext}`, gathered.files.selfie.bytes);
    }
    if (gathered.files.signature) {
      zip.file(`signature.${gathered.files.signature.ext}`, gathered.files.signature.bytes);
    }

    // CSV exports
    const summary = [{
      rental_id: gathered.rental.id,
      renter: gathered.driver?.full_name ?? "",
      phone: gathered.driver?.phone ?? "",
      email: gathered.driver?.email ?? "",
      license: gathered.driver?.license_number ?? "",
      vehicle: `${gathered.vehicle?.year ?? ""} ${gathered.vehicle?.make ?? ""} ${gathered.vehicle?.model ?? ""}`.trim(),
      plate: gathered.vehicle?.plate ?? "",
      vin: gathered.vehicle?.vin ?? "",
      start_date: gathered.rental.start_date,
      end_date: gathered.rental.end_date,
      returned_at: gathered.rental.returned_at,
      status: gathered.rental.reservation_status,
      rate: gathered.rental.rate_amount ?? gathered.rental.rate ?? gathered.rental.weekly_rate,
      billing_cadence: gathered.rental.billing_cadence,
    }];
    zip.file("summary.csv", buildCsv(summary));
    if (gathered.raw.payments.length) zip.file("payments.csv", buildCsv(gathered.raw.payments));
    if (gathered.raw.violations.length) zip.file("violations.csv", buildCsv(gathered.raw.violations));
    if (gathered.raw.inspections.length) zip.file("inspections.csv", buildCsv(gathered.raw.inspections));
    if (gathered.raw.extensions.length) zip.file("extensions.csv", buildCsv(gathered.raw.extensions));
    if (gathered.raw.charges.length) zip.file("stripe-charges.csv", buildCsv(gathered.raw.charges));

    const buf = await zip.generateAsync({ type: "uint8array" });
    return {
      filename: `${gathered.rental.id}_${gathered.safeName}_report.zip`,
      mime: "application/zip",
      base64: toBase64(buf),
    };
  });