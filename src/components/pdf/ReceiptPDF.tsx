import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AgreementSettings } from "@/lib/agreementSettings";

/**
 * Server-rendered Payment Receipt PDF.
 * Uses Helvetica (built-in PDF font) so it works in the Cloudflare Workers
 * SSR runtime without fontkit/filesystem access.
 */

export interface ReceiptPDFData {
  rental: {
    id: string;
    startDate: string;
    endDate: string | null;
    billingCadence: string | null;
    rate: number | null;
    weeklyRate: number | null;
    rateAmount: number | null;
  };
  driver: {
    fullName: string;
    phone: string;
    email: string;
  };
  vehicle: {
    year: number | string;
    make: string;
    model: string;
    plate: string;
    vin: string;
  };
  payment: {
    amount: number;
    method: string;
    paidAt: string;
    reference: string | null;
    totalCost: number;
    balanceDue: number;
  };
  settings: AgreementSettings;
}

const COLOR_GREEN = "#2db84b";
const COLOR_BORDER = "#cccccc";
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#666666";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLOR_TEXT,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GREEN,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: COLOR_GREEN },
  companyMeta: { fontSize: 8, color: COLOR_MUTED, textAlign: "right", lineHeight: 1.4 },
  title: {
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
    marginBottom: 2,
  },
  subtitle: { textAlign: "center", fontSize: 9, color: COLOR_MUTED, marginBottom: 14 },
  sectionBar: {
    backgroundColor: COLOR_GREEN,
    color: "#ffffff",
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 8,
  },
  row: { flexDirection: "row", marginBottom: 4 },
  labelCell: { width: 130, color: COLOR_MUTED, fontFamily: "Helvetica-Bold", fontSize: 9 },
  valueCell: { flex: 1, fontSize: 10 },
  totalsBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 10,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsLabel: { fontSize: 10, color: COLOR_TEXT },
  totalsValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLOR_GREEN },
  paidStamp: {
    marginTop: 18,
    alignSelf: "center",
    borderWidth: 2,
    borderColor: COLOR_GREEN,
    color: COLOR_GREEN,
    paddingVertical: 6,
    paddingHorizontal: 18,
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    letterSpacing: 2,
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 40,
    right: 40,
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
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtMoney(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.labelCell}>{label}</Text>
      <Text style={styles.valueCell}>{value || "—"}</Text>
    </View>
  );
}

export function ReceiptPDF(data: ReceiptPDFData) {
  const { rental, driver, vehicle, payment, settings } = data;
  const c = settings.company;
  const rateLabel = (() => {
    const cadence = (rental.billingCadence || "weekly").toLowerCase();
    const amt = rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0;
    return `${fmtMoney(Number(amt))} / ${cadence === "daily" ? "day" : cadence === "monthly" ? "month" : "week"}`;
  })();

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{c.dba}</Text>
            <Text style={{ fontSize: 8, color: COLOR_MUTED, marginTop: 2 }}>{c.legalName}</Text>
          </View>
          <View>
            <Text style={styles.companyMeta}>{c.address}</Text>
            <Text style={styles.companyMeta}>{c.phone}</Text>
            <Text style={styles.companyMeta}>{c.website}</Text>
          </View>
        </View>

        <Text style={styles.title}>Payment Receipt</Text>
        <Text style={styles.subtitle}>
          Reservation #{rental.id} • Issued {fmtDateTime(payment.paidAt)}
        </Text>

        <Text style={styles.sectionBar}>Customer</Text>
        <Field label="Name" value={driver.fullName} />
        <Field label="Phone" value={driver.phone} />
        <Field label="Email" value={driver.email} />

        <Text style={styles.sectionBar}>Vehicle</Text>
        <Field label="Vehicle" value={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} />
        <Field label="Plate" value={vehicle.plate} />
        <Field label="VIN" value={vehicle.vin} />

        <Text style={styles.sectionBar}>Rental Period</Text>
        <Field label="Start" value={fmtDate(rental.startDate)} />
        <Field label="End" value={rental.endDate ? fmtDate(rental.endDate) : "Open-ended"} />
        <Field label="Rate" value={rateLabel} />

        <Text style={styles.sectionBar}>Payment</Text>
        <Field label="Method" value={payment.method} />
        <Field label="Reference" value={payment.reference ?? ""} />
        <Field label="Date" value={fmtDateTime(payment.paidAt)} />

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total Charge</Text>
            <Text style={styles.totalsValue}>{fmtMoney(payment.totalCost)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Amount Paid</Text>
            <Text style={styles.totalsValue}>{fmtMoney(payment.amount)}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Balance Due</Text>
            <Text style={styles.grandValue}>{fmtMoney(payment.balanceDue)}</Text>
          </View>
        </View>

        {payment.balanceDue <= 0 && <Text style={styles.paidStamp}>PAID</Text>}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${c.dba} — Receipt for Reservation #${rental.id}  |  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}