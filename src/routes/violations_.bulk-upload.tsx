import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Search,
  Download,
} from "lucide-react";
import { Plus, Trash2, Send, Ban, FilePlus2, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  processEzpassDocument,
  getEzpassBatch,
  manualMatchEzpassItem,
  approveEzpassBatch,
  downloadAffidavitsZip,
  matchAndCommitEzpassItem,
  getRentalAgreementUrl,
  dismissEzpassItem,
  createInternalRentalForItem,
  setEzpassBatchItemRef,
  type EzpassBatchItem,
} from "@/lib/ezpass.functions";
import { downloadViolationPacket } from "@/lib/violation-packet.functions";
import { debugEzpassMatch } from "@/lib/ezpass.functions";
import { createManualEzpassBatch } from "@/lib/ezpass.functions";
import {
  searchRentalsForViolation,
  sendRetroAgreementLink,
  type ViolationSearchCard,
} from "@/lib/retro-agreement.functions";
import { loadPdf } from "@/lib/pdf-to-image";

export const Route = createFileRoute("/violations_/bulk-upload")({
  head: () => ({ meta: [{ title: "EZPass Bulk Upload — Camauto Rentals" }] }),
  component: BulkUploadPage,
});

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString() : "—");

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to read file"));
    fr.readAsDataURL(file);
  });
}

function BulkUploadPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const process = useServerFn(processEzpassDocument);

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [tab, setTab] = useState("upload");
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = (f: File | null) => {
    if (!f) return;
    const ok = f.type === "application/pdf" || f.type.startsWith("image/");
    if (!ok) {
      toast.error("Please upload a PDF or image file");
      return;
    }
    setFile(f);
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress("Reading document…");
    try {
      let images: string[] = [];
      if (file.type === "application/pdf") {
        setProgress("Rendering PDF pages…");
        const pdf = await loadPdf(file);
        const pageCount = Math.min(pdf.pageCount, 30);
        for (let p = 1; p <= pageCount; p++) {
          setProgress(`Rendering page ${p} of ${pageCount}…`);
          images.push(await pdf.renderPage(p));
        }
      } else {
        images = [await readFileAsDataUrl(file)];
      }
      setProgress("Extracting violations with AI…");
      const res = await process({ data: { images, filename: file.name } });
      toast.success(`Found ${res.found} violation${res.found === 1 ? "" : "s"}`);
      setBatchId(res.batchId);
      qc.invalidateQueries({ queryKey: ["ezpass-batch", res.batchId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessing(false);
      setProgress("");
    }
  };

  if (batchId) {
    return <ReviewBatch batchId={batchId} onBack={() => router.navigate({ to: "/violations" })} />;
  }

  return (
    <div>
      <PageHeader
        title="EZPass Bulk Upload"
        subtitle="Upload statement → System extracts → Match renters → Generate liability transfers"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="upload">Upload PDF/Image</TabsTrigger>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
      <Card>
        <CardContent className="p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onPick(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              dragOver ? "border-emerald-500 bg-emerald-50/50" : "border-muted-foreground/25"
            }`}
          >
            {file ? (
              <>
                <FileText className="mb-3 h-10 w-10 text-emerald-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setFile(null)}
                  disabled={processing}
                >
                  Choose a different file
                </Button>
              </>
            ) : (
              <>
                <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Drag & drop an EZPass statement</p>
                <p className="mb-4 text-sm text-muted-foreground">PDF or image</p>
                <Button variant="outline" onClick={() => inputRef.current?.click()}>
                  Browse Files
                </Button>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{progress}</p>
            <Button
              onClick={handleProcess}
              disabled={!file || processing}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…
                </>
              ) : (
                "Process Document"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="manual">
          <ManualEntry onBatch={setBatchId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ManualRow {
  date: string;
  time: string;
  plate: string;
  location: string;
  amount: string;
}

function ManualEntry({ onBatch }: { onBatch: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createManualEzpassBatch);
  const emptyRow = (): ManualRow => ({ date: "", time: "", plate: "", location: "", amount: "" });
  const [rows, setRows] = useState<ManualRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);

  const update = (i: number, key: keyof ManualRow, value: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const handleProcess = async () => {
    const valid = rows
      .map((r) => ({
        violation_date: r.date.trim() || null,
        violation_time: r.time.trim() || null,
        plate: r.plate.trim() || null,
        location: r.location.trim() || null,
        amount: Number(r.amount) || 0,
      }))
      .filter((r) => r.plate || r.violation_date || r.amount > 0);
    if (valid.length === 0) {
      toast.error("Add at least one row with a plate, date, or amount");
      return;
    }
    setBusy(true);
    try {
      const res = await create({ data: { rows: valid } });
      toast.success(`Created ${res.found} violation${res.found === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["ezpass-batch", res.batchId] });
      onBatch(res.batchId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Paste or type a list of violations. Empty rows are ignored. We'll auto-match each by plate
          and date.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Time</th>
                <th className="p-2">Plate</th>
                <th className="p-2">Location</th>
                <th className="p-2">Amount</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-1">
                    <Input
                      type="date"
                      value={r.date}
                      onChange={(e) => update(i, "date", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      placeholder="08:30 AM"
                      value={r.time}
                      onChange={(e) => update(i, "time", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      placeholder="ABC1234"
                      value={r.plate}
                      onChange={(e) => update(i, "plate", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      placeholder="Toll plaza / location"
                      value={r.location}
                      onChange={(e) => update(i, "location", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => update(i, "amount", e.target.value)}
                    />
                  </td>
                  <td className="p-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(i)}
                      disabled={rows.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-4 w-4" /> Add Row
          </Button>
          <Button
            onClick={handleProcess}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…
              </>
            ) : (
              "Process All"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewBatch({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const get = useServerFn(getEzpassBatch);
  const approve = useServerFn(approveEzpassBatch);
  const dlZip = useServerFn(downloadAffidavitsZip);

  const { data, isLoading } = useQuery({
    queryKey: ["ezpass-batch", batchId],
    queryFn: () => get({ data: { batchId } }),
  });

  const [matchFor, setMatchFor] = useState<EzpassBatchItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveMode, setApproveMode] = useState<"all" | "matched">("all");

  const items = data?.items ?? [];
  const batch = data?.batch;
  const visibleItems = items.filter((i) => i.match_status !== "dismissed");
  const matchedCount = visibleItems.filter((i) => i.match_status === "matched").length;
  const unmatchedCount = visibleItems.length - matchedCount;
  const missingRefCount = visibleItems.filter(
    (i) => !i.violation_id && !(i.reference_number && i.reference_number.trim()),
  ).length;
  const totalAmount = useMemo(
    () => visibleItems.reduce((s, i) => s + Number(i.amount || 0), 0),
    [visibleItems],
  );
  const approved = batch?.status === "approved";

  const refresh = () => qc.invalidateQueries({ queryKey: ["ezpass-batch", batchId] });

  const handleApprove = async () => {
    if (missingRefCount > 0) {
      toast.error(
        `${missingRefCount} item${missingRefCount === 1 ? "" : "s"} missing an EZPass violation #. Enter it from the notice before approving.`,
      );
      return;
    }
    setApproving(true);
    try {
      const res = await approve({ data: { batchId, mode: approveMode } });
      if (res.skippedNoRef > 0) {
        toast.message(
          `${res.skippedNoRef} item${res.skippedNoRef === 1 ? "" : "s"} skipped — no EZPass violation #`,
        );
      }
      if (approveMode === "matched") {
        toast.success(
          `Saved ${res.matched} matched violation${res.matched === 1 ? "" : "s"} — ${res.unmatched} unmatched left to match`,
        );
      } else {
        toast.success(
          `Saved ${res.total} violation${res.total === 1 ? "" : "s"} — ${res.matched} matched, ${res.unmatched} unmatched`,
        );
      }
      setConfirmOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  };

  const handleZip = async () => {
    try {
      const res = await dlZip({ data: { batchId } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <div>
      <PageHeader
        title={`Review Extracted Violations (${items.length})`}
        subtitle={`Batch ${batchId}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Done
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="Total violations"
          value={String(visibleItems.length)}
        />
        <SummaryCard label="Auto-matched" value={String(matchedCount)} tone="ok" />
        <SummaryCard label="Unmatched" value={String(unmatchedCount)} tone={unmatchedCount ? "warn" : "ok"} />
        <SummaryCard label="Total amount" value={fmtMoney(totalAmount)} />
      </div>
      {missingRefCount > 0 && !approved && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">
              {missingRefCount} item{missingRefCount === 1 ? "" : "s"} missing an EZPass violation number.
            </p>
            <p className="text-xs">
              Enter the number from each notice in the "Violation #" column below. Approval is blocked
              until every row has one — a dispute packet without this number is invalid.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Date/Time</th>
                    <th className="p-3">Plate</th>
                    <th className="p-3">Violation #</th>
                    <th className="p-3">Toll Location</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Renter</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((it) => (
                    <tr key={it.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        {fmtDate(it.violation_date)}
                        {it.violation_time ? (
                          <span className="ml-1 text-xs text-muted-foreground">{it.violation_time}</span>
                        ) : null}
                      </td>
                      <td className="p-3 font-mono text-xs">{it.plate || "—"}</td>
                      <td className="p-3">
                        <RefNumberCell item={it} disabled={approved} onSaved={refresh} />
                      </td>
                      <td className="p-3">{it.location || "—"}</td>
                      <td className="p-3 text-right">{fmtMoney(Number(it.amount))}</td>
                      <td className="p-3">{it.driver_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">
                        {it.match_status === "matched" ? (
                          <Badge className="bg-emerald-600">✅ Matched</Badge>
                        ) : it.match_status === "multiple" ? (
                          <Badge className="bg-sky-600">
                            🔢 {it.candidates?.length ?? 2} options — pick renter
                          </Badge>
                        ) : (
                          <Badge variant="destructive">⚠️ Unmatched</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {approved && it.affidavit_pdf_url ? (
                          <Button size="sm" variant="ghost" asChild>
                            <a href={it.affidavit_pdf_url} target="_blank" rel="noreferrer">
                              Letter
                            </a>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant={it.match_status === "matched" ? "ghost" : "outline"}
                            onClick={() => setMatchFor(it)}
                            disabled={approved}
                          >
                            {it.match_status === "matched"
                              ? "Edit Match"
                              : it.match_status === "multiple"
                                ? "Pick Renter"
                                : "Manual Match"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DebugMatchPanel batchId={batchId} />

      <div className="mt-6 flex items-center justify-end gap-3">
        {approved ? (
          <Button onClick={handleZip} className="bg-emerald-600 hover:bg-emerald-700">
            <Download className="mr-2 h-4 w-4" /> Download All Letters
          </Button>
        ) : (
          <>
            {unmatchedCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {unmatchedCount} unmatched — save them too with "Approve All", or save only
                matched now.
              </p>
            )}
            <Button
              size="lg"
              variant="outline"
              disabled={items.length === 0 || matchedCount === 0}
              onClick={() => {
                setApproveMode("matched");
                setConfirmOpen(true);
              }}
            >
              <CheckCircle2 className="mr-2 h-5 w-5" /> Approve Matched ({matchedCount})
            </Button>
            <Button
              size="lg"
              disabled={items.length === 0}
              onClick={() => {
                setApproveMode("all");
                setConfirmOpen(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-2 h-5 w-5" /> Approve All ({items.length})
            </Button>
          </>
        )}
      </div>

      {matchFor && (
        <ManualMatchDialog
          item={matchFor}
          onClose={() => setMatchFor(null)}
          onMatched={() => {
            setMatchFor(null);
            refresh();
          }}
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save violations & generate letters?</DialogTitle>
            <DialogDescription>
              {approveMode === "matched" ? (
                <>
                  You're about to permanently save the {matchedCount} matched violation
                  {matchedCount === 1 ? "" : "s"}. Each moves to the Matched tab and gets a pre-filled
                  liability-transfer letter. The {unmatchedCount} unmatched one
                  {unmatchedCount === 1 ? "" : "s"} stay in this batch so you can match them later.
                  Continue?
                </>
              ) : (
                <>
                  You're about to permanently save all {items.length} violation
                  {items.length === 1 ? "" : "s"} to the violations list. The plate matcher re-runs on
                  save — matched ones move to the Matched tab and get a pre-filled liability-transfer
                  letter; unmatched ones land in the Uploaded tab to match later. Continue?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={approving}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approving}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {approving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                "Yes, Generate PDFs"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-bold ${
            tone === "warn" ? "text-destructive" : tone === "ok" ? "text-emerald-600" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function DebugMatchPanel({ batchId }: { batchId: string }) {
  const { role } = useAuth();
  const debug = useServerFn(debugEzpassMatch);
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["ezpass-debug", batchId],
    queryFn: () => debug({ data: { batchId } }),
    enabled: role === "admin" && open,
  });

  if (role !== "admin") return null;

  return (
    <Card className="mt-6 border-amber-400/60">
      <CardContent className="p-0">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between p-4 text-left">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide text-amber-600">
                DEBUG: matcher diagnostics (admin only)
              </span>
              <Badge variant="secondary">{open ? "Hide" : "Show"}</Badge>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="overflow-x-auto border-t p-4">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading diagnostics…</p>
              ) : isError ? (
                <p className="text-sm text-destructive">
                  {error instanceof Error ? error.message : "Failed to load diagnostics"}
                </p>
              ) : (
                <table className="w-full font-mono text-xs">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Stored plate (quoted)</th>
                      <th className="p-2">Normalized</th>
                      <th className="p-2">Raw date</th>
                      <th className="p-2">Parsed date</th>
                      <th className="p-2 text-right">Live by plate</th>
                      <th className="p-2 text-right">Live + date</th>
                      <th className="p-2 text-right">Legacy by plate</th>
                      <th className="p-2 text-right">Legacy + date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data ?? []).map((row) => (
                      <tr key={row.itemId} className="border-b last:border-0">
                        <td className="p-2 whitespace-pre">{`"${row.rawPlate ?? ""}"`}</td>
                        <td className="p-2">{row.normPlate || "—"}</td>
                        <td className="p-2">{row.rawDate ?? "null"}</td>
                        <td className="p-2">{row.parsedDate ?? "null"}</td>
                        <td className="p-2 text-right">{row.liveByPlate}</td>
                        <td className={`p-2 text-right ${row.liveByPlateAndDate === 0 && row.liveByPlate > 0 ? "text-amber-600 font-bold" : ""}`}>{row.liveByPlateAndDate}</td>
                        <td className="p-2 text-right">{row.legacyByPlate}</td>
                        <td className={`p-2 text-right ${row.legacyByPlateAndDate === 0 && row.legacyByPlate > 0 ? "text-amber-600 font-bold" : ""}`}>{row.legacyByPlateAndDate}</td>
                      </tr>
                    ))}
                    {(data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-3 text-center text-muted-foreground">
                          No items.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function ManualMatchDialog({
  item,
  onClose,
  onMatched,
}: {
  item: EzpassBatchItem;
  onClose: () => void;
  onMatched: () => void;
}) {
  const search = useServerFn(searchRentalsForViolation);
  const match = useServerFn(manualMatchEzpassItem);
  const sendRetro = useServerFn(sendRetroAgreementLink);
  const getAgreement = useServerFn(getRentalAgreementUrl);
  const matchCommit = useServerFn(matchAndCommitEzpassItem);
  const buildPacket = useServerFn(downloadViolationPacket);
  const dismiss = useServerFn(dismissEzpassItem);
  const createInternal = useServerFn(createInternalRentalForItem);

  const [date, setDate] = useState(item.violation_date ?? "");
  const [plate, setPlate] = useState(item.plate ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [retroFor, setRetroFor] = useState<ViolationSearchCard | null>(null);
  const [retroPhone, setRetroPhone] = useState("");
  const [retroEmail, setRetroEmail] = useState("");
  const [packetFor, setPacketFor] = useState<string | null>(null);
  const [inc, setInc] = useState({ coverLetter: true, agreement: true, license: true });
  // Tracks the rental this ticket is matched to — starts from whatever the
  // batch item was persisted with and updates whenever the user matches in
  // this dialog. Drives the enable/disable state on "Generate Dispute Packet".
  const [matchedRentalId, setMatchedRentalId] = useState<string | null>(item.rental_id ?? null);
  // "Create New Rental" internal-agreement flow.
  const [createOpen, setCreateOpen] = useState(false);
  const [newRenter, setNewRenter] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPlate, setNewPlate] = useState(item.plate ?? "");
  const [newStart, setNewStart] = useState((item.violation_date ?? "").slice(0, 10));
  const [newEnd, setNewEnd] = useState((item.violation_date ?? "").slice(0, 10));
  // "Plate Not Mine" dismissal confirm.
  const [dismissOpen, setDismissOpen] = useState(false);

  // Always load ALL rentals on this plate (and/or name) — never hard-filter by
  // the violation date. A rental whose stored window doesn't cover the toll
  // date (common for legacy imports with gaps) must still be shown so the admin
  // can pick it. The date is used only for relevance sorting below.
  const runSearch = useCallback(
    () =>
      search({
        data: {
          date: null,
          plate: plate.trim() || null,
          name: name.trim() || null,
        },
      }),
    [search, plate, name],
  );

  const {
    data: results = [],
    isFetching,
    refetch,
    error,
  } = useQuery<ViolationSearchCard[]>({
    queryKey: ["violation-match-search", item.id],
    queryFn: runSearch,
    enabled: Boolean(item.violation_date || item.plate),
    retry: false,
  });

  // Relevance sort: rentals that cover the violation date first, then the
  // closest by date, then newest. Never drops any result.
  const vDate = (item.violation_date || "").slice(0, 10);
  const sorted = useMemo(() => {
    const dayDiff = (a: string, b: string) => {
      const da = new Date(`${a}T00:00:00`).getTime();
      const db = new Date(`${b}T00:00:00`).getTime();
      if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
      return Math.abs(Math.round((da - db) / 86400000));
    };
    const score = (r: ViolationSearchCard) => {
      const start = (r.startDate || "").slice(0, 10);
      const end = (r.endDate || "").slice(0, 10);
      if (!vDate) return { rank: 2, dist: 0 };
      if (start && start <= vDate && (!end || end >= vDate)) return { rank: 0, dist: 0 };
      const dist = Math.min(
        start ? dayDiff(start, vDate) : Number.POSITIVE_INFINITY,
        end ? dayDiff(end, vDate) : Number.POSITIVE_INFINITY,
      );
      return { rank: dist <= 7 ? 1 : 2, dist };
    };
    return [...results]
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => {
        if (a.s.rank !== b.s.rank) return a.s.rank - b.s.rank;
        if (a.s.dist !== b.s.dist) return a.s.dist - b.s.dist;
        return (b.r.startDate || "").localeCompare(a.r.startDate || "");
      })
      .map((x) => ({ ...x.r, _coversDate: x.s.rank === 0 }));
  }, [results, vDate]);

  const confirm = async (rentalId: string) => {
    setBusy(true);
    try {
      await match({ data: { itemId: item.id, rentalId } });
      toast.success("Matched");
      onMatched();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Match failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadAgreement = async (rentalId: string) => {
    setBusy(true);
    try {
      const { url, filename } = await getAgreement({ data: { rentalId } });
      if (!url) {
        toast.error("No signed agreement on file for this rental");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load agreement");
    } finally {
      setBusy(false);
    }
  };

  const openPacketPicker = (rentalId: string) => {
    setInc({ coverLetter: true, agreement: true, license: true });
    setPacketFor(rentalId);
  };

  const matchAndPacket = async (rentalId: string) => {
    setBusy(true);
    try {
      const { violationId } = await matchCommit({ data: { itemId: item.id, rentalId } });
      setMatchedRentalId(rentalId);
      toast.success("Ticket created — building dispute packet…");
      const res = await buildPacket({
        data: {
          violationId,
          include: {
            coverLetter: inc.coverLetter,
            agreement: inc.agreement,
            license: inc.license,
            // Not shown in the picker; keep supporting evidence off by default
            // when the admin explicitly narrows to the 3 core docs.
            selfie: false,
            signature: false,
            receipt: false,
            violationPhoto: false,
          },
        },
      });
      if (!res.ok) {
        toast.error(
          res.error ??
            "Packet blocked — renter address or signature missing on the agreement.",
        );
        return;
      }
      const { filename, base64, missing } = res;
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (missing && missing.length > 0) {
        toast.warning(`Packet downloaded — missing: ${missing.join(", ")}`);
      } else {
        toast.success("Dispute packet downloaded");
      }
      setPacketFor(null);
      onMatched();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to build packet");
    } finally {
      setBusy(false);
    }
  };

  const startRetro = (card: ViolationSearchCard) => {
    setRetroFor(card);
    setRetroPhone(card.phone ?? "");
    setRetroEmail(card.email ?? "");
  };

  const submitRetro = async () => {
    if (!retroFor) return;
    if (!retroPhone.trim()) {
      toast.error("Enter a phone number to text the agreement");
      return;
    }
    setBusy(true);
    try {
      await sendRetro({
        data: {
          legacyId: retroFor.id,
          phone: retroPhone.trim(),
          email: retroEmail.trim() || null,
        },
      });
      toast.success("Retroactive agreement sent");
      setRetroFor(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send agreement");
    } finally {
      setBusy(false);
    }
  };

  const generateDisputePacket = () => {
    if (!matchedRentalId) {
      toast.error("Match a rental first, then generate the packet.");
      return;
    }
    // Reuses the same picker + matchAndPacket flow the per-row Generate
    // buttons above use, keeping behavior identical to the main Violations tab.
    openPacketPicker(matchedRentalId);
  };

  const openCreateNewRental = () => {
    setNewRenter("");
    setNewPhone("");
    setNewEmail("");
    setNewPlate(item.plate ?? "");
    setNewStart((item.violation_date ?? "").slice(0, 10));
    setNewEnd((item.violation_date ?? "").slice(0, 10));
    setCreateOpen(true);
  };

  const submitCreateNewRental = async () => {
    if (!newRenter.trim()) {
      toast.error("Enter the renter name");
      return;
    }
    if (!newStart) {
      toast.error("Enter a start date");
      return;
    }
    setBusy(true);
    try {
      const { rentalId } = await createInternal({
        data: {
          itemId: item.id,
          renterName: newRenter.trim(),
          phone: newPhone.trim() || null,
          email: newEmail.trim() || null,
          plate: newPlate.trim() || null,
          startDate: newStart,
          endDate: newEnd || null,
        },
      });
      // Auto-commit through the same matchCommit path other flows use.
      await matchCommit({ data: { itemId: item.id, rentalId } });
      setMatchedRentalId(rentalId);
      setCreateOpen(false);
      toast.success("Internal rental created and matched");
      onMatched();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create internal rental");
    } finally {
      setBusy(false);
    }
  };

  const confirmDismiss = async () => {
    setBusy(true);
    try {
      await dismiss({ data: { itemId: item.id } });
      toast.success("Marked plate as not ours — removed from queue");
      setDismissOpen(false);
      onMatched();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to dismiss");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manual Match</DialogTitle>
          <DialogDescription>
            {fmtDate(item.violation_date)} · Plate {item.plate || "—"} · {item.location || "—"} ·{" "}
            {fmtMoney(Number(item.amount))}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={openCreateNewRental}
          >
            <FilePlus2 className="mr-1 h-4 w-4" /> Create New Rental
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setDismissOpen(true)}
          >
            <Ban className="mr-1 h-4 w-4" /> Plate Not Mine
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !matchedRentalId}
            onClick={generateDisputePacket}
            title={matchedRentalId ? "Build a dispute packet ZIP for the matched rental" : "Match a rental first"}
          >
            <ShieldX className="mr-1 h-4 w-4" /> Generate Dispute Packet
          </Button>
        </div>

        {/* Full search: date OR plate OR customer name */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="License plate"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name / phone"
          />
        </div>
        <Button
          size="sm"
          onClick={() => refetch()}
          disabled={busy || isFetching}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Search className="mr-1 h-4 w-4" /> Search rentals
        </Button>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {isFetching ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Searching…</p>
          ) : error ? (
            <p className="py-4 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : "Search failed"}
            </p>
          ) : sorted.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No rentals found. Adjust the date, plate, or name and search again.
            </p>
          ) : (
            <>
            <p className="px-1 text-xs text-muted-foreground">
              Showing all {sorted.length} rental{sorted.length === 1 ? "" : "s"} on this plate — date
              matches first. Pick the correct one.
            </p>
            {sorted.map((r) => (
              <div
                key={`${r.source}-${r.id}`}
                className="flex flex-col gap-2 rounded-md border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.customerName}</span>
                      <Badge variant={r.isMigration ? "secondary" : "default"} className="text-[10px]">
                        {r.isMigration ? "Legacy" : "Live"}
                      </Badge>
                      {r.hasAgreement ? (
                        <Badge className="bg-emerald-600 text-[10px]">Agreement on file</Badge>
                      ) : null}
                      {r._coversDate ? (
                        <Badge className="bg-emerald-600 text-[10px]">✅ Covers toll date</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Different period
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.vehicleLabel}
                      {r.plate ? ` · ${r.plate}` : ""} · {r.phone || "no phone"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : "ongoing"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {r.isMigration ? (
                      r.hasAgreement ? (
                        <Badge variant="secondary">Signed</Badge>
                      ) : r.retroSentAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => startRetro(r)}
                        >
                          <Send className="mr-1 h-4 w-4" /> Resend Agreement
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => startRetro(r)}
                        >
                          <Send className="mr-1 h-4 w-4" /> Send Agreement
                        </Button>
                      )
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        {r.hasAgreement ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => openPacketPicker(r.id)}
                              className="bg-emerald-600 hover:bg-emerald-700"
                            >
                              <ShieldX className="mr-1 h-4 w-4" />
                              Match + Dispute Packet
                            </Button>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => downloadAgreement(r.id)}
                              >
                                <Download className="mr-1 h-4 w-4" />
                                Agreement
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => confirm(r.id)}
                              >
                                Match only
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => confirm(r.id)}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            Match
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {retroFor && retroFor.id === r.id && (
                  <div className="space-y-2 rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">
                      Text a retroactive rental agreement to this customer. Once signed, the rental
                      becomes matchable here.
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={retroPhone}
                        onChange={(e) => setRetroPhone(e.target.value)}
                        placeholder="Phone (required)"
                      />
                      <Input
                        value={retroEmail}
                        onChange={(e) => setRetroEmail(e.target.value)}
                        placeholder="Email (optional)"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRetroFor(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitRetro}
                        disabled={busy}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                        Send
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={packetFor !== null} onOpenChange={(o) => !o && !busy && setPacketFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Dispute packet — include which docs?</DialogTitle>
            <DialogDescription>
              Pick the documents to bundle into the ZIP. Any item not on file will
              be listed in MISSING.txt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={inc.coverLetter}
                onCheckedChange={(v) => setInc((s) => ({ ...s, coverLetter: v === true }))}
              />
              Dispute cover letter
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={inc.agreement}
                onCheckedChange={(v) => setInc((s) => ({ ...s, agreement: v === true }))}
              />
              Signed rental agreement
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={inc.license}
                onCheckedChange={(v) => setInc((s) => ({ ...s, license: v === true }))}
              />
              Driver's license
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPacketFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={busy || (!inc.coverLetter && !inc.agreement && !inc.license)}
              onClick={() => packetFor && matchAndPacket(packetFor)}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              Create ticket + download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create New Rental — minimal on-file rental so a ticket with no
          live reservation can still be attributed and disputed. */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && !busy && setCreateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create internal rental</DialogTitle>
            <DialogDescription>
              Creates an on-file rental for this plate + date so the ticket can
              be matched and a dispute packet generated. You can fill in full
              renter details later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={newRenter}
              onChange={(e) => setNewRenter(e.target.value)}
              placeholder="Renter full name (required)"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone"
              />
              <Input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email"
              />
            </div>
            <Input
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="License plate"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Start date</label>
                <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End date</label>
                <Input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={submitCreateNewRental}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-1 h-4 w-4" />}
              Create + Match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plate Not Mine — dismiss the batch item so it drops out of the queue. */}
      <Dialog open={dismissOpen} onOpenChange={(o) => !o && !busy && setDismissOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark plate as not ours?</DialogTitle>
            <DialogDescription>
              Removes this ticket from the review queue. The record is kept for
              audit but stops appearing in matched / unmatched counts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDismissOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDismiss}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Ban className="mr-1 h-4 w-4" />}
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
