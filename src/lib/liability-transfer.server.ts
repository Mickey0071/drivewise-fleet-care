import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface AuthorityAddress {
  id: string;
  key: string;
  name: string;
  address_lines: string | null;
  region: string | null;
  is_active: boolean;
}

/**
 * Map an authority key to the statute we cite on outgoing dispute paperwork.
 * Unknown / missing keys are rejected so we never mail a packet with a wrong
 * legal reference. Add new authorities here as they come online.
 */
export function statuteFor(authorityKey: string | null | undefined): string {
  const key = (authorityKey ?? "").trim().toLowerCase();
  switch (key) {
    case "ppa":
    case "philadelphia_parking":
      return "Philadelphia Code §12-2804(8)";
    default:
      // Default (and NJ E-ZPass / NJ MVC / NJ Turnpike / general fallback):
      // NJ rental-vehicle operator-identification statute. Never throw — a
      // missing statute must not block the admin from printing & mailing.
      return "N.J.S.A. 39:4-138.1";
  }
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
  const left = 54;
  const right = pageW - 54;
  let y = 64;

  const { v, vehicle, driver, rental, authority } = ctx;

  // ── Simplified single-page NOTICE OF LIABILITY TRANSFER ────────────────
  // Never throws for missing data; unknown fields print as "[SEE ATTACHED
  // NOTICE]" or a blank underline so the admin can hand-fill and mail.
  const ref = (v.reference_number as string | null)?.trim() || "";
  const plate =
    String((v.license_plate as string | null) ?? vehicle?.plate ?? "").toUpperCase() || "—";
  const amountLabel = fmtMoney(Number(v.total_amount ?? v.amount ?? 0));
  const addr =
    (driver?.address as string) ||
    [driver?.street_address, driver?.city, driver?.state, driver?.zip_code]
      .filter(Boolean)
      .join(", ") ||
    "________________________________________";

  const write = (
    text: string,
    opts?: { bold?: boolean; size?: number; color?: [number, number, number]; gap?: number },
  ) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10.5);
    const c = opts?.color ?? [20, 20, 20];
    doc.setTextColor(c[0], c[1], c[2]);
    const wrapped = doc.splitTextToSize(text, right - left);
    doc.text(wrapped, left, y);
    y += (opts?.gap ?? 14) * (Array.isArray(wrapped) ? wrapped.length : 1);
  };
  const blank = (h = 8) => {
    y += h;
  };

  // Letterhead
  write("CAMAUTO RENTALS", { bold: true, size: 16, color: [16, 122, 60], gap: 18 });
  write(OWNER.legal, { size: 9, color: [90, 90, 90], gap: 11 });
  write(OWNER.address, { size: 9, color: [90, 90, 90], gap: 11 });
  write(`${OWNER.phone} | ${OWNER.email}`, { size: 9, color: [90, 90, 90], gap: 11 });
  blank(10);

  write(`Date: ${fmtDate(new Date().toISOString())}`);
  blank(10);

  // Recipient
  const authName = authority?.name ?? "NJ E-ZPass Violation Processing Center";
  const authLines = (authority?.address_lines ?? "P.O. Box 4971\nTrenton, NJ 08650")
    .split("\n")
    .filter(Boolean);
  write(`To: ${authName}`, { bold: true });
  for (const al of authLines) write(al);
  blank(8);

  // Re: block
  write("Re: NOTICE OF LIABILITY TRANSFER", { bold: true });
  write(`EZPass Violation #: ${ref ? ref.toUpperCase() : "[SEE ATTACHED NOTICE]"}`);
  write(`Vehicle Plate: ${plate}`);
  write(`Violation Date: ${fmtDate(v.date_issued as string)}`);
  write(`Amount: ${amountLabel}`);
  blank(10);

  const statute = statuteFor((v.authority_key as string | null) ?? null);
  write(
    `Pursuant to ${statute}, ${OWNER.legal} hereby identifies the operator of the above vehicle at the time of this violation and requests transfer of liability.`,
  );
  blank(10);

  // Vehicle
  write("VEHICLE:", { bold: true });
  const vehLine = [
    [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "—",
    `Plate: ${plate}`,
    `VIN: ${(vehicle?.vin as string) || "—"}`,
  ].join(" · ");
  write(vehLine);
  blank(10);

  // Renter
  write("RENTER (operator at time of violation):", { bold: true });
  write(`Name: ${(driver?.full_name as string) || "________________________________________"}`);
  write(`Address: ${addr}`);
  write(`Phone: ${(driver?.phone as string) || "____________________"}`);
  write(`License #: ${(driver?.license_number as string) || "____________________"}`);
  write(
    `Rental Period: ${
      rental?.start_date ? fmtDate(rental?.start_date as string) : "____________"
    } to ${rental?.end_date ? fmtDate(rental?.end_date as string) : "ongoing"}`,
  );
  write(`Rental Agreement #: ${(rental?.id as string) || "____________"}`);
  blank(12);

  write(
    "The renter executed a signed rental agreement accepting full responsibility for all tolls, fines, and violations incurred during the rental period.",
  );
  blank(10);

  write("Attached: Signed rental agreement", { bold: true });
  blank(24);

  write("Respectfully,");
  blank(28);
  write(OWNER.signer, { bold: true });
  write("Camauto Rentals");

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
