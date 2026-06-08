import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, sendSms } from "@/lib/ghl.server";

const BACKUP_EMAIL = "rentalprise@yahoo.com";
const ADMIN_SMS = "+12672213977";
const BUCKET = "backups";
const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 year

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type BackupFile = {
  name: string;
  url: string;
  category: string;
  format: "csv" | "xlsx" | "pdf" | "zip";
};

export type BackupStats = {
  totalRentals: number;
  totalRevenue: number;
  totalRepairs: number;
  totalRepairCost: number;
  newCustomers: number;
  totalCustomers: number;
  totalVehicles: number;
  totalViolations: number;
  netProfit: number;
};

export type BackupResult = {
  ok: boolean;
  backupId: string | null;
  period: string;
  monthLabel: string;
  emailStatus: string;
  files: BackupFile[];
  stats: BackupStats;
  error?: string;
};

function money(n: number): string {
  return `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function periodLabel(period: string): { label: string; slug: string; start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const monthName = MONTHS[(m || 1) - 1] ?? "";
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  // end = first day of next month
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { label: `${monthName} ${y}`, slug: `${monthName.toLowerCase()}_${y}`, start, end };
}

/** Returns "YYYY-MM" for the previous month relative to now. */
export function previousMonthPeriod(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based; previous month is m-1 but getUTCMonth already 0-based current
  // current month index = m (0-based). previous month:
  const prev = m === 0 ? 12 : m;
  const prevYear = m === 0 ? y - 1 : y;
  return `${prevYear}-${String(prev).padStart(2, "0")}`;
}

export function currentMonthPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ----------------------------- CSV -----------------------------
function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const r of rows) lines.push(r.map(escapeCsv).join(","));
  return lines.join("\n");
}

// ----------------------------- PDF -----------------------------
async function tablePdf(
  title: string,
  monthLabel: string,
  summary: { label: string; value: string }[],
  headers: string[],
  rows: (string | number)[][],
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  let y = margin;

  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Camauto Rentals · ${monthLabel}`, margin, y);
  y += 20;

  // Summary block
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  for (const s of summary) {
    doc.text(`${s.label}: ${s.value}`, margin, y);
    y += 14;
  }
  y += 8;

  // Table
  const usableW = pageW - margin * 2;
  const colW = usableW / headers.length;
  const drawHeader = () => {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y - 10, usableW, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    headers.forEach((h, i) => {
      doc.text(String(h).slice(0, 22), margin + i * colW + 3, y);
    });
    y += 12;
    doc.setTextColor(15, 23, 42);
  };
  drawHeader();

  doc.setFontSize(8);
  rows.forEach((row, idx) => {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    if (idx % 2 === 0) {
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y - 9, usableW, 13, "F");
    }
    row.forEach((cell, i) => {
      doc.text(String(cell ?? "").slice(0, 24), margin + i * colW + 3, y);
    });
    y += 13;
  });

  if (rows.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.text("No records for this period.", margin, y + 4);
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

// ----------------------------- Core -----------------------------
type Dataset = {
  reservations: { headers: string[]; rows: (string | number)[][] };
  repairs: { headers: string[]; rows: (string | number)[][] };
  customers: { headers: string[]; rows: (string | number)[][] };
  vehicles: { headers: string[]; rows: (string | number)[][] };
  pnl: { headers: string[]; rows: (string | number)[][] };
  violations: { headers: string[]; rows: (string | number)[][] };
};

async function buildDatasets(period: string): Promise<{ data: Dataset; stats: BackupStats }> {
  const { start, end } = periodLabel(period);
  const inMonth = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const d = iso.slice(0, 10);
    return d >= start && d < end;
  };

  const [
    { data: rentals },
    { data: drivers },
    { data: vehicles },
    { data: maintenance },
    { data: violations },
    { data: payments },
    { data: expenses },
  ] = await Promise.all([
    supabaseAdmin.from("rentals").select("id, driver_id, vehicle_id, start_date, end_date, returned_at, reservation_status, rate, weekly_rate, rate_amount, billing_cadence, payment_status, final_charge_amount, created_at"),
    supabaseAdmin.from("drivers").select("id, full_name, phone, email, address, street_address, city, state, zip_code, license_number, dl_state, license_expiry, created_at"),
    supabaseAdmin.from("vehicles").select("id, make, model, year, plate, vin, status, mileage, insurance_expiry, registration_expiry"),
    supabaseAdmin.from("maintenance").select("id, vehicle_id, service_type, issue_description, vendor, mechanic_name, parts_cost, labor_cost, cost, date_completed, completion_date, completed_by, created_at"),
    supabaseAdmin.from("violations").select("id, driver_id, vehicle_id, license_plate, type, description, amount, total_amount, status, date_issued, signed_at, submitted_to_authority_at, paid_at, created_at"),
    supabaseAdmin.from("payments").select("id, rental_id, driver_id, amount, due_date, paid_date, method, status, created_at"),
    supabaseAdmin.from("expenses").select("id, vehicle_id, category, amount, date, vendor, created_at"),
  ]);

  const driverById = new Map((drivers ?? []).map((d) => [d.id, d]));
  const vehicleById = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const rentalById = new Map((rentals ?? []).map((r) => [r.id, r]));
  const vLabel = (v: any) => v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.replace(/\s+/g, " ").trim() : "—";

  // ---- Reservations: created in month OR active OR returned in month ----
  const monthRentals = (rentals ?? []).filter(
    (r) => inMonth(r.created_at) || inMonth(r.returned_at) || (r.reservation_status ?? "").toLowerCase() === "active",
  );
  const paymentsByRental = new Map<string, any[]>();
  for (const p of payments ?? []) {
    if (!p.rental_id) continue;
    const arr = paymentsByRental.get(p.rental_id) ?? [];
    arr.push(p);
    paymentsByRental.set(p.rental_id, arr);
  }
  const reservations = {
    headers: ["Rental ID", "Customer", "Vehicle", "Plate", "Start", "End", "Returned", "Status", "Rate", "Final Charge", "Payments", "Paid Total"],
    rows: monthRentals.map((r) => {
      const d = driverById.get(r.driver_id);
      const v = vehicleById.get(r.vehicle_id);
      const pays = paymentsByRental.get(r.id) ?? [];
      const paidTotal = pays.filter((p) => (p.status ?? "").toLowerCase() === "paid").reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return [
        r.id, d?.full_name ?? "—", vLabel(v), v?.plate ?? "—",
        r.start_date ?? "", r.end_date ?? "", r.returned_at?.slice(0, 10) ?? "",
        r.reservation_status ?? "", money(Number(r.rate_amount ?? r.rate ?? r.weekly_rate ?? 0)),
        money(Number(r.final_charge_amount ?? 0)), pays.length, money(paidTotal),
      ];
    }),
  };

  // ---- Repairs: completed or created in month ----
  const monthMaint = (maintenance ?? []).filter(
    (m) => inMonth(m.date_completed) || inMonth(m.completion_date) || inMonth(m.created_at),
  );
  const repairs = {
    headers: ["ID", "Vehicle", "Service / Issue", "Vendor", "Mechanic", "Parts", "Labor", "Total", "Completed", "Completed By"],
    rows: monthMaint.map((m) => {
      const v = vehicleById.get(m.vehicle_id);
      const parts = Number(m.parts_cost) || 0;
      const labor = Number(m.labor_cost) || 0;
      const total = Number(m.cost) || parts + labor;
      return [
        m.id, vLabel(v), m.service_type ?? m.issue_description ?? "—", m.vendor ?? "—",
        m.mechanic_name ?? "—", money(parts), money(labor), money(total),
        (m.date_completed ?? m.completion_date ?? "")?.slice(0, 10) ?? "", m.completed_by ?? "—",
      ];
    }),
  };

  // ---- Customers: full snapshot ----
  const rentalsByDriver = new Map<string, number>();
  for (const r of rentals ?? []) rentalsByDriver.set(r.driver_id, (rentalsByDriver.get(r.driver_id) ?? 0) + 1);
  const ltvByDriver = new Map<string, number>();
  for (const p of payments ?? []) {
    if ((p.status ?? "").toLowerCase() === "paid" && p.driver_id) {
      ltvByDriver.set(p.driver_id, (ltvByDriver.get(p.driver_id) ?? 0) + (Number(p.amount) || 0));
    }
  }
  const customers = {
    headers: ["ID", "Name", "Phone", "Email", "Address", "License #", "State", "Expiry", "Total Rentals", "Lifetime Value"],
    rows: (drivers ?? []).map((d) => [
      d.id, d.full_name ?? "—", d.phone ?? "—", d.email ?? "—",
      d.address ?? [d.street_address, d.city, d.state, d.zip_code].filter(Boolean).join(", ") || "—",
      d.license_number ?? "—", d.dl_state ?? "—", d.license_expiry ?? "—",
      rentalsByDriver.get(d.id) ?? 0, money(ltvByDriver.get(d.id) ?? 0),
    ]),
  };

  // ---- Vehicles: full snapshot ----
  const repairCountByVehicle = new Map<string, number>();
  const repairCostByVehicle = new Map<string, number>();
  for (const m of maintenance ?? []) {
    repairCountByVehicle.set(m.vehicle_id, (repairCountByVehicle.get(m.vehicle_id) ?? 0) + 1);
    const total = Number(m.cost) || (Number(m.parts_cost) || 0) + (Number(m.labor_cost) || 0);
    repairCostByVehicle.set(m.vehicle_id, (repairCostByVehicle.get(m.vehicle_id) ?? 0) + total);
  }
  const vehiclesDs = {
    headers: ["ID", "Make", "Model", "Year", "Plate", "VIN", "Status", "Mileage", "Insurance Exp", "Reg Exp", "Repairs", "Repair Cost"],
    rows: (vehicles ?? []).map((v) => [
      v.id, v.make ?? "—", v.model ?? "—", v.year ?? "—", v.plate ?? "—", v.vin ?? "—",
      v.status ?? "—", v.mileage ?? "—", v.insurance_expiry ?? "—", v.registration_expiry ?? "—",
      repairCountByVehicle.get(v.id) ?? 0, money(repairCostByVehicle.get(v.id) ?? 0),
    ]),
  };

  // ---- P&L per vehicle (for the month) ----
  // Revenue: payments paid in month, mapped to vehicle via rental
  const revByVehicle = new Map<string, number>();
  for (const p of payments ?? []) {
    if ((p.status ?? "").toLowerCase() !== "paid") continue;
    if (!inMonth(p.paid_date) && !inMonth(p.due_date)) continue;
    const rental = p.rental_id ? rentalById.get(p.rental_id) : null;
    if (!rental?.vehicle_id) continue;
    revByVehicle.set(rental.vehicle_id, (revByVehicle.get(rental.vehicle_id) ?? 0) + (Number(p.amount) || 0));
  }
  const expByVehicle = new Map<string, number>();
  for (const e of expenses ?? []) {
    if (!inMonth(e.date) && !inMonth(e.created_at)) continue;
    if (!e.vehicle_id) continue;
    expByVehicle.set(e.vehicle_id, (expByVehicle.get(e.vehicle_id) ?? 0) + (Number(e.amount) || 0));
  }
  for (const m of monthMaint) {
    if (!m.vehicle_id) continue;
    const total = Number(m.cost) || (Number(m.parts_cost) || 0) + (Number(m.labor_cost) || 0);
    expByVehicle.set(m.vehicle_id, (expByVehicle.get(m.vehicle_id) ?? 0) + total);
  }
  for (const vio of violations ?? []) {
    if (!inMonth(vio.date_issued) && !inMonth(vio.created_at)) continue;
    if (!vio.vehicle_id) continue;
    const amt = Number(vio.total_amount ?? vio.amount ?? 0);
    expByVehicle.set(vio.vehicle_id, (expByVehicle.get(vio.vehicle_id) ?? 0) + amt);
  }
  let totalRevenue = 0, totalExpenses = 0;
  const pnlRows: (string | number)[][] = (vehicles ?? []).map((v) => {
    const rev = revByVehicle.get(v.id) ?? 0;
    const exp = expByVehicle.get(v.id) ?? 0;
    totalRevenue += rev;
    totalExpenses += exp;
    return [v.id, vLabel(v), v.plate ?? "—", money(rev), money(exp), money(rev - exp)];
  });
  pnlRows.push(["", "TOTALS", "", money(totalRevenue), money(totalExpenses), money(totalRevenue - totalExpenses)]);
  const pnl = {
    headers: ["ID", "Vehicle", "Plate", "Revenue", "Expenses", "Net Profit"],
    rows: pnlRows,
  };

  // ---- Violations: issued in month ----
  const monthViolations = (violations ?? []).filter((v) => inMonth(v.date_issued) || inMonth(v.created_at));
  const violationsDs = {
    headers: ["ID", "Customer", "Vehicle", "Plate", "Type", "Amount", "Total", "Status", "Issued", "Affidavit Signed", "Submitted"],
    rows: monthViolations.map((v) => {
      const d = v.driver_id ? driverById.get(v.driver_id) : null;
      const veh = v.vehicle_id ? vehicleById.get(v.vehicle_id) : null;
      return [
        v.id, d?.full_name ?? "—", vLabel(veh), v.license_plate ?? veh?.plate ?? "—",
        v.type ?? v.description ?? "—", money(Number(v.amount) || 0), money(Number(v.total_amount ?? v.amount) || 0),
        v.status ?? "—", v.date_issued ?? "", v.signed_at ? "Yes" : "No", v.submitted_to_authority_at ? "Yes" : "No",
      ];
    }),
  };

  const newCustomers = (drivers ?? []).filter((d) => inMonth(d.created_at)).length;
  const totalRepairCost = monthMaint.reduce(
    (s, m) => s + (Number(m.cost) || (Number(m.parts_cost) || 0) + (Number(m.labor_cost) || 0)), 0,
  );

  const stats: BackupStats = {
    totalRentals: monthRentals.length,
    totalRevenue,
    totalRepairs: monthMaint.length,
    totalRepairCost,
    newCustomers,
    totalCustomers: (drivers ?? []).length,
    totalVehicles: (vehicles ?? []).length,
    totalViolations: monthViolations.length,
    netProfit: totalRevenue - totalExpenses,
  };

  return {
    data: { reservations, repairs, customers, vehicles: vehiclesDs, pnl, violations: violationsDs },
    stats,
  };
}

