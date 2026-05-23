import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { AgreementSettings } from "@/lib/agreementSettings";

/**
 * Server-rendered PDF version of the rental agreement.
 * Uses only built-in PDF fonts (Helvetica) so it works in the Cloudflare
 * Workers SSR runtime without fontkit filesystem access.
 */

export interface RentalAgreementPDFData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    billingCadence: string | null; // "daily" | "weekly" | "monthly"
    billingPeriod: string | null;
    rateAmount: number | null;
    rate: number | null;
    weeklyRate: number | null;
    depositPaid: number;
    signedBy: string | null;
    signedAt: string | null;
    clientSignedAt: string | null;
    agreementVersion: string | null;
  };
  driver: {
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    middleInitial: string | null;
    dateOfBirth: string | null;
    licenseNumber: string;
    licenseExpiry: string | null;
    dlState: string | null;
    phone: string;
    email: string;
    streetAddress: string | null;
    aptUnit: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    address: string | null;
    altContactName: string | null;
    altContactPhone: string | null;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    color: string | null;
    plate: string;
    vin: string;
    mileage: number;
    fuelLevelPickup: string | null;
    ezPassTag: string | null;
  };
  extensions: Array<{
    id: string;
    extendedAt: string;
    previousEndDate: string | null;
    newEndDate: string;
    periods: number;
    periodLabel: string;
    additionalAmount: number;
    signedBy: string | null;
  }>;
  settings: AgreementSettings;
  /** PNG bytes of the renter's signature, or null if not yet captured. */
  signaturePng: Buffer | null;
}

const COLOR_GREEN = "#2db84b";
const COLOR_BORDER = "#cccccc";
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#666666";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLOR_TEXT,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GREEN,
    paddingBottom: 8,
    marginBottom: 10,
  },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: COLOR_GREEN },
  companyMeta: { fontSize: 8, color: COLOR_MUTED, textAlign: "right", lineHeight: 1.35 },
  title: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  subtitle: {
    textAlign: "center",
    fontSize: 8,
    color: COLOR_MUTED,
    marginBottom: 10,
  },
  sectionBar: {
    backgroundColor: COLOR_GREEN,
    color: "#ffffff",
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 6,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 0 },
  cell: { padding: 3 },
  cellLabel: {
    fontSize: 7,
    color: COLOR_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  cellValue: {
    fontSize: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: "#444",
    paddingVertical: 2,
    minHeight: 14,
  },
  clauseTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 5,
    marginBottom: 2,
  },
  clauseBody: { fontSize: 8.5, lineHeight: 1.4, color: "#222" },
  sigRow: { flexDirection: "row", gap: 24, marginTop: 8 },
  sigCol: { flex: 1 },
  sigBox: {
    height: 50,
    borderBottomWidth: 1.5,
    borderBottomColor: "#000",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: 2,
  },
  sigImage: { maxHeight: 48, width: "auto" },
  sigLabel: {
    fontSize: 7,
    textTransform: "uppercase",
    color: COLOR_MUTED,
    letterSpacing: 0.4,
  },
  table: { marginTop: 4, borderWidth: 0.5, borderColor: COLOR_BORDER },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLOR_GREEN,
  },
  tableHeaderCell: {
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    padding: 4,
    flex: 1,
  },
  tableRow: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: COLOR_BORDER },
  tableCell: { padding: 4, fontSize: 8, flex: 1 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    textAlign: "center",
    fontSize: 7,
    color: COLOR_MUTED,
    borderTopWidth: 1,
    borderTopColor: COLOR_GREEN,
    paddingTop: 4,
  },
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // Accept "YYYY-MM-DD" or full ISO.
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function renderClauseText(body: string, s: AgreementSettings): string {
  return body
    .replaceAll("{{COMPANY}}", s.company.dba)
    .replaceAll("{{LEGAL_NAME}}", `${s.company.legalName} d/b/a ${s.company.dba}`)
    .replaceAll("{{GRACE_DAYS}}", s.fees.repossessionGraceDays)
    .replaceAll("{{EXCESS_MILEAGE}}", s.fees.excessMileageRate)
    .replaceAll("{{TOLL_ADMIN}}", s.fees.tollAdminFee)
    .replaceAll("{{FUEL_FEE}}", s.fees.fuelFeePerGallon)
    .replaceAll("{{CLEANING_FEE}}", s.fees.cleaningFeeRange);
}

function Field({ label, value, width }: { label: string; value: string | number | null | undefined; width: string }) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value == null || value === "" ? " " : String(value)}</Text>
    </View>
  );
}

function composedName(d: RentalAgreementPDFData["driver"]) {
  const parts = [d.firstName, d.middleInitial, d.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : d.fullName;
}

function composedAddress(d: RentalAgreementPDFData["driver"]) {
  if (d.streetAddress || d.city || d.state || d.zipCode) {
    const line1 = [d.streetAddress, d.aptUnit ? `Apt ${d.aptUnit}` : null].filter(Boolean).join(" ");
    const line2 = [d.city, [d.state, d.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [line1, line2].filter(Boolean).join(", ");
  }
  return d.address ?? "";
}

export function RentalAgreementPDF({ rental, driver, vehicle, extensions, settings, signaturePng }: RentalAgreementPDFData) {
  const periodLabel =
    rental.billingCadence === "daily" || rental.billingPeriod === "daily"
      ? "day"
      : rental.billingCadence === "weekly" || rental.billingPeriod === "weekly"
        ? "week"
        : "period";
  const rate = Number(rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0);
  const currentEnd = extensions.length
    ? extensions[extensions.length - 1].newEndDate
    : rental.endDate;
  const fullName = composedName(driver);
  const fullAddress = composedAddress(driver);
  const dlStateExp = [driver.dlState, driver.licenseExpiry ? fmtDate(driver.licenseExpiry) : ""]
    .filter(Boolean)
    .join(" / ");

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{settings.company.dba}</Text>
            <Text style={{ fontSize: 8, color: COLOR_MUTED, marginTop: 2 }}>{settings.company.legalName}</Text>
          </View>
          <View>
            <Text style={styles.companyMeta}>{settings.company.address}</Text>
            <Text style={styles.companyMeta}>Phone: {settings.company.phone}</Text>
            <Text style={styles.companyMeta}>{settings.company.website}</Text>
          </View>
        </View>

        <Text style={styles.title}>Vehicle Rental Agreement</Text>
        <Text style={styles.subtitle}>
          Please read this agreement carefully before signing. All terms are binding upon execution.
        </Text>

        {/* RENTER */}
        <Text style={styles.sectionBar}>Renter Information</Text>
        <View style={styles.grid}>
          <Field label="Full Legal Name" value={fullName} width="50%" />
          <Field label="Date of Birth" value={driver.dateOfBirth ? fmtDate(driver.dateOfBirth) : ""} width="50%" />
          <Field label="Driver License #" value={driver.licenseNumber} width="50%" />
          <Field label="DL State / Expiration" value={dlStateExp} width="50%" />
          <Field label="Phone" value={driver.phone} width="50%" />
          <Field label="Email" value={driver.email} width="50%" />
          <Field label="Address" value={fullAddress} width="100%" />
          {(driver.altContactName || driver.altContactPhone) ? (
            <>
              <Field label="Alt Contact Name" value={driver.altContactName ?? ""} width="50%" />
              <Field label="Alt Contact Phone" value={driver.altContactPhone ?? ""} width="50%" />
            </>
          ) : null}
        </View>

        {/* VEHICLE */}
        <Text style={styles.sectionBar}>Vehicle Information</Text>
        <View style={styles.grid}>
          <Field label="Year" value={vehicle.year} width="16.66%" />
          <Field label="Make" value={vehicle.make} width="16.66%" />
          <Field label="Model" value={vehicle.model} width="16.66%" />
          <Field label="Color" value={vehicle.color ?? ""} width="16.66%" />
          <Field label="License Plate" value={vehicle.plate} width="16.66%" />
          <Field label="VIN" value={vehicle.vin} width="16.66%" />
          <Field label="Mileage Out" value={Number(vehicle.mileage ?? 0).toLocaleString()} width="25%" />
          <Field label="Fuel Level Out" value={vehicle.fuelLevelPickup ?? ""} width="25%" />
          <Field label="EZ-Pass Tag #" value={vehicle.ezPassTag ?? ""} width="25%" />
          <Field label="Pickup Date" value={fmtDate(rental.startDate)} width="25%" />
        </View>

        {/* TERMS */}
        <Text style={styles.sectionBar}>Rental Terms</Text>
        <View style={styles.grid}>
          <Field label={`Rate ($/${periodLabel})`} value={fmtMoney(rate)} width="25%" />
          <Field label="Daily Late Fee" value={settings.fees.dailyLateFee} width="25%" />
          <Field label="Rental Start" value={fmtDate(rental.startDate)} width="25%" />
          <Field label="Mileage Cap/Wk" value={settings.fees.mileageCapPerWeek} width="25%" />
          <Field label="Security Deposit" value={fmtMoney(Number(rental.depositPaid ?? 0))} width="33%" />
          <Field label="Payment Method" value="" width="33%" />
          <Field label="Current End Date" value={currentEnd ? fmtDate(currentEnd) : "Open-ended"} width="34%" />
        </View>

        {/* EXTENSIONS */}
        {extensions.length > 0 ? (
          <>
            <Text style={styles.sectionBar}>Extensions &amp; Amendments</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderCell}>Extended On</Text>
                <Text style={styles.tableHeaderCell}>Previous End</Text>
                <Text style={styles.tableHeaderCell}>New End</Text>
                <Text style={styles.tableHeaderCell}>Periods</Text>
                <Text style={styles.tableHeaderCell}>Additional</Text>
                <Text style={styles.tableHeaderCell}>Signed By</Text>
              </View>
              {extensions.map((e) => (
                <View key={e.id} style={styles.tableRow}>
                  <Text style={styles.tableCell}>{fmtDate(e.extendedAt.slice(0, 10))}</Text>
                  <Text style={styles.tableCell}>{e.previousEndDate ? fmtDate(e.previousEndDate) : "—"}</Text>
                  <Text style={styles.tableCell}>{fmtDate(e.newEndDate)}</Text>
                  <Text style={styles.tableCell}>{e.periods} {e.periodLabel}{e.periods === 1 ? "" : "s"}</Text>
                  <Text style={styles.tableCell}>{fmtMoney(e.additionalAmount)}</Text>
                  <Text style={styles.tableCell}>{e.signedBy ?? "—"}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* TERMS & CONDITIONS */}
        <Text style={styles.sectionBar}>Terms &amp; Conditions</Text>
        <View>
          {settings.clauses.map((c, i) => (
            <View key={i} wrap={false}>
              <Text style={styles.clauseTitle}>{i + 1}. {c.title}</Text>
              <Text style={styles.clauseBody}>{renderClauseText(c.body, settings)}</Text>
            </View>
          ))}
        </View>

        {/* VIOLATIONS & INCIDENTALS */}
        <Text style={styles.sectionBar}>Violations &amp; Incidentals</Text>
        <Text style={{ fontSize: 8.5, lineHeight: 1.4, marginBottom: 4 }}>
          Your card on file will be charged for any of the following:
        </Text>
        <View style={{ marginLeft: 12, marginBottom: 6 }}>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Parking tickets or traffic violations: actual fine amount</Text>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Late return fees: {settings.fees.dailyLateFee} per day</Text>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Damage to vehicle: repair cost</Text>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Cleaning fees: {settings.fees.cleaningFeeRange} if excessively soiled</Text>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Mileage overage: {settings.fees.excessMileageRate} per mile (if applicable)</Text>
          <Text style={{ fontSize: 8.5, lineHeight: 1.5 }}>• Other violations or damages: actual cost</Text>
        </View>
        <Text style={{ fontSize: 8.5, lineHeight: 1.4, marginBottom: 6 }}>
          You authorize {settings.company.dba} to charge your card without further notice for any of these charges.
        </Text>

        {/* SIGNATURES */}
        <Text style={styles.sectionBar}>Signatures</Text>
        <Text style={{ fontSize: 8.5, marginBottom: 6 }}>
          By signing below, Renter acknowledges having read, understood, and agreed to all terms of this Vehicle Rental Agreement.
        </Text>
        <View style={styles.sigRow}>
          <View style={styles.sigCol}>
            <View style={styles.sigBox}>
              {signaturePng ? <Image src={signaturePng} style={styles.sigImage} /> : null}
            </View>
            <Text style={styles.sigLabel}>Renter Signature</Text>
            <View style={{ marginTop: 6 }}>
              <Text style={styles.cellLabel}>Print Name</Text>
              <Text style={styles.cellValue}>{rental.signedBy ?? fullName}</Text>
            </View>
            <View style={{ marginTop: 4 }}>
              <Text style={styles.cellLabel}>Date</Text>
              <Text style={styles.cellValue}>{rental.signedAt ? fmtDate(rental.signedAt.slice(0, 10)) : (rental.clientSignedAt ? fmtDate(rental.clientSignedAt.slice(0, 10)) : "")}</Text>
            </View>
          </View>
          <View style={styles.sigCol}>
            <View style={styles.sigBox} />
            <Text style={styles.sigLabel}>{settings.company.dba} Representative</Text>
            <View style={{ marginTop: 6 }}>
              <Text style={styles.cellLabel}>Print Name</Text>
              <Text style={styles.cellValue}> </Text>
            </View>
            <View style={{ marginTop: 4 }}>
              <Text style={styles.cellLabel}>Date</Text>
              <Text style={styles.cellValue}> </Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {settings.company.legalName} d/b/a {settings.company.dba}  |  {settings.company.address}  |  {settings.company.phone}  |  {settings.company.website}
          {rental.agreementVersion ? `   |   Agreement version: ${rental.agreementVersion}` : ""}
        </Text>
      </Page>
    </Document>
  );
}