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
  type EzpassBatchItem,
} from "@/lib/ezpass.functions";
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

  const items = data?.items ?? [];
  const batch = data?.batch;
  const matchedCount = items.filter((i) => i.match_status === "matched").length;
  const unmatchedCount = items.length - matchedCount;
  const totalAmount = useMemo(
    () => items.reduce((s, i) => s + Number(i.amount || 0), 0),
    [items],
  );
  const approved = batch?.status === "approved";

  const refresh = () => qc.invalidateQueries({ queryKey: ["ezpass-batch", batchId] });

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await approve({ data: { batchId } });
      toast.success(`Generated ${res.generated} liability-transfer letter${res.generated === 1 ? "" : "s"}`);
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
        <SummaryCard label="Total violations" value={String(items.length)} />
        <SummaryCard label="Auto-matched" value={String(matchedCount)} tone="ok" />
        <SummaryCard label="Unmatched" value={String(unmatchedCount)} tone={unmatchedCount ? "warn" : "ok"} />
        <SummaryCard label="Total amount" value={fmtMoney(totalAmount)} />
      </div>

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
                    <th className="p-3">Toll Location</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Renter</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        {fmtDate(it.violation_date)}
                        {it.violation_time ? (
                          <span className="ml-1 text-xs text-muted-foreground">{it.violation_time}</span>
                        ) : null}
                      </td>
                      <td className="p-3 font-mono text-xs">{it.plate || "—"}</td>
                      <td className="p-3">{it.location || "—"}</td>
                      <td className="p-3 text-right">{fmtMoney(Number(it.amount))}</td>
                      <td className="p-3">{it.driver_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">
                        {it.match_status === "matched" ? (
                          <Badge className="bg-emerald-600">✅ Matched</Badge>
                        ) : it.match_status === "multiple" ? (
                          <Badge variant="secondary">⚠️ Multiple</Badge>
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
                            {it.match_status === "matched" ? "Edit Match" : "Manual Match"}
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
                Resolve all {unmatchedCount} unmatched violation(s) to continue.
              </p>
            )}
            <Button
              size="lg"
              disabled={unmatchedCount > 0 || items.length === 0}
              onClick={() => setConfirmOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-2 h-5 w-5" /> Approve & Generate PDFs
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
            <DialogTitle>Generate liability-transfer letters?</DialogTitle>
            <DialogDescription>
              You're about to generate {items.length} liability-transfer letter{items.length === 1 ? "" : "s"} and
              prepare them for review. Each PDF will be pre-filled with customer and violation details.
              Continue?
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
  const search = useServerFn(searchRentalsForMatch);
  const match = useServerFn(manualMatchEzpassItem);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const doSearch = useCallback(
    (query: string) => search({ data: { query } }),
    [search],
  );
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["ezpass-match-search", q],
    queryFn: () => doSearch(q),
  });

  const candidates = item.candidates ?? [];

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual Match</DialogTitle>
          <DialogDescription>
            {fmtDate(item.violation_date)} · Plate {item.plate || "—"} · {item.location || "—"} ·{" "}
            {fmtMoney(Number(item.amount))}
          </DialogDescription>
        </DialogHeader>

        {candidates.length > 0 && (
          <div className="mb-2">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Overlapping rentals
            </p>
            <div className="space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.rental_id}
                  disabled={busy}
                  onClick={() => confirm(c.rental_id)}
                  className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted/50"
                >
                  <span>{c.driver_name || "Unknown renter"}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(c.start_date)} → {c.end_date ? fmtDate(c.end_date) : "ongoing"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer name or phone…"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {isFetching ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {q ? "No rentals found." : "Type to search rental history."}
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.rental_id}
                disabled={busy}
                onClick={() => confirm(r.rental_id)}
                className="flex w-full flex-col rounded-md border p-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{r.driver_name || "Unknown renter"}</span>
                <span className="text-xs text-muted-foreground">
                  {r.vehicle_label || "—"} · {r.phone || "no phone"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : "ongoing"}
                </span>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