async function buildExcel(data: Dataset, monthLabel: string): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Camauto Rentals";
  wb.created = new Date();
  const tabs: [string, { headers: string[]; rows: (string | number)[][] }][] = [
    ["Reservations", data.reservations],
    ["Repairs", data.repairs],
    ["Customers", data.customers],
    ["Vehicles", data.vehicles],
    ["P&L", data.pnl],
    ["Violations", data.violations],
  ];
  for (const [name, ds] of tabs) {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow([`${name} — ${monthLabel}`]);
    ws.getRow(1).font = { bold: true, size: 14 };
    const hdr = ws.addRow(ds.headers);
    hdr.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    });
    ds.rows.forEach((r) => ws.addRow(r));
    ds.headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = Math.min(40, Math.max(12, h.length + 4));
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

const CATEGORY_TITLES: Record<keyof Dataset, string> = {
  reservations: "Reservations Report",
  repairs: "Repairs Report",
  customers: "Customers Report",
  vehicles: "Vehicles Report",
  pnl: "Profit & Loss Report",
  violations: "Violations Report",
};

async function uploadFile(path: string, body: Uint8Array, contentType: string): Promise<string | null> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) {
    console.error(`[backup] upload failed ${path}: ${error.message}`);
    return null;
  }
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  return data?.signedUrl ?? null;
}

