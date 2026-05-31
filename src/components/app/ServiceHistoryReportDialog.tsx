import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/app/SignaturePad";
import { toast } from "sonner";
import { maintenance, fmtDate, fmtMoney, type Vehicle, type Maintenance } from "@/lib/mock/data";
import { isServiceLogRecord, isIssueRecord, lastServiceFor, summarizeOpenIssue } from "@/lib/maintenance-utils";
import { useAgreementSettings } from "@/lib/agreementSettings";
import { useStoreVersion } from "@/lib/mock/store";
import { renderServiceHistoryPdf, type ServiceHistoryData } from "@/lib/service-history-pdf";
import { Printer, Download, PenLine, Mail } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicle: Vehicle;
}

function matchLine(notes: string | undefined, label: string): string {
  if (!notes) return "";
  const m = notes.match(new RegExp(`${label}\\s*:?\\s*\\$?([0-9][0-9,\\.]*)`, "i"));
  return m ? `$${m[1]}` : "";
}

export function ServiceHistoryReportDialog({ open, onOpenChange, vehicle }: Props) {
  useStoreVersion();
  const settings = useAgreementSettings();
  const today = new Date().toISOString().slice(0, 10);

  const [notes, setNotes] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [dateSigned, setDateSigned] = useState(today);
  const [signature, setSignature] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<HTMLDivElement>(null);

  const data: ServiceHistoryData = useMemo(() => {
    const vMx = maintenance.filter(m => m.vehicleId === vehicle.id);
    const serviceLog = vMx
      .filter(isServiceLogRecord)
      .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
    const repairs = vMx
      .filter(m => !!m.dateCompleted && isIssueRecord(m))
      .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
    const openIssues = vMx
      .filter(m => !m.dateCompleted)
      .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));

    const totalMaintenance = serviceLog.reduce((s, m) => s + m.cost, 0);
    const totalRepair = repairs.reduce((s, m) => s + m.cost, 0);
    const lastSvc = lastServiceFor(maintenance, vehicle.id);
    let openBalance = 0;
    const openRows = openIssues.map((m: Maintenance) => {
      const sum = summarizeOpenIssue(m);
      const balRaw = matchLine(m.notes, "Balance");
      const bal = Number(balRaw.replace(/[$,]/g, ""));
      if (Number.isFinite(bal)) openBalance += bal;
      return {
        dateStarted: fmtDate(m.createdAt?.slice(0, 10)),
        issue: m.serviceType,
        vendor: sum.vendor,
        estTotal: m.cost > 0 ? fmtMoney(m.cost) : matchLine(m.notes, "Estimated total") || matchLine(m.notes, "Down payment") || "—",
        balance: balRaw || "—",
        estReturn: sum.estimatedReturn || "—",
      };
    });

    return {
      vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model, plate: vehicle.plate, vin: vehicle.vin },
      generatedAt: fmtDate(today),
      serviceLog: serviceLog.map(m => ({
        date: fmtDate(m.dateCompleted),
        type: m.serviceType,
        cost: m.cost,
        nextDue: fmtDate(m.nextServiceDue),
      })),
      repairs: repairs.map(m => ({
        date: fmtDate(m.dateCompleted),
        type: m.serviceType,
        vendor: m.vendor || m.completedBy || "—",
        parts: matchLine(m.notes, "Parts") || "—",
        labor: matchLine(m.notes, "Labor") || "—",
        total: m.cost,
        status: "COMPLETED",
      })),
      openIssues: openRows,
      summary: {
        totalMaintenance,
        totalRepair,
        openBalance,
        lastService: lastSvc ? `${fmtDate(lastSvc.dateCompleted)} (${lastSvc.serviceType})` : "—",
        nextDue: lastSvc ? fmtDate(lastSvc.nextServiceDue) : "—",
      },
      notes,
      signedBy,
      dateSigned: fmtDate(dateSigned),
      signatureDataUrl: signature,
      settings,
    };
  }, [vehicle, notes, signedBy, dateSigned, signature, settings, today]);

  const fileName = `service-history-${vehicle.year}-${vehicle.make}-${vehicle.model}-${vehicle.plate}`
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();

  async function downloadPdf() {
    setBusy(true);
    try {
      const bytes = await renderServiceHistoryPdf(data);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Report downloaded");
    } catch (e: any) {
      toast.error("Could not generate PDF", { description: e?.message ?? "Try again" });
    } finally {
      setBusy(false);
    }
  }

  async function printReport() {
    setBusy(true);
    try {
      const bytes = await renderServiceHistoryPdf(data);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) {
        w.addEventListener("load", () => setTimeout(() => w.print(), 400));
      } else {
        toast.error("Pop-up blocked", { description: "Allow pop-ups to print." });
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      toast.error("Could not open print view", { description: e?.message ?? "Try again" });
    } finally {
      setBusy(false);
    }
  }

  function emailReport() {
    const to = window.prompt("Email report to:");
    if (!to) return;
    const s = data.summary;
    const body = [
      `Vehicle Service History Report`,
      `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model} — Plate ${data.vehicle.plate}`,
      `VIN: ${data.vehicle.vin || "N/A"}`,
      `Generated: ${data.generatedAt}`,
      ``,
      `Total maintenance cost: ${fmtMoney(s.totalMaintenance)}`,
      `Total repair cost: ${fmtMoney(s.totalRepair)}`,
      `Open issues balance due: ${fmtMoney(s.openBalance)}`,
      `Last service: ${s.lastService}`,
      `Next due: ${s.nextDue}`,
      ``,
      `Please download the full PDF report from the Fleet system and attach it for complete records.`,
    ].join("\n");
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      `Service History — ${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model} (${data.vehicle.plate})`,
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-4 rounded bg-primary px-2 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
      {children}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Service History Report</DialogTitle>
          <DialogDescription>
            {vehicle.year} {vehicle.make} {vehicle.model} · Plate {vehicle.plate}
          </DialogDescription>
        </DialogHeader>

        {/* Action bar */}
        <div className="flex flex-wrap gap-2 border-b pb-3">
          <Button size="sm" variant="outline" onClick={printReport} disabled={busy}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
          <Button size="sm" onClick={downloadPdf} disabled={busy}>
            <Download className="mr-1.5 h-4 w-4" /> Download PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowSignature(true);
              setTimeout(() => sigRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
            disabled={busy}
          >
            <PenLine className="mr-1.5 h-4 w-4" /> Sign Document
          </Button>
          <Button size="sm" variant="outline" onClick={emailReport} disabled={busy}>
            <Mail className="mr-1.5 h-4 w-4" /> Email Report
          </Button>
        </div>

        {/* Report preview */}
        <div className="rounded-md border bg-card p-4 text-sm">
          <div className="grid gap-1 sm:grid-cols-2">
            <div><span className="text-muted-foreground">Vehicle: </span><span className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</span></div>
            <div><span className="text-muted-foreground">Tag: </span><span className="font-medium">#{vehicle.plate}</span></div>
            <div><span className="text-muted-foreground">VIN: </span><span className="font-medium">{vehicle.vin || "—"}</span></div>
            <div><span className="text-muted-foreground">Generated: </span><span className="font-medium">{data.generatedAt}</span></div>
          </div>

          <SectionTitle>Service Log</SectionTitle>
          <Table head={["Date", "Service Type", "Cost", "Next Due"]} rows={data.serviceLog.map(r => [r.date, r.type, fmtMoney(r.cost), r.nextDue])} empty="No routine service records." />

          <SectionTitle>Repair History</SectionTitle>
          <Table head={["Date", "Repair", "Vendor", "Parts", "Labor", "Total", "Status"]} rows={data.repairs.map(r => [r.date, r.type, r.vendor, r.parts, r.labor, fmtMoney(r.total), r.status])} empty="No completed repairs." />

          <SectionTitle>Open Issues</SectionTitle>
          <Table head={["Started", "Issue", "Vendor", "Est. Total", "Balance", "Est. Return"]} rows={data.openIssues.map(r => [r.dateStarted, r.issue, r.vendor, r.estTotal, r.balance, r.estReturn])} empty="No open issues." />

          <SectionTitle>Summary</SectionTitle>
          <div className="mt-2 grid gap-1">
            <SummaryRow label="Total maintenance cost" value={fmtMoney(data.summary.totalMaintenance)} />
            <SummaryRow label="Total repair cost" value={fmtMoney(data.summary.totalRepair)} />
            <SummaryRow label="Open issues balance due" value={fmtMoney(data.summary.openBalance)} />
            <SummaryRow label="Last service" value={data.summary.lastService} />
            <SummaryRow label="Next due" value={data.summary.nextDue} />
          </div>
        </div>

        {/* Admin inputs */}
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Additional Notes</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. This vehicle has been well-maintained and is in good condition for resale."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Signed By</Label>
              <Input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Admin name" />
            </div>
            <div className="grid gap-1.5">
              <Label>Date Signed</Label>
              <Input type="date" value={dateSigned} onChange={(e) => setDateSigned(e.target.value)} />
            </div>
          </div>
          <div ref={sigRef} className="grid gap-1.5">
            <Label>Signature</Label>
            {showSignature ? (
              <SignaturePad value={signature ?? undefined} onChange={setSignature} />
            ) : (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowSignature(true)}>
                <PenLine className="mr-1.5 h-4 w-4" /> Click to sign
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {head.map((h) => <th key={h} className="py-1 pr-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="py-2 text-muted-foreground">{empty}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {row.map((cell, j) => <td key={j} className="py-1 pr-2">{cell || "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}