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
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  searchRentalsForMatch,
  manualMatchEzpassItem,
  approveEzpassBatch,
  downloadAffidavitsZip,
  type EzpassBatchItem,
} from "@/lib/ezpass.functions";
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
        const pageCount = Math.min(pdf.pageCount, 20);
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
        subtitle="Upload statement → System extracts → Match renters → Generate affidavits"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />

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
    </div>
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
      toast.success(`Generated ${res.generated} affidavit PDF${res.generated === 1 ? "" : "s"}`);
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
                              Affidavit
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

      <div className="mt-6 flex items-center justify-end gap-3">
        {approved ? (
          <Button onClick={handleZip} className="bg-emerald-600 hover:bg-emerald-700">
            <Download className="mr-2 h-4 w-4" /> Download All Affidavits
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
            <DialogTitle>Generate affidavit PDFs?</DialogTitle>
            <DialogDescription>
              You're about to generate {items.length} affidavit PDF{items.length === 1 ? "" : "s"} and
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