export async function runBackup(opts: { period: string; triggeredBy: "cron" | "admin" }): Promise<BackupResult> {
  const { period, triggeredBy } = opts;
  const { label: monthLabel, slug } = periodLabel(period);
  const [y, m] = period.split("-");
  const basePath = `${y}/${m}`;

  // Create the tracking row up front so failures are still recorded.
  const { data: inserted } = await supabaseAdmin
    .from("backups")
    .insert({ period_month: period, triggered_by: triggeredBy, email_status: "pending" })
    .select("id")
    .single();
  const backupId = inserted?.id ?? null;

  try {
    const { data, stats } = await buildDatasets(period);
    const files: BackupFile[] = [];
    const { default: JSZip } = await import("jszip");
    const csvZip = new JSZip();
    const pdfZip = new JSZip();

    const categories = Object.keys(data) as (keyof Dataset)[];

    // CSVs
    for (const cat of categories) {
      const ds = data[cat];
      const csv = toCSV(ds.headers, ds.rows);
      const fname = `${cat}_${slug}.csv`;
      csvZip.file(fname, csv);
      const url = await uploadFile(`${basePath}/${fname}`, new TextEncoder().encode(csv), "text/csv");
      if (url) files.push({ name: fname, url, category: cat, format: "csv" });
    }

    // Excel
    const xlsxBuf = await buildExcel(data, monthLabel);
    const xlsxName = `camauto_backup_${slug}.xlsx`;
    const xlsxUrl = await uploadFile(`${basePath}/${xlsxName}`, xlsxBuf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (xlsxUrl) files.push({ name: xlsxName, url: xlsxUrl, category: "combined", format: "xlsx" });

    // PDFs
    for (const cat of categories) {
      const ds = data[cat];
      const summary: { label: string; value: string }[] = [
        { label: "Records", value: String(ds.rows.length) },
      ];
      if (cat === "reservations") summary.push({ label: "Total revenue", value: money(stats.totalRevenue) });
      if (cat === "repairs") summary.push({ label: "Total repair cost", value: money(stats.totalRepairCost) });
      if (cat === "pnl") summary.push({ label: "Net profit", value: money(stats.netProfit) });
      const pdf = await tablePdf(CATEGORY_TITLES[cat], monthLabel, summary, ds.headers, ds.rows);
      const fname = `${cat}_report_${slug}.pdf`;
      pdfZip.file(fname, pdf);
      const url = await uploadFile(`${basePath}/${fname}`, pdf, "application/pdf");
      if (url) files.push({ name: fname, url, category: cat, format: "pdf" });
    }

    // Zips
    const csvZipBuf = await csvZip.generateAsync({ type: "uint8array" });
    const csvZipUrl = await uploadFile(`${basePath}/csvs_${slug}.zip`, csvZipBuf, "application/zip");
    if (csvZipUrl) files.push({ name: `csvs_${slug}.zip`, url: csvZipUrl, category: "csv-bundle", format: "zip" });
    const pdfZipBuf = await pdfZip.generateAsync({ type: "uint8array" });
    const pdfZipUrl = await uploadFile(`${basePath}/pdfs_${slug}.zip`, pdfZipBuf, "application/zip");
    if (pdfZipUrl) files.push({ name: `pdfs_${slug}.zip`, url: pdfZipUrl, category: "pdf-bundle", format: "zip" });

    // Persist files + stats before emailing
    if (backupId) {
      await supabaseAdmin.from("backups").update({ file_urls: files, stats }).eq("id", backupId);
    }

    // Email
    const emailStatus = await deliverBackupEmail(period, monthLabel, stats, files);
    if (backupId) {
      await supabaseAdmin.from("backups").update({
        email_status: emailStatus,
        email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null,
        email_attempts: 1,
      }).eq("id", backupId);
    }

    if (emailStatus !== "sent") {
      await notifyEmailFailure(monthLabel);
    }

    return { ok: true, backupId, period, monthLabel, emailStatus, files, stats };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[backup] FAILED period=${period}: ${msg}`);
    if (backupId) {
      await supabaseAdmin.from("backups").update({ email_status: "failed", error_message: msg }).eq("id", backupId);
    }
    return {
      ok: false, backupId, period, monthLabel, emailStatus: "failed", files: [],
      stats: { totalRentals: 0, totalRevenue: 0, totalRepairs: 0, totalRepairCost: 0, newCustomers: 0, totalCustomers: 0, totalVehicles: 0, totalViolations: 0, netProfit: 0 },
      error: msg,
    };
  }
}

function dashboardLink(): string {
  const origin = process.env.PUBLIC_APP_ORIGIN || "https://camautorentals.lovable.app";
  return `${origin.replace(/\/$/, "")}/admin/backups`;
}

export async function deliverBackupEmail(
  period: string,
  monthLabel: string,
  stats: BackupStats,
  files: BackupFile[],
): Promise<"sent" | "failed"> {
  const attachments = files.filter((f) => f.format !== "zip").map((f) => f.url);
  const xlsx = files.find((f) => f.format === "xlsx");
  const body =
    `Hi,\n\n` +
    `Your monthly Camauto Rentals backup is ready.\n\n` +
    `Period: ${monthLabel}\n\n` +
    `Quick stats:\n` +
    `- Total rentals: ${stats.totalRentals}\n` +
    `- Total revenue: ${money(stats.totalRevenue)}\n` +
    `- Total repairs: ${stats.totalRepairs} (${money(stats.totalRepairCost)})\n` +
    `- New customers: ${stats.newCustomers}\n` +
    `- Net profit: ${money(stats.netProfit)}\n\n` +
    `Attached files:\n` +
    `- Combined Excel: ${xlsx?.name ?? "n/a"}\n` +
    `- Individual CSVs (6 files)\n` +
    `- PDF reports (6 files)\n\n` +
    `Download from admin dashboard if email fails: ${dashboardLink()}\n\n` +
    `Camauto Rentals System`;
  try {
    await sendEmail(BACKUP_EMAIL, `Camauto Rentals - Monthly Backup ${monthLabel}`, body, { attachments });
    return "sent";
  } catch (e) {
    console.error(`[backup] email failed: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}

async function notifyEmailFailure(monthLabel: string): Promise<void> {
  try {
    await sendSms(
      ADMIN_SMS,
      `⚠️ Backup email failed for ${monthLabel}. Download manually from /admin/backups`,
      "Management",
    );
  } catch (e) {
    console.error(`[backup] failure SMS failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Retry email delivery for an existing backup row. Used by the daily retry cron. */
export async function retryPendingBackupEmails(maxAttempts = 3): Promise<{ retried: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("backups")
    .select("id, period_month, file_urls, stats, email_attempts, generated_at")
    .neq("email_status", "sent")
    .gte("generated_at", since);
  let retried = 0;
  for (const row of rows ?? []) {
    if ((row.email_attempts ?? 0) >= maxAttempts) continue;
    const { label } = periodLabel(row.period_month);
    const status = await deliverBackupEmail(row.period_month, label, row.stats as BackupStats, (row.file_urls as BackupFile[]) ?? []);
    await supabaseAdmin.from("backups").update({
      email_status: status,
      email_sent_at: status === "sent" ? new Date().toISOString() : null,
      email_attempts: (row.email_attempts ?? 0) + 1,
    }).eq("id", row.id);
    if (status !== "sent") await notifyEmailFailure(label);
    retried++;
  }
  return { retried };
}