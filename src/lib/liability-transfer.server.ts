import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface AuthorityAddress {
  id: string;
  key: string;
  name: string;
  address_lines: string | null;
  region: string | null;
  is_active: boolean;
}

export const OWNER = {
  legal: "Rentalprise LLC d/b/a Camauto Rentals",
  address: "416 Sicklerville Rd, Sicklerville NJ 08081",
  phone: "(866) 625-5550",
  email: "violations@camautorentals.com",
  signer: "Rentalprise LLC Admin",
};

function fmtMoney(n: number | null | undefined): string {
  return `$${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export interface ViolationCtx {
  v: Record<string, unknown>;
  vehicle: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
  rental: Record<string, unknown> | null;
  authority: AuthorityAddress | null;
  /** True when renter/rental data came from a migrated (legacy) reservation. */
  fromLegacy?: boolean;
}

export async function loadViolationCtx(violationId: string): Promise<ViolationCtx> {
  const { data: v, error } = await supabaseAdmin
    .from("violations")
    .select("*")
    .eq("id", violationId)
    .maybeSingle();
  if (error || !v) throw new Error("Violation not found");

  const [vehicleRes, driverRes, rentalRes] = await Promise.all([
    v.vehicle_id && v.vehicle_id !== "UNKNOWN"
      ? supabaseAdmin
          .from("vehicles")
          .select("id, plate, make, model, year, vin")
          .eq("id", v.vehicle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.driver_id
      ? supabaseAdmin
          .from("drivers")
          .select(
            "id, full_name, first_name, last_name, phone, email, license_number, dl_state, license_expiry, date_of_birth, address, street_address, city, state, zip_code",
          )
          .eq("id", v.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    v.rental_id
      ? supabaseAdmin
          .from("rentals")
          .select("id, start_date, end_date, agreement_pdf_url, license_image_url")
          .eq("id", v.rental_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const authKey = (v.authority_key as string | null) ?? "nj_ezpass";
  const { data: auth } = await supabaseAdmin
    .from("authority_addresses")
    .select("*")
    .eq("key", authKey)
    .maybeSingle();

  // Migrated reservation fallback: when the violation was matched to a legacy
  // reservation (no live driver/rental), pull renter + rental details from it
  // so the mail packet is populated instead of empty.
  let legacyDriver: Record<string, unknown> | null = null;
  let legacyRental: Record<string, unknown> | null = null;
  let legacyVehicle: Record<string, unknown> | null = null;
  let fromLegacy = false;
  const legacyId = v.legacy_rental_id as string | null;
  if (legacyId && !driverRes.data && !rentalRes.data) {
    const { data: lr } = await supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, renter_name, address, dl_number, plate, vehicle, year, color, start_datetime, end_datetime, agreement_pdf_url",
      )
      .eq("id", legacyId)
      .maybeSingle();
    if (lr) {
      fromLegacy = true;
      legacyDriver = {
        full_name: lr.renter_name ?? null,
        address: lr.address ?? null,
        license_number: lr.dl_number ?? null,
      };
      legacyRental = {
        id: lr.id,
        start_date: lr.start_datetime ?? null,
        end_date: lr.end_datetime ?? null,
        agreement_pdf_url: lr.agreement_pdf_url ?? null,
        license_image_url: null,
      };
      if (!vehicleRes.data) {
        legacyVehicle = {
          plate: lr.plate ?? null,
          make: lr.vehicle ?? null,
          model: null,
          year: lr.year ?? null,
          vin: null,
        };
      }
    }
  }

  return {
    v: v as Record<string, unknown>,
    vehicle: (vehicleRes.data as Record<string, unknown> | null) ?? legacyVehicle,
    driver: (driverRes.data as Record<string, unknown> | null) ?? legacyDriver,
    rental: (rentalRes.data as Record<string, unknown> | null) ?? legacyRental,
    authority: (auth as AuthorityAddress | null) ?? null,
    fromLegacy,
  };
}

export async function buildCoverLetterPdf(ctx: ViolationCtx): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 54;
  const right = pageW - 54;
  let y = 56;

  const { v, vehicle, driver, rental, authority } = ctx;

  const ensure = (space: number) => {
    if (y + space > pageH - 60) {
      doc.addPage();
      y = 56;
    }
  };
  const line = (text: string, opts?: { bold?: boolean; size?: number; gap?: number }) => {
    ensure(16);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(text, right - left);
    doc.text(wrapped, left, y);
    y += (opts?.gap ?? 14) * (Array.isArray(wrapped) ? wrapped.length : 1);
  };
  const blank = (h = 8) => {
    y += h;
  };

  // Letterhead
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 60);
  doc.text("CAMAUTO RENTALS", left, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`${OWNER.legal} · ${OWNER.address} · ${OWNER.phone}`, left, y);
  y += 22;

  const ref = (v.reference_number as string | null) || (v.id as string);
  line(`Date: ${fmtDate(new Date().toISOString())}`);
  line(`Reference #: ${v.id as string}`);
  blank();

  const authName = authority?.name ?? "Violation Processing Authority";
  const authLines = (authority?.address_lines ?? "").split("\n").filter(Boolean);
  line(`To: ${authName}`, { bold: true });
  for (const al of authLines) line(al);
  line(`Re: Liability Transfer for Vehicle ${(v.license_plate as string) ?? vehicle?.plate ?? "—"}`, {
    bold: true,
  });
  blank();

  line(
    `Pursuant to N.J.S.A. 39:4-138.1, Camauto Rentals (Rentalprise LLC, registered rental car company) hereby provides notice of operator identity and requests transfer of liability for the violation referenced below.`,
  );
  blank();

  line("VEHICLE INFORMATION:", { bold: true });
  line(
    `- Vehicle: ${[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "—"}`,
  );
  line(`- Plate: ${(v.license_plate as string) ?? vehicle?.plate ?? "—"}`);
  line(`- VIN: ${(vehicle?.vin as string) ?? "—"}`);
  line(`- Owner: ${OWNER.legal}`);
  line(`- Address: ${OWNER.address}`);
  line(`- Phone: ${OWNER.phone}`);
  blank();

  line("VIOLATION DETAILS:", { bold: true });
  line(`- Date: ${fmtDate(v.date_issued as string)}`);
  line(`- Time: ${(v.violation_time as string) ?? "—"}`);
  line(`- Location: ${(v.location as string) ?? (v.description as string) ?? "—"}`);
  line(`- Amount: ${fmtMoney(Number(v.total_amount ?? v.amount ?? 0))}`);
  line(`- Citation/Reference #: ${ref}`);
  blank();

  const addr =
    (driver?.address as string) ||
    [driver?.street_address, driver?.city, driver?.state, driver?.zip_code]
      .filter(Boolean)
      .join(", ");
  line("RENTER INFORMATION (at time of violation):", { bold: true });
  line(`- Full Name: ${(driver?.full_name as string) ?? "—"}`);
  line(`- Address: ${addr || "—"}`);
  line(`- Driver's License: ${(driver?.license_number as string) ?? "—"}`);
  line(`- License State: ${(driver?.dl_state as string) ?? "—"}`);
  line(`- License Expiration: ${fmtDate(driver?.license_expiry as string)}`);
  line(`- Phone: ${(driver?.phone as string) ?? "—"}`);
  line(`- Email: ${(driver?.email as string) ?? "—"}`);
  line(`- Date of Birth: ${fmtDate(driver?.date_of_birth as string)}`);
  line(`- Rental Agreement #: ${(rental?.id as string) ?? "—"}`);
  line(
    `- Rental Period: ${fmtDate(rental?.start_date as string)} to ${
      rental?.end_date ? fmtDate(rental?.end_date as string) : "ongoing"
    }`,
  );
  blank();

  line("ATTACHED DOCUMENTS:", { bold: true });
  line("- Copy of signed rental agreement");
  line("- Copy of renter's driver's license (front)");
  line("- Copy of original violation notice");
  blank();

  line(
    `Pursuant to N.J.S.A. 39:4-138.1 and applicable rental car liability transfer statutes, we hereby formally identify the above-named individual as the sole operator of the vehicle during the violation period. The renter executed a signed rental agreement accepting full responsibility for all tolls, fines, and violations incurred during the rental period.`,
  );
  blank();
  line(
    `We respectfully request that liability for this violation be transferred to the renter directly. We are not disputing the validity of the violation; we are merely providing required information for liability transfer per applicable law.`,
  );
  blank();
  line(
    `Please contact the renter directly using the information provided. Camauto Rentals has no further obligation regarding this matter pursuant to NJ rental car liability transfer statutes.`,
  );
  blank();
  line(
    `If you require additional documentation or have questions, please contact us at ${OWNER.email} or ${OWNER.phone}.`,
  );
  blank(16);
  line("Respectfully,");
  blank(20);
  line(OWNER.signer, { bold: true });
  line("Camauto Rentals");
  line(`Date: ${fmtDate(new Date().toISOString())}`);
  line(`Reference #: ${v.id as string}`);

  return new Uint8Array(doc.output("arraybuffer"));
}

/** Build + store the liability-transfer cover letter PDF and stamp the violation. */
export async function generateAndStoreLiabilityTransfer(
  violationId: string,
): Promise<{ pdfUrl: string | null }> {
  const ctx = await loadViolationCtx(violationId);
  const pdf = await buildCoverLetterPdf(ctx);
  const path = `liability-transfer/${violationId}/cover-letter.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("violation-photos")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(upErr.message);
  const { data: signed } = await supabaseAdmin.storage
    .from("violation-photos")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  const pdfUrl = signed?.signedUrl ?? null;
  await supabaseAdmin
    .from("violations")
    .update({
      liability_transfer_generated_at: new Date().toISOString(),
      liability_transfer_pdf_url: pdfUrl,
      authority_key: (ctx.v.authority_key as string | null) ?? "nj_ezpass",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", violationId);
  return { pdfUrl };
}
