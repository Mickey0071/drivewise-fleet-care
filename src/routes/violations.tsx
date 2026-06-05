import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, AlertTriangle, FileUp } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listViolations,
  lookupRentalByPlate,
  createViolation,
  chargeViolationRecord,
  markViolationDisputed,
  markViolationPaidManually,
  type ViolationRow,
} from "@/lib/violations.functions";
import { listRentalsForViolation } from "@/lib/violations.functions";
import {
  changeViolationStatus,
  listViolationHistory,
  type ViolationHistoryRow,
} from "@/lib/violations.functions";
import { sendViolationToCustomer } from "@/lib/violations.functions";
import { downloadViolationPacket } from "@/lib/violation-packet.functions";
import { analyzeViolationPhoto } from "@/lib/violation-photo.functions";
import { CameraCaptureDialog } from "@/components/app/CameraCaptureDialog";

function DownloadPacketButton({ violationId }: { violationId: string }) {
  const dl = useServerFn(downloadViolationPacket);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      const res = await dl({ data: { violationId } });
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
      if (res.missing.length) {
        toast.message(`Packet downloaded — ${res.missing.length} item(s) missing`, {
          description: res.missing.join(", "),
        });
      } else {
        toast.success("Packet downloaded");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={handle} disabled={busy} className="ml-2">
      {busy ? "Building…" : "📥 Packet"}
    </Button>
  );
}

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "Violations — Camauto Rentals" }] }),
  component: ViolationsPage,
});

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

type Filter =
  | "all"
  | "pending_response"
  | "paid"
  | "affidavit_signed"
  | "submitted"
  | "resolved";

const PENDING_RESPONSE = ["pending", "failed", "sent_to_customer", "viewing"];

function ViolationsPage() {
  const list = useServerFn(listViolations);
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["violations"],
    queryFn: () => list(),
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [chargeFor, setChargeFor] = useState<ViolationRow | null>(null);
  const [statusFor, setStatusFor] = useState<ViolationRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "unpaid" && !(r.status === "pending" || r.status === "failed")) return false;
      if (filter === "paid" && r.status !== "paid") return false;
      if (filter === "disputed" && r.status !== "disputed") return false;
      if (!q) return true;
      const hay = [
        r.id,
        r.license_plate,
        r.rental_id,
        r.driver_name,
        r.vehicle_label,
        r.date_issued,
        r.type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter, search]);

  const unpaidCount = rows.filter((r) => r.status === "pending" || r.status === "failed").length;
  const unpaidTotal = rows
    .filter((r) => r.status === "pending" || r.status === "failed")
    .reduce((s, r) => s + Number(r.total_amount || r.amount || 0), 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["violations"] });

  return (
    <div>
      <PageHeader
        title="Violations"
        subtitle={`${rows.length} on record`}
        action={
          <div className="flex items-center gap-2">
            {unpaidCount > 0 && (
              <Badge variant="destructive" className="h-7 px-2 text-xs">
                {unpaidCount} unpaid · {fmtMoney(unpaidTotal)}
              </Badge>
            )}
            <Button variant="outline" asChild>
              <Link to="/violations/bulk-upload">
                <FileUp className="mr-1 h-4 w-4" /> Bulk Upload EZPass
              </Link>
            </Button>
            <Button onClick={() => setNewOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-1 h-4 w-4" /> New Violation
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unpaid">Unpaid</TabsTrigger>
              <TabsTrigger value="paid">Paid</TabsTrigger>
              <TabsTrigger value="disputed">Disputed</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by plate, rental, customer, date…"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No violations match.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">ID</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{v.id}</td>
                      <td className="p-3">{fmtDate(v.date_issued)}</td>
                      <td className="p-3 capitalize">{v.type}</td>
                      <td className="p-3">
                        {v.vehicle_label || v.license_plate || "—"}
                      </td>
                      <td className="p-3">
                        {v.driver_name || "—"}
                        {v.rental_id && (
                          <div className="text-xs text-muted-foreground">{v.rental_id}</div>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {fmtMoney(Number(v.total_amount || v.amount))}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={v.status} />
                        {v.status === "paid" && v.paid_at && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            ✓ {new Date(v.paid_at).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {(v.status === "pending" || v.status === "failed") && v.rental_id && (
                          <Button size="sm" variant="outline" onClick={() => setChargeFor(v)}>
                            Charge
                          </Button>
                        )}
                        {v.payment_link_url && v.status === "pending" && (
                          <a
                            href={v.payment_link_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 text-xs text-primary underline"
                          >
                            Link
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2"
                          onClick={() => setStatusFor(v)}
                        >
                          Change Status
                        </Button>
                        <DownloadPacketButton violationId={v.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewViolationDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(created) => {
        refresh();
        setNewOpen(false);
        setChargeFor(created);
      }} />

      <ChargeDialog
        violation={chargeFor}
        onClose={() => setChargeFor(null)}
        onDone={() => {
          refresh();
          setChargeFor(null);
        }}
      />

      <ChangeStatusDialog
        violation={statusFor}
        onClose={() => setStatusFor(null)}
        onDone={() => {
          refresh();
        }}
      />
    </div>
  );
}

function NewViolationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onCreated: (v: ViolationRow) => void;
}) {
  const lookup = useServerFn(lookupRentalByPlate);
  const create = useServerFn(createViolation);
  const analyze = useServerFn(analyzeViolationPhoto);
  const listRentals = useServerFn(listRentalsForViolation);

  const { data: rentalOptions = [] } = useQuery({
    queryKey: ["rentals-for-violation"],
    queryFn: () => listRentals(),
    enabled: open,
  });
  const [selectedRentalId, setSelectedRentalId] = useState<string>("");

  const [type, setType] = useState<"toll" | "parking" | "damage" | "traffic" | "other">("toll");
  const [plate, setPlate] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tollAmount, setTollAmount] = useState("");
  const [tollFee, setTollFee] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [location, setLocation] = useState("");
  const [lookupResult, setLookupResult] = useState<Awaited<ReturnType<typeof lookup>> | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thumbnail, setThumbnail] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pdfPages, setPdfPages] = useState<{
    renderPage: (n: number) => Promise<string>;
    pageCount: number;
  } | null>(null);

  const reset = () => {
    setType("toll");
    setPlate("");
    setDate(new Date().toISOString().slice(0, 10));
    setTollAmount("");
    setTollFee("");
    setDescription("");
    setPhotoUrl("");
    setLocation("");
    setLookupResult(null);
    setThumbnail("");
    setConfidence(null);
    setPdfPages(null);
    setSelectedRentalId("");
  };

  const analyzeDataUrl = async (dataUrl: string) => {
    setThumbnail(dataUrl);
    setAnalyzing(true);
    setConfidence(null);
    try {
      const res = await analyze({ data: { dataUrl } });
      setPhotoUrl(res.photoUrl);
      const ex = res.extraction;
      setConfidence(ex.confidence);
      let plateForLookup = "";
      let dateForLookup = "";
      if (ex.confidence >= 70) {
        if (ex.license_plate) {
          // strip leading state abbrev like "NJ "
          const cleaned = ex.license_plate.replace(/^[A-Z]{2}\s+/, "").toUpperCase();
          setPlate(cleaned);
          plateForLookup = cleaned;
        }
        if (ex.violation_date) {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ex.violation_date);
          if (m) {
            const [, mo, d, y] = m;
            dateForLookup = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
            setDate(dateForLookup);
          }
        }
        if (ex.location) setLocation(ex.location);
        if (ex.toll_amount != null) setTollAmount(String(ex.toll_amount));
        if (ex.fee_amount != null) setTollFee(String(ex.fee_amount));
        if (ex.violation_type) setType(ex.violation_type);
        toast.success(`Extracted with ${ex.confidence}% confidence`);
        // Auto-match renter by plate + date as soon as we have both
        if (plateForLookup) {
          await doLookup(plateForLookup, dateForLookup || date);
        }
      } else {
        toast.message("Couldn't read clearly — please enter manually", {
          description: `Confidence ${ex.confidence}%`,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const usePdfPage = async (pageNumber: number) => {
    if (!pdfPages) return;
    setAnalyzing(true);
    try {
      const dataUrl = await pdfPages.renderPage(pageNumber);
      setPdfPages(null);
      await analyzeDataUrl(dataUrl);
    } catch (e) {
      setAnalyzing(false);
      toast.error(e instanceof Error ? e.message : "Could not read PDF page");
    }
  };

  const handlePhoto = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isImage && !isPdf) {
      toast.error("Please upload a JPG, PNG, or PDF file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    setPdfPages(null);
    if (isPdf) {
      try {
        const { loadPdf } = await import("@/lib/pdf-to-image");
        const pdf = await loadPdf(file);
        if (pdf.pageCount > 1) {
          setPdfPages(pdf);
          toast.message("Multi-page document", {
            description: `${pdf.pageCount} pages found. Using the first page unless you choose another.`,
          });
          return;
        }
        const dataUrl = await pdf.renderPage(1);
        await analyzeDataUrl(dataUrl);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not read PDF");
      }
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Read failed"));
      r.readAsDataURL(file);
    });
    await analyzeDataUrl(dataUrl);
  };

  const doLookup = async (plateArg?: string, dateArg?: string) => {
    const p = (plateArg ?? plate).trim();
    const d = dateArg ?? date;
    if (!p || !d) return;
    setLookingUp(true);
    try {
      const r = await lookup({ data: { plate: p, date: d } });
      setLookupResult(r);
      if (r.found && !r.ambiguous) {
        // Exactly one rental → auto-select renter
        setSelectedRentalId(r.matches[0].rental.id);
      } else {
        setSelectedRentalId("");
      }
      if (!r.vehicleFound) toast.message("Vehicle not in fleet or OCR failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async () => {
    const amt = parseFloat(tollAmount || "0");
    const fee = parseFloat(tollFee || "0");
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const picked = selectedRentalId
      ? rentalOptions.find((r) => r.id === selectedRentalId) ?? null
      : null;
    const fallbackVehicleId = lookupResult?.vehicle?.id ?? null;
    setSaving(true);
    try {
      const r = await create({
        data: {
          type,
          date,
          licensePlate: plate || null,
          amount: amt,
          fee,
          description:
            description ||
            `${type} violation${plate ? ` on ${plate.toUpperCase()}` : ""}${location ? ` at ${location}` : ""}`,
          photoUrl: photoUrl || null,
          rentalId: picked ? picked.id : null,
          vehicleId: picked ? picked.vehicle_id : fallbackVehicleId,
          driverId: picked ? picked.driver_id : null,
          extractedConfidence: confidence,
        },
      });
      toast.success(`Created ${r.violation.id}`);
      reset();
      onCreated(r.violation);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) reset(); onOpenChange(b); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Violation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Photo, scan, or PDF of a toll bill, parking ticket, or violation notice
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={() => setCameraOpen(true)}
              >
                📱 Take Photo with Camera
              </Button>
              <label className="flex-1">
                <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
                  📤 Upload from Files
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handlePhoto(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <CameraCaptureDialog
              open={cameraOpen}
              onOpenChange={setCameraOpen}
              onCapture={(f) => void handlePhoto(f)}
            />
            {pdfPages && (
              <div className="mt-3 rounded-md border bg-background p-3 text-xs">
                <div className="mb-2 font-medium">
                  This is a multi-page document ({pdfPages.pageCount} pages). Use the first page?
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={analyzing} onClick={() => void usePdfPage(1)}>
                    Use First Page
                  </Button>
                  <span className="text-muted-foreground">or choose a page:</span>
                  <Select onValueChange={(v) => void usePdfPage(Number(v))}>
                    <SelectTrigger className="h-8 w-28"><SelectValue placeholder="Page…" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: pdfPages.pageCount }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>Page {n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {thumbnail && (
              <div className="mt-3 flex items-start gap-3">
                <img src={thumbnail} alt="Violation" className="h-20 w-20 rounded border object-cover" />
                <div className="flex-1 text-xs">
                  {analyzing && <div className="text-muted-foreground">Analyzing photo…</div>}
                  {!analyzing && confidence !== null && confidence >= 70 && (
                    <div className="text-emerald-700 dark:text-emerald-400">
                      ✓ Extracted with {confidence}% confidence
                    </div>
                  )}
                  {!analyzing && confidence !== null && confidence < 70 && (
                    <div className="text-amber-600">
                      ⚠️ Could not read clearly ({confidence}%). Please enter manually or try a different photo.
                    </div>
                  )}
                  {!analyzing && confidence === null && (
                    <div className="text-emerald-700 dark:text-emerald-400">✓ File ready.</div>
                  )}
                  <label className="mt-1 inline-block">
                    <span className="cursor-pointer text-primary underline-offset-2 hover:underline">Change file</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePhoto(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="toll">Toll Plate</SelectItem>
                <SelectItem value="parking">Parking</SelectItem>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="traffic">Traffic</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>License Plate</Label>
              <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="ABC1234" />
            </div>
            <div>
              <Label>Violation Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{type === "toll" ? "Toll Amount" : "Amount"} ($)</Label>
              <Input type="number" step="0.01" value={tollAmount} onChange={(e) => setTollAmount(e.target.value)} />
            </div>
            <div>
              <Label>Fee ($)</Label>
              <Input type="number" step="0.01" value={tollFee} onChange={(e) => setTollFee(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Description / Notes</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div>
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Toll plaza, street, or place of violation"
            />
          </div>

          <div>
            <Label>Photo URL (optional)</Label>
            <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>Renter Match</Label>
              {lookupResult && (
                <Badge
                  variant={lookupResult.matchConfidence >= 90 ? "default" : "secondary"}
                  className="text-xs"
                >
                  Match confidence: {lookupResult.matchConfidence}%
                </Badge>
              )}
            </div>
            {lookupResult && (
              <div
                className={`mb-3 rounded-md p-2 text-xs ${
                  !lookupResult.vehicleFound
                    ? "bg-destructive/10 text-destructive"
                    : lookupResult.matchConfidence >= 90
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-500"
                }`}
              >
                {!lookupResult.vehicleFound
                  ? "Vehicle not in fleet or OCR failed — enter plate / select renter manually."
                  : lookupResult.matchConfidence >= 90
                    ? `${lookupResult.confidenceLabel} — renter auto-selected.`
                    : `Low confidence — ${lookupResult.confidenceLabel}. Verify renter.`}
              </div>
            )}
            <Select
              value={selectedRentalId}
              onValueChange={(v) => {
                setSelectedRentalId(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a rental…" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  // When the lookup found overlapping rentals, narrow the list to those.
                  const matchIds = lookupResult?.matches?.map((m) => m.rental.id) ?? [];
                  const opts =
                    matchIds.length > 0
                      ? rentalOptions.filter((r) => matchIds.includes(r.id))
                      : rentalOptions;
                  if (opts.length === 0) {
                    return (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No rentals found</div>
                    );
                  }
                  return opts.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.id}: {r.driver_name ?? "Unknown"}
                      {r.plate ? ` — ${r.plate}` : ""}
                    </SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>
            {selectedRentalId && (() => {
              const picked = rentalOptions.find((r) => r.id === selectedRentalId);
              if (!picked) return null;
              return (
                <div className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                  Selected <strong>{picked.id}</strong> — {picked.driver_name ?? "Unknown driver"}
                  <div className="text-xs text-muted-foreground">
                    {picked.vehicle_label ?? picked.plate ?? ""} · {picked.start_date} → {picked.end_date || "ongoing"}
                  </div>
                </div>
              );
            })()}
            <div className="my-3 border-t" />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void doLookup()}
                disabled={!plate || !date || lookingUp}
              >
                {lookingUp ? "Looking up…" : "Lookup Rental"}
              </Button>
              <span className="text-xs text-muted-foreground">Match plate + date automatically</span>
            </div>
            {lookupResult && lookupResult.vehicleFound && !lookupResult.found && (
              <div className="mt-2 text-sm text-amber-600">
                {lookupResult.reason || "No rental matched. Violation will be unlinked."}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add Violation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const charge = useServerFn(chargeViolationRecord);
  const dispute = useServerFn(markViolationDisputed);
  const markPaid = useServerFn(markViolationPaidManually);
  const m = useMutation({
    mutationFn: async (mode: "auto" | "link") =>
      charge({ data: { id: violation!.id, mode } }),
    onSuccess: (res) => {
      if (res.mode === "link") {
        toast.success("Payment link sent to renter");
      } else {
        toast.success("Card charged successfully");
      }
      onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Charge failed"),
  });

  if (!violation) return null;
  const amt = Number(violation.total_amount || violation.amount);

  return (
    <Dialog open={!!violation} onOpenChange={(b) => { if (!b) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Charge Violation — {fmtMoney(amt)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div><strong>{violation.id}</strong> · {violation.type}</div>
            <div className="text-xs text-muted-foreground">
              {violation.driver_name || "—"} · {violation.vehicle_label || violation.license_plate || "—"}
            </div>
            {violation.description && (
              <div className="mt-1 text-xs">{violation.description}</div>
            )}
          </div>
          <p className="text-sm">How do you want to charge?</p>
          <div className="grid gap-2">
            <Button
              onClick={() => m.mutate("auto")}
              disabled={m.isPending}
            >
              Auto-Charge Card on File
            </Button>
            <Button
              variant="outline"
              onClick={() => m.mutate("link")}
              disabled={m.isPending}
            >
              Send Payment Link (SMS + Email)
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await markPaid({ data: { id: violation.id, method: "manual" } });
                  toast.success("Marked paid");
                  onDone();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={m.isPending}
            >
              Mark Paid (manual)
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await dispute({ data: { id: violation.id } });
                  toast.success("Marked disputed");
                  onDone();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={m.isPending}
            >
              Mark Disputed
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Unpaid (Pending)" },
  { value: "paid", label: "Paid" },
  { value: "disputed", label: "Disputed" },
  { value: "failed", label: "Failed" },
];

const statusLabel = (s: string | null) =>
  STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s ?? "—";

function ChangeStatusDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const change = useServerFn(changeViolationStatus);
  const history = useServerFn(listViolationHistory);
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ["violation-history", violation?.id],
    queryFn: () => history({ data: { id: violation!.id } }),
    enabled: !!violation,
  });

  if (!violation) return null;

  const submit = async () => {
    if (!status) {
      toast.error("Pick a new status");
      return;
    }
    setSaving(true);
    try {
      await change({ data: { id: violation.id, status, reason } });
      toast.success(`Status changed to ${statusLabel(status)}`);
      setReason("");
      setStatus("");
      qc.invalidateQueries({ queryKey: ["violation-history", violation.id] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!violation} onOpenChange={(b) => { if (!b) { setReason(""); setStatus(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Status — {violation.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Current:</span>
            <StatusBadge status={violation.status} />
          </div>

          <div>
            <Label>New status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status…" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.filter((o) => o.value !== violation.status).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is the status changing?"
            />
          </div>

          <div>
            <Label className="mb-2 block">Timeline</Label>
            {loadingTimeline ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : timeline.length === 0 ? (
              <div className="text-xs text-muted-foreground">No status changes yet.</div>
            ) : (
              <ol className="space-y-2 border-l pl-4">
                {timeline.map((h: ViolationHistoryRow) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{statusLabel(h.from_status)}</span>
                      <span>→</span>
                      <StatusBadge status={h.to_status} />
                    </div>
                    {h.reason && <div className="mt-0.5 text-xs">{h.reason}</div>}
                    <div className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                      {h.changed_by_name ? ` · ${h.changed_by_name}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setReason(""); setStatus(""); onClose(); }}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !status}>
            {saving ? "Saving…" : "Save Change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
