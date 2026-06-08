import { createFileRoute, useRouter } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicles, vehicleById, driverById, payments, violations, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, updateRental, getInspectionsForRental, addInspection, addMaintenance, extendRental, computeExtensionCharge, prunePendingReservations, pendingExpiresAt, cancelReservation, captureSignature, markReservationPaid, ensureRentalSynced, currentPeriodPaid, isVehicleBookable, swapVehicle, refreshStoreFromCloud, syncLocalReturn } from "@/lib/mock/store";
import { calcCurrentPeriodEnd } from "@/lib/mock/store";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useEffect, useRef, useState } from "react";
import { Car, Truck, ClipboardCheck, CheckCircle2, CalendarPlus, FileSignature, Clock, DollarSign, X as XIcon, MessageSquare, Printer, Send, PackageCheck, ListChecks, Mail, Copy, ChevronDown, ArrowLeftRight, Undo2, Ban, Download, Smartphone } from "lucide-react";
import { Search as SearchIcon, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { LayoutDashboard } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SignaturePad } from "@/components/app/SignaturePad";
import logoUrl from "@/assets/camauto-logo-full.jpeg";
import { StripeRentalCheckout } from "@/components/StripeEmbeddedCheckout";
import { NotifyRenterDialog } from "@/components/app/NotifyRenterDialog";
import { SendPaymentLinkDialog } from "@/components/app/SendPaymentLinkDialog";
import { AddCardDialog } from "@/components/app/AddCardDialog";
import { RecordCashDialog } from "@/components/app/RecordCashDialog";
import { ChargeCardDialog } from "@/components/app/ChargeCardDialog";
import { RecordPaymentDialog } from "@/components/app/RecordPaymentDialog";
import { getSavedCard } from "@/lib/card-display";
import { ReturnVehicleDialog } from "@/components/app/ReturnVehicleDialog";
import { ReservationPaymentHistory } from "@/components/app/ReservationPaymentHistory";
import { ReservationDocuments } from "@/components/app/ReservationDocuments";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendRentalSms } from "@/lib/rental-sms.functions";
import { chargeViolation } from "@/lib/violation-charge.functions";
import { useAgreementSettings } from "@/lib/agreementSettings";
import { sendSigningLink, getSigningLink } from "@/lib/sign.functions";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";
import { generateReceiptPdf } from "@/lib/receipt.functions";
import { downloadClientPacket } from "@/lib/client-packet.functions";
import { sendPortalLink } from "@/lib/portal-link.functions";
import { closeoutRental } from "@/lib/return.functions";
import { createExtensionLink } from "@/lib/extension-link.functions";
import { toast } from "sonner";
import type { Rental } from "@/lib/mock/data";

const getPublicAppOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

type StatusFilter = "on_rent" | "all" | "pending" | "returned" | "cancelled";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Reservations — Camauto Rentals" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    paid: typeof search.paid === "string" ? search.paid : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    review: typeof search.review === "string" ? search.review : undefined,
    detail: typeof search.detail === "string" ? search.detail : undefined,
    status: ["on_rent", "all", "pending", "returned", "cancelled"].includes(search.status as string)
      ? (search.status as StatusFilter)
      : "on_rent",
  }),
  component: RentalsPage,
});

const AGREEMENT_VERSION = "v1.0";

const FILTER_LABELS: Record<StatusFilter, string> = {
  on_rent: "On Rent",
  all: "All",
  pending: "Pending",
  returned: "Returned",
  cancelled: "Cancelled",
};

function statusFilterMatches(r: Rental, filter: StatusFilter): boolean {
  const rs = r.reservationStatus ?? "active";
  switch (filter) {
    case "on_rent": return rs === "active";
    case "pending": return rs === "pending";
    case "returned": return rs === "returned" || rs === "completed";
    case "cancelled": return rs === "cancelled";
    case "all": return true;
    default: return true;
  }
}

function RentalsPage() {
  const navigate = Route.useNavigate();
  const { paid, review, detail: detailId, status } = Route.useSearch();
  const [detail, setDetail] = useState<Rental | null>(null);
  const { user, role } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Rental | null>(null);
  const [delivering, setDelivering] = useState<Rental | null>(null);
  const [returning, setReturning] = useState<Rental | null>(null);
  const [extending, setExtending] = useState<Rental | null>(null);
  const [swapping, setSwapping] = useState<Rental | null>(null);
  const [stoppingAutoBill, setStoppingAutoBill] = useState<Rental | null>(null);
  
  const [signing, setSigning] = useState<Rental | null>(null);
  const [returnChoiceRental, setReturnChoiceRental] = useState<Rental | null>(null);
  const [charging, setCharging] = useState<Rental | null>(null);
  const [violationFor, setViolationFor] = useState<Rental | null>(null);
  
  const [chatting, setChatting] = useState<Rental | null>(null);
  // (Mark as Returned now opens the full Return Inspection dialog directly.)
  const sendSmsFn = useServerFn(sendRentalSms);
  const sendSignLinkFn = useServerFn(sendSigningLink);
  const getSignLinkFn = useServerFn(getSigningLink);
  const [payLinkRental, setPayLinkRental] = useState<Rental | null>(null);
  const [addCardRental, setAddCardRental] = useState<Rental | null>(null);
  const [cashRental, setCashRental] = useState<Rental | null>(null);
  const [chargeCardRental, setChargeCardRental] = useState<Rental | null>(null);
  const [recordPayRental, setRecordPayRental] = useState<Rental | null>(null);
  const sendPortalLinkFn = useServerFn(sendPortalLink);
  const [portalLinkSendingId, setPortalLinkSendingId] = useState<string | null>(null);
  const genPdfFn = useServerFn(generateAgreementPdf);
  const [pdfRegenId, setPdfRegenId] = useState<string | null>(null);
  const genReceiptFn = useServerFn(generateReceiptPdf);
  const [receiptRegenId, setReceiptRegenId] = useState<string | null>(null);
  const downloadPacketFn = useServerFn(downloadClientPacket);
  const [packetDownloadingId, setPacketDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"id" | "name" | "vehicle" | "start" | "end" | "status" | "balance">("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  useStoreVersion();
  // Notify staff when a remote signature arrives (via realtime) and the
  // reservation flips from pending → active.
  const seenSignedRef = useRef<Set<string>>(new Set());
  const seenSignedInitRef = useRef(false);
  useEffect(() => {
    // On the first run, seed all current keys so we never toast for
    // reservations that were already signed before this page mounted.
    if (!seenSignedInitRef.current) {
      for (const r of rentals) {
        seenSignedRef.current.add(
          `${r.id}:${r.signatureDataUrl ? 1 : 0}:${r.reservationStatus ?? "active"}`,
        );
      }
      seenSignedInitRef.current = true;
      return;
    }
    for (const r of rentals) {
      const key = `${r.id}:${r.signatureDataUrl ? 1 : 0}:${r.reservationStatus ?? "active"}`;
      if (seenSignedRef.current.has(key)) continue;
      seenSignedRef.current.add(key);
      if (r.signatureDataUrl && r.reservationStatus === "active") {
        const d = driverById(r.driverId);
        const v = vehicleById(r.vehicleId);
        toast.success("Renter signed — moved to On Rent", {
          description: `${d?.fullName ?? r.driverId} · ${v?.year} ${v?.make} ${v?.model}`,
        });
      } else if (r.signatureDataUrl && r.reservationStatus === "pending") {
        const d = driverById(r.driverId);
        toast.success(`Signature received from ${d?.fullName ?? r.driverId}`, {
          description: "Waiting on payment to activate.",
        });
      }
    }
  }, [rentals]);
  // Auto-open detail dialog when navigated with ?detail=reservationId
  useEffect(() => {
    if (detailId && !detail) {
      const r = rentals.find(x => x.id === detailId) ?? null;
      if (r) setDetail(r);
    }
    if (!detailId && detail) {
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);
  // Prune any pending reservations whose 24h hold has expired,
  // and warn once when a hold drops below 2 hours remaining.
  useEffect(() => {
    const warned = new Set<string>();
    function tick() {
      prunePendingReservations();
      const now = Date.now();
      for (const r of rentals) {
        if (r.reservationStatus !== "pending") continue;
        const exp = pendingExpiresAt(r);
        if (!exp) continue;
        const remaining = exp - now;
        if (remaining > 0 && remaining < 2 * 3_600_000 && !warned.has(r.id)) {
          warned.add(r.id);
          const d = driverById(r.driverId);
          const v = vehicleById(r.vehicleId);
          const mins = Math.max(1, Math.floor(remaining / 60_000));
          toast.warning(`Hold expiring in ${mins}m`, {
            description: `${v?.year} ${v?.make} ${v?.model} · ${d?.fullName ?? r.driverId}`,
          });
        }
      }
    }
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  // After Stripe redirect: mark reservation paid and clear query params
  useEffect(() => {
    if (!paid) return;
    const activated = markReservationPaid(paid);
    toast.success(activated ? "Payment received — reservation activated" : "Payment received");
    navigate({ to: "/rentals", search: {}, replace: true });
  }, [paid, navigate]);

  // Bucket purely by reservationStatus. `endDate` is the *planned* end of the
  // rental (set on the booking form), not the actual return date — using it
  // here would push every new reservation with a planned end straight into
  // the Returned tab.
  const pending = rentals.filter(r => r.reservationStatus === "pending");
  const active = rentals.filter(r => (r.reservationStatus ?? "active") === "active");
  const completed = rentals.filter(r => r.reservationStatus === "returned" || r.reservationStatus === "completed");
  const pendingReview = rentals.filter(r => r.staffReviewStatus === "pending");
  const reviewFilter = review === "pending";

  // ---- Derive a display status + outstanding balance for a reservation ----
  type DisplayStatus = "on_rent" | "returned" | "pending" | "past_due" | "paid";
  function rentalBalance(r: Rental): number {
    const sched = payments.filter(p => p.rentalId === r.id);
    const unpaid = sched
      .filter(p => p.status !== "paid")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const rs = r.reservationStatus ?? "active";
    // PENDING: nothing due yet
    if (rs === "pending") return 0;
    // RETURNED: show whatever is still unpaid
    if (rs === "returned" || rs === "completed") return unpaid;
    // ON RENT (active)
    const today = new Date().toISOString().slice(0, 10);
    const end = r.endDate ?? today;
    // Rental period has ended -> show full outstanding balance (overdue).
    // Late only AFTER the due/end date passes (not on the date itself).
    if (today > end) return unpaid;
    // Within paid rental period -> only show unpaid extension charges, if any
    const extPaymentIds = new Set(
      (r.extensions ?? []).map(e => e.paymentId).filter(Boolean) as string[],
    );
    return sched
      .filter(p => p.status !== "paid" && extPaymentIds.has(p.id))
      .reduce((s, p) => s + Number(p.amount || 0), 0);
  }
  function rentalStatus(r: Rental): DisplayStatus {
    const rs = r.reservationStatus ?? "active";
    if (rs === "pending") return "pending";
    if (rs === "returned" || rs === "completed") return "returned";
    if (r.paymentStatus === "late" || r.paymentStatus === "defaulted") return "past_due";
    const today = new Date().toISOString().slice(0, 10);
    const end = r.endDate ?? today;
    // Past the end date with money still owed = overdue (strictly after end date)
    if (today > end && rentalBalance(r) > 0) return "past_due";
    return "on_rent";
  }
  const STATUS_META: Record<DisplayStatus, { label: string; badge: string; row: string }> = {
    on_rent: { label: "On Rent", badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400", row: "" },
    returned: { label: "Returned", badge: "bg-muted text-muted-foreground", row: "" },
    pending: { label: "Pending", badge: "bg-amber-500/20 text-amber-700 dark:text-amber-400", row: "" },
    past_due: { label: "Past Due", badge: "bg-destructive/15 text-destructive", row: "bg-destructive/10 hover:bg-destructive/15" },
    paid: { label: "Paid", badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", row: "" },
  };
  const STATUS_ORDER: DisplayStatus[] = ["on_rent", "past_due", "pending", "paid", "returned"];

  const statusCounts: Record<StatusFilter, number> = {
    on_rent: rentals.filter(r => statusFilterMatches(r, "on_rent")).length,
    all: rentals.length,
    pending: rentals.filter(r => statusFilterMatches(r, "pending")).length,
    returned: rentals.filter(r => statusFilterMatches(r, "returned")).length,
    cancelled: rentals.filter(r => statusFilterMatches(r, "cancelled")).length,
  };

  const filteredSorted = (() => {
    const q = search.trim().toLowerCase();
    let rows = rentals.slice().filter(r => statusFilterMatches(r, status));
    if (q) {
      rows = rows.filter(r => {
        const v = vehicleById(r.vehicleId);
        const d = driverById(r.driverId);
        const hay = [
          r.id,
          d?.fullName ?? r.driverId,
          v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId,
          v?.plate ?? "",
          r.startDate,
          r.endDate ?? "",
          fmtDate(r.startDate),
          fmtDate(r.endDate),
          STATUS_META[rentalStatus(r)].label,
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    const cmp = (a: Rental, b: Rental): number => {
      switch (sortKey) {
        case "id": return a.id.localeCompare(b.id, undefined, { numeric: true });
        case "name": return (driverById(a.driverId)?.fullName ?? a.driverId).localeCompare(driverById(b.driverId)?.fullName ?? b.driverId);
        case "vehicle": {
          const va = vehicleById(a.vehicleId); const vb = vehicleById(b.vehicleId);
          return (va ? `${va.make} ${va.model}` : a.vehicleId).localeCompare(vb ? `${vb.make} ${vb.model}` : b.vehicleId);
        }
        case "start": return a.startDate.localeCompare(b.startDate);
        case "end": return (a.endDate ?? "").localeCompare(b.endDate ?? "");
        case "status": return STATUS_ORDER.indexOf(rentalStatus(a)) - STATUS_ORDER.indexOf(rentalStatus(b));
        case "balance": return rentalBalance(a) - rentalBalance(b);
        default: return 0;
      }
    };
    rows.sort((a, b) => sortDir === "asc" ? cmp(a, b) : -cmp(a, b));
    return rows;
  })();

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }
  function SortHead({ k, label, className }: { k: typeof sortKey; label: string; className?: string }) {
    return (
      <TableHead className={className}>
        <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
          {label}
          {sortKey === k ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>
      </TableHead>
    );
  }

  function renderRow(r: Rental) {
    const v = vehicleById(r.vehicleId);
    const d = driverById(r.driverId);
    const isPending = r.reservationStatus === "pending";
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => setDetail(r)}
        className="grid w-full grid-cols-12 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-accent/40"
      >
        <span className="col-span-2 truncate font-mono text-xs text-muted-foreground">{r.id}</span>
        <span className="col-span-3 truncate font-medium">{d?.fullName ?? r.driverId}</span>
        <span className="col-span-3 truncate text-muted-foreground">
          {v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId}
          {v?.plate ? <span className="ml-1 text-xs">· {v.plate}</span> : null}
        </span>
        <span className="col-span-2 flex items-center">
          {isPending ? <StatusBadge status="pending" /> : <StatusBadge status={r.paymentStatus} />}
        </span>
        <span className="col-span-2 truncate text-right text-xs text-muted-foreground">
          {fmtDate(r.startDate)}{r.endDate ? ` → ${fmtDate(r.endDate)}` : ""}
        </span>
      </button>
    );
  }

  function renderCard(r: Rental) {
    const v = vehicleById(r.vehicleId);
    const d = driverById(r.driverId);
    const sched = payments.filter(p => p.rentalId === r.id);
    const next = sched.find(p => p.status !== "paid");
    const isPending = r.reservationStatus === "pending";
    // ---- Amount-paid summary ----
    const paidPayments = sched.filter(p => p.status === "paid");
    const extensionsTotal = (r.extensions ?? []).reduce(
      (s, e) => s + Number(e.additionalAmount || 0), 0,
    );
    const extensionPaymentIds = new Set(
      (r.extensions ?? []).map(e => e.paymentId).filter(Boolean) as string[],
    );
    const rentalEnd = r.endDate ?? new Date().toISOString().slice(0, 10);
    const rentalViolations = violations.filter(
      x =>
        x.vehicleId === r.vehicleId &&
        x.driverId === r.driverId &&
        x.dateIssued >= r.startDate &&
        x.dateIssued <= rentalEnd,
    );
    const violationsPaid = rentalViolations
      .filter(x => x.status === "paid")
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    // Base = paid payments that aren't tagged as extension payments
    const basePaid = paidPayments
      .filter(p => !extensionPaymentIds.has(p.id))
      .reduce((s, p) => s + Number(p.amount || 0), 0)
      - (extensionPaymentIds.size === 0 ? extensionsTotal : 0);
    const baseRental = Math.max(0, basePaid) + Number(r.depositPaid || 0);
    const totalPaid = baseRental + extensionsTotal + violationsPaid;
    return (
      <Card key={r.id} className="overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="relative w-full md:w-72 lg:w-80 shrink-0 bg-muted">
            <div className="aspect-[4/3] md:aspect-auto md:h-full flex items-center justify-center text-muted-foreground/40">
              <Car className="h-16 w-16" />
            </div>
          </div>
          <div className="flex-1 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-xl md:text-2xl leading-tight truncate">
                  {v?.year} {v?.make} {v?.model}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Plate {v?.plate} · VIN {v?.vin}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {isPending ? "Reserved for" : "Rented to"} <span className="text-foreground font-medium">{d?.fullName}</span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {isPending ? <PendingHoldBadge rental={r} /> : <StatusBadge status={r.paymentStatus} />}
                <PaidBadge rental={r} />
              </div>
            </div>
            {isPending ? <PendingChecklist rental={r} /> : <HandoffStatus rental={r} />}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Stat label="Started" value={fmtDate(r.startDate)} />
              <Stat
                label={r.billingPeriod === "daily" ? "Daily" : r.billingPeriod === "monthly" ? "Monthly" : "Weekly"}
                value={fmtMoney(r.rate ?? r.weeklyRate)}
              />
              <Stat label="Deposit" value={fmtMoney(r.depositPaid)} />
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Amount paid so far
                </div>
                <div className="text-base font-semibold">{fmtMoney(totalPaid)}</div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Base rental</div>
                  <div className="font-medium text-sm">{fmtMoney(baseRental)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Extensions{(r.extensions?.length ?? 0) > 0 ? ` (${r.extensions!.length})` : ""}
                  </div>
                  <div className="font-medium text-sm">{fmtMoney(extensionsTotal)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Violations{rentalViolations.length > 0 ? ` (${rentalViolations.length})` : ""}
                  </div>
                  <div className="font-medium text-sm">{fmtMoney(violationsPaid)}</div>
                </div>
              </div>
            </div>
            {!isPending && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs uppercase text-muted-foreground">Next payment</div>
                {next ? (() => {
                  const today = new Date().toISOString().slice(0, 10);
                  let label = "Scheduled";
                  let tone = "bg-muted text-muted-foreground border-border";
                  if (today > next.dueDate) {
                    label = "Overdue";
                    tone = "bg-destructive/15 text-destructive border-destructive/30";
                  } else if (today === next.dueDate) {
                    label = "Due today";
                    tone = "bg-warning/20 text-warning-foreground border-warning/40";
                  }
                  return (
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-medium">{fmtMoney(next.amount)} due {fmtDate(next.dueDate)}</span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
                    </div>
                  );
                })() : <div className="mt-1 text-sm text-muted-foreground">All paid</div>}
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs uppercase text-muted-foreground">Balance</span>
                  <span className="text-base font-semibold">{fmtMoney(rentalBalance(r))}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const dr = driverById(r.driverId);
                      if (!dr?.phone && !dr?.email) { toast.error("No phone or email on file for renter"); return; }
                      try { await ensureRentalSynced(r.id); } catch { /* best effort */ }
                      setPayLinkRental(r);
                    }}
                  >
                    <Smartphone className="mr-1 h-4 w-4" /> Send Payment Link
                  </Button>
                  <Button size="sm" onClick={() => setCashRental(r)}>
                    <DollarSign className="mr-1 h-4 w-4" /> Record Cash Payment
                  </Button>
                </div>
              </div>
            )}
            {!isPending && <ReservationPaymentHistory rental={r} />}
            {!isPending && (() => {
              const card = getSavedCard(d);
              return (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Payment Method</div>
                  {card ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        💳 {card.brand} ending in {card.last4}
                        {card.expired ? (
                          <div className="mt-0.5 text-xs font-medium text-destructive">⚠️ Expired (update card to charge)</div>
                        ) : (
                          <div className="mt-0.5 text-xs text-muted-foreground">Status: Active ✓</div>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setAddCardRental(r)}>
                        Add/Update Card
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-muted-foreground">No card on file</div>
                      <Button size="sm" variant="outline" onClick={() => setAddCardRental(r)}>
                        Add/Update Card
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}
            {!isPending && <ReservationDocuments rental={r} />}
            <div className="flex flex-wrap gap-2">
              {isPending ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary">
                        <Send className="mr-1 h-4 w-4" /> Send agreement
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            await ensureRentalSynced(r.id);
                            const res = await sendSignLinkFn({
                              data: { rentalId: r.id, origin: getPublicAppOrigin() },
                            });
                            toast.success("Text message sent to renter", { description: res.link });
                          } catch (e) {
                            toast.error("Could not send text", {
                              description: e instanceof Error ? e.message : String(e),
                            });
                          }
                        }}
                      >
                        <MessageSquare className="mr-2 h-4 w-4" /> Text (SMS)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            await ensureRentalSynced(r.id);
                            const res = await getSignLinkFn({
                              data: { rentalId: r.id, origin: getPublicAppOrigin() },
                            });
                            if (!res.driverEmail) {
                              toast.error("No email on file for renter");
                              return;
                            }
                            const subject = "Your Camauto Rentals Agreement";
                            const body =
                              `Hi ${res.driverName ?? ""},\n\n` +
                              `Please complete your reservation by signing your rental agreement and uploading your driver's license + a selfie at the secure link below:\n\n` +
                              `${res.link}\n\n` +
                              `Thank you,\nCamauto Rentals\n(866) 625-5550`;
                            window.location.href = `mailto:${encodeURIComponent(res.driverEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                          } catch (e) {
                            toast.error("Could not prepare email", {
                              description: e instanceof Error ? e.message : String(e),
                            });
                          }
                        }}
                      >
                        <Mail className="mr-2 h-4 w-4" /> Email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            await ensureRentalSynced(r.id);
                            const res = await getSignLinkFn({
                              data: { rentalId: r.id, origin: getPublicAppOrigin() },
                            });
                            await navigator.clipboard.writeText(res.link);
                            toast.success("Signing link copied to clipboard");
                          } catch (e) {
                            toast.error("Could not copy link", {
                              description: e instanceof Error ? e.message : String(e),
                            });
                          }
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Copy link
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!r.paymentReceived}
                    onClick={async () => {
                      const d = driverById(r.driverId);
                      if (!d?.phone) { toast.error("No phone on file for renter"); return; }
                      try { await ensureRentalSynced(r.id); } catch { /* best effort */ }
                      setPayLinkRental(r);
                    }}
                  >
                    <Smartphone className="mr-1 h-4 w-4" />
                    {r.paymentReceived ? "Paid ✓" : "Send Payment Link"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setChargeCardRental(r)}
                    disabled={!!r.paymentReceived}
                  >
                    <DollarSign className="mr-1 h-4 w-4" />
                    {r.paymentReceived ? "Paid ✓" : "Charge Card"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!r.paymentReceived}
                    onClick={() => setCashRental(r)}
                  >
                    <DollarSign className="mr-1 h-4 w-4" />
                    Record Cash
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChatting(r)}
                  >
                    <MessageSquare className="mr-1 h-4 w-4" /> Notify renter
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (!window.confirm("Cancel this reservation?")) return;
                      if (!window.confirm("Are you sure? This cannot be undone.")) return;
                      cancelReservation(r.id);
                      toast.success("Reservation cancelled");
                    }}
                  >
                    <XIcon className="mr-1 h-4 w-4" /> Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                  {(['active', 'on_rent'].includes(r.reservationStatus ?? 'active')) && rentalBalance(r) > 0 && (
                    <Button size="sm" onClick={() => setRecordPayRental(r)}>
                      <DollarSign className="mr-1 h-4 w-4" /> Record Payment
                    </Button>
                  )}
                  {r.reservationStatus !== "returned" && r.reservationStatus !== "completed" && !r.endDate && getInspectionsForRental(r.id).every(i => i.type !== "check-out") && (
                    <Button size="sm" onClick={() => setDelivering(r)}>
                      <Truck className="mr-1 h-4 w-4" /> Deliver vehicle
                    </Button>
                  )}
                  {r.reservationStatus !== "returned" && r.reservationStatus !== "completed" && !r.endDate && (
                    <Button size="sm" onClick={() => setReturning(r)}>
                      <PackageCheck className="mr-1 h-4 w-4" /> Mark as Returned
                    </Button>
                  )}
                  {r.reservationStatus === "returned" || r.reservationStatus === "completed" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Returned{r.returnedAt ? ` ${fmtDate(r.returnedAt)}` : ""}
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setReturnChoiceRental(r)}>
                      <Undo2 className="mr-1 h-4 w-4" /> Return Vehicle
                    </Button>
                  )}
                  {(['active', 'on_rent'].includes(r.reservationStatus ?? 'active')) && (
                    <Button variant="outline" size="sm" onClick={() => setExtending(r)}>
                      <CalendarPlus className="mr-1 h-4 w-4" /> Extend rental
                    </Button>
                  )}
                  {(['active', 'on_rent'].includes(r.reservationStatus ?? 'active')) && (
                    <Button variant="outline" size="sm" onClick={() => setSwapping(r)}>
                      <ArrowLeftRight className="mr-1 h-4 w-4" /> Swap vehicle
                    </Button>
                  )}
                  {(['active', 'on_rent'].includes(r.reservationStatus ?? 'active')) && (r.autoRenew ?? true) && (
                    <Button variant="outline" size="sm" onClick={() => setStoppingAutoBill(r)}>
                      <Ban className="mr-1 h-4 w-4" /> Stop Auto-Renewal
                    </Button>
                  )}
                  {(['active', 'on_rent'].includes(r.reservationStatus ?? 'active')) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={portalLinkSendingId === r.id}
                      onClick={async () => {
                        setPortalLinkSendingId(r.id);
                        try {
                          await ensureRentalSynced(r.id);
                          const res = await sendPortalLinkFn({
                            data: { rentalId: r.id, origin: getPublicAppOrigin() },
                          });
                          const channels = [res.smsSent && "SMS", res.emailSent && "email"]
                            .filter(Boolean)
                            .join(" + ");
                          toast.success(`Portal link sent${channels ? ` via ${channels}` : ""}`);
                          await refreshStoreFromCloud();
                        } catch (e) {
                          toast.error("Could not send portal link", {
                            description: e instanceof Error ? e.message : String(e),
                          });
                        } finally {
                          setPortalLinkSendingId(null);
                        }
                      }}
                    >
                      <Smartphone className="mr-1 h-4 w-4" />
                      {portalLinkSendingId === r.id
                        ? "Sending…"
                        : (r.portalLinkSends?.length ?? 0) > 0
                          ? "Resend Portal Link"
                          : "Send Portal Link"}
                    </Button>
                  )}
                  {role === "admin" && (
                    <Button variant="outline" size="sm" onClick={() => setViolationFor(r)}>
                      <DollarSign className="mr-1 h-4 w-4" /> Charge for Violation
                    </Button>
                  )}
                  {r.paymentLinkAutoSentAt && !r.paymentReceived && (
                    <span
                      title={`Auto-sent ${new Date(r.paymentLinkAutoSentAt).toLocaleString()}`}
                      className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      Payment link auto-sent
                    </span>
                  )}
                  {r.billingCadence === "daily" && r.skipDailyMinimum && (
                    <span
                      title="Only 1 day collected upfront instead of the standard 2-day minimum"
                      className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                    >
                      1-day upfront (override)
                    </span>
                  )}
                </>
              )}
            </div>
            {!isPending && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Documents</div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={packetDownloadingId === r.id}
                    onClick={async () => {
                      setPacketDownloadingId(r.id);
                      try {
                        const res = await downloadPacketFn({ data: { rentalId: r.id } });
                        const bin = atob(res.base64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const blob = new Blob([bytes], { type: "application/zip" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = res.filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        if (res.missing && res.missing.length > 0) {
                          toast.warning("Downloaded — some items were missing", { description: res.missing.join(", ") });
                        } else {
                          toast.success("Evidence pack downloaded");
                        }
                      } catch (e) {
                        toast.error("Download failed", { description: e instanceof Error ? e.message : String(e) });
                      } finally {
                        setPacketDownloadingId(null);
                      }
                    }}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    {packetDownloadingId === r.id ? "Preparing…" : "Download Evidence Pack"}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {r.agreementPdfUrl ? (
                    <button
                      onClick={() => window.open(r.agreementPdfUrl!, "_blank", "noopener")}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <span className="text-lg">📄</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">SIGNED RENTAL AGREEMENT</div>
                        <div className="text-[10px] text-muted-foreground">PDF</div>
                      </div>
                    </button>
                  ) : (r.clientSignedAt || r.signedAt) ? (
                    <button
                      onClick={async () => {
                        setPdfRegenId(r.id);
                        try {
                          const res = await genPdfFn({ data: { rentalId: r.id } });
                          if (res?.url) {
                            toast.success("Agreement PDF generated");
                            window.open(res.url, "_blank", "noopener");
                            await ensureRentalSynced(r.id);
                          } else {
                            toast.error("Could not generate agreement PDF", { description: res?.error ?? "Unknown error" });
                          }
                        } catch (e) {
                          toast.error("Could not generate agreement PDF", { description: e instanceof Error ? e.message : String(e) });
                        } finally {
                          setPdfRegenId(null);
                        }
                      }}
                      disabled={pdfRegenId === r.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left disabled:opacity-50"
                    >
                      <span className="text-lg">📄</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">{pdfRegenId === r.id ? "Generating agreement…" : "GENERATE AGREEMENT"}</div>
                        <div className="text-[10px] text-muted-foreground">PDF</div>
                      </div>
                    </button>
                  ) : null}
                  {r.licenseImageUrl && (
                    <button
                      onClick={() => window.open(r.licenseImageUrl!, "_blank", "noopener")}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <span className="text-lg">📷</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">DRIVER'S LICENSE</div>
                        <div className="text-[10px] text-muted-foreground">JPG</div>
                      </div>
                    </button>
                  )}
                  {r.selfieImageUrl && (
                    <button
                      onClick={() => window.open(r.selfieImageUrl!, "_blank", "noopener")}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <span className="text-lg">📷</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">SELFIE</div>
                        <div className="text-[10px] text-muted-foreground">JPG</div>
                      </div>
                    </button>
                  )}
                  {r.receiptPdfUrl ? (
                    <button
                      onClick={() => window.open(r.receiptPdfUrl!, "_blank", "noopener")}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <span className="text-lg">📄</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">RENTAL RECEIPT</div>
                        <div className="text-[10px] text-muted-foreground">PDF</div>
                      </div>
                    </button>
                  ) : r.paymentReceived ? (
                    <button
                      onClick={async () => {
                        setReceiptRegenId(r.id);
                        try {
                          const res = await genReceiptFn({ data: { rentalId: r.id } });
                          if (res?.url) {
                            toast.success("Receipt PDF generated");
                            window.open(res.url, "_blank", "noopener");
                            await ensureRentalSynced(r.id);
                          } else {
                            toast.error("Could not generate receipt", { description: res?.error ?? "Unknown error" });
                          }
                        } catch (e) {
                          toast.error("Could not generate receipt", { description: e instanceof Error ? e.message : String(e) });
                        } finally {
                          setReceiptRegenId(null);
                        }
                      }}
                      disabled={receiptRegenId === r.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors text-left disabled:opacity-50"
                    >
                      <span className="text-lg">📄</span>
                      <div className="min-w-1 flex-1">
                        <div className="font-medium text-sm truncate">{receiptRegenId === r.id ? "Generating receipt…" : "GENERATE RECEIPT"}</div>
                        <div className="text-[10px] text-muted-foreground">PDF</div>
                      </div>
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            {!isPending && !r.endDate && (
              <RentalCardTabs rental={r} />
            )}
            {r.nameMismatchFlag && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <span aria-hidden>🛡️</span> Card Verification
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium capitalize text-amber-800">
                    {r.verificationStatus ?? "pending"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Cardholder</span>
                  <span className="text-right font-medium">{r.cardholderName ?? "—"}</span>
                  <span className="text-muted-foreground">Relationship</span>
                  <span className="text-right font-medium">{r.cardholderRelationship ?? "—"}</span>
                  <span className="text-muted-foreground">Phone</span>
                  <span className="text-right font-medium">{r.cardholderPhone ?? "—"}</span>
                  <span className="text-muted-foreground">Verified</span>
                  <span className="text-right font-medium">
                    {r.cardholderVerifiedAt
                      ? new Date(r.cardholderVerifiedAt).toLocaleString()
                      : "—"}
                  </span>
                </div>
                {r.cardholderLicenseUrl && (
                  <button
                    onClick={() => window.open(r.cardholderLicenseUrl!, "_blank", "noopener")}
                    className="mt-2"
                  >
                    <img
                      src={r.cardholderLicenseUrl}
                      alt="Cardholder license"
                      className="h-20 w-auto rounded border border-border object-cover"
                    />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${active.length} on rent · ${pending.length} pending · ${completed.length} returned`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Button>
            <ReportActions csv={{
              filename: "rentals.csv",
              headers: ["ID", "Driver", "Vehicle", "Plate", "Started", "Ended", "Weekly", "Deposit", "Status", "Reservation"],
              rows: rentals.map(r => {
                const v = vehicleById(r.vehicleId);
                return [r.id, driverById(r.driverId)?.fullName ?? r.driverId, v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId, v?.plate ?? "", r.startDate, r.endDate ?? "", r.weeklyRate, r.depositPaid, r.paymentStatus, r.reservationStatus ?? "active"];
              }),
            }} />
            <Button onClick={() => setNewOpen(true)}>+ New Reservation</Button>
          </div>
        }
      />
      <div className="space-y-4">
        {reviewFilter ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <div>
                <div className="font-semibold">Pending Staff Review ({pendingReview.length})</div>
                <div className="text-xs text-muted-foreground">Signed agreements awaiting staff review and payment link.</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/rentals", search: {}, replace: true })}>
                Show all
              </Button>
            </div>
            {pendingReview.length === 0
              ? <EmptyState label="No agreements awaiting review." />
              : pendingReview.map(renderRow)}
          </div>
        ) : (<>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, reservation #, or date…"
            className="pl-9"
          />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="id" label="Reservation #" />
                <SortHead k="name" label="Client Name" />
                <SortHead k="vehicle" label="Vehicle" />
                <SortHead k="start" label="Start Date" />
                <SortHead k="end" label="End Date" />
                <SortHead k="status" label="Status" />
                <SortHead k="balance" label="Balance" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    {search ? "No reservations match your search." : "No reservations yet."}
                  </TableCell>
                </TableRow>
              ) : filteredSorted.map(r => {
                const v = vehicleById(r.vehicleId);
                const d = driverById(r.driverId);
                const st = rentalStatus(r);
                const meta = STATUS_META[st];
                const bal = rentalBalance(r);
                return (
                  <TableRow
                    key={r.id}
                    onClick={() => setDetail(r)}
                    className={`cursor-pointer ${meta.row}`}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.id}</TableCell>
                    <TableCell className="font-medium">{d?.fullName ?? r.driverId}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId}
                      {v?.plate ? <span className="ml-1 text-xs">· {v.plate}</span> : null}
                    </TableCell>
                    <TableCell className="text-xs">{fmtDate(r.startDate)}</TableCell>
                    <TableCell className="text-xs">{r.endDate ? fmtDate(r.endDate) : "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>{meta.label}</span>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${bal > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {fmtMoney(bal)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>)}
      </div>
      <NewReservationDialog open={newOpen} onOpenChange={setNewOpen} />
      <Dialog open={!!detail} onOpenChange={(o) => {
        if (!o) {
          setDetail(null);
          navigate({ to: "/rentals", search: { paid, review } });
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reservation details</DialogTitle>
          </DialogHeader>
          {detail && renderCard(detail)}
        </DialogContent>
      </Dialog>
      <EditRentalDialog rental={editing} onClose={() => setEditing(null)} />
      <DeliveryDialog rental={delivering} onClose={() => setDelivering(null)} />
      <ReturnDialog rental={returning} onClose={() => setReturning(null)} />
      <ExtendRentalDialog rental={extending} onClose={() => setExtending(null)} />
      <SwapVehicleDialog rental={swapping} onClose={() => setSwapping(null)} />
      <StopAutoBillDialog rental={stoppingAutoBill} onClose={() => setStoppingAutoBill(null)} />
      <CaptureSignatureDialog rental={signing} onClose={() => setSigning(null)} />
      <ChargeRentalDialog
        rental={charging}
        onClose={() => setCharging(null)}
        userEmail={user?.email}
        userId={user?.id}
      />
      <ViolationChargeDialog
        rental={violationFor}
        onClose={() => setViolationFor(null)}
      />
      <NotifyRenterDialog
        open={!!chatting}
        onOpenChange={(o) => !o && setChatting(null)}
        renterName={chatting ? (driverById(chatting.driverId)?.fullName ?? "") : ""}
        phone={chatting ? (driverById(chatting.driverId)?.phone ?? "") : ""}
      />
      <SendPaymentLinkDialog
        open={!!payLinkRental}
        onOpenChange={(o) => { if (!o) setPayLinkRental(null); }}
        rentalId={payLinkRental?.id ?? ""}
        renterName={payLinkRental ? (driverById(payLinkRental.driverId)?.fullName ?? "") : ""}
        phone={payLinkRental ? (driverById(payLinkRental.driverId)?.phone ?? "") : ""}
        email={payLinkRental ? (driverById(payLinkRental.driverId)?.email ?? null) : null}
        defaultAmount={payLinkRental ? (rentalBalance(payLinkRental) || Number(payLinkRental.rate ?? payLinkRental.weeklyRate ?? 0)) : 0}
        description={payLinkRental ? (() => {
          const v = vehicleById(payLinkRental.vehicleId);
          const periodLbl = payLinkRental.billingPeriod === "daily" ? "day" : payLinkRental.billingPeriod === "monthly" ? "month" : "week";
          return `First ${periodLbl} — ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim();
        })() : ""}
        savedCard={payLinkRental ? getSavedCard(driverById(payLinkRental.driverId)) : null}
      />
      <AddCardDialog
        open={!!addCardRental}
        onOpenChange={(o) => { if (!o) setAddCardRental(null); }}
        driverId={addCardRental?.driverId ?? ""}
        driverName={addCardRental ? (driverById(addCardRental.driverId)?.fullName ?? "") : ""}
      />
      <RecordCashDialog
        open={!!cashRental}
        onOpenChange={(o) => { if (!o) setCashRental(null); }}
        rentalId={cashRental?.id ?? ""}
        renterName={cashRental ? (driverById(cashRental.driverId)?.fullName ?? "") : ""}
        defaultAmount={cashRental ? (rentalBalance(cashRental) || Number(cashRental.rate ?? cashRental.weeklyRate ?? 0)) : 0}
      />
      <ChargeCardDialog
        open={!!chargeCardRental}
        onOpenChange={(o) => { if (!o) setChargeCardRental(null); }}
        rentalId={chargeCardRental?.id ?? ""}
        driverId={chargeCardRental?.driverId ?? ""}
        renterName={chargeCardRental ? (driverById(chargeCardRental.driverId)?.fullName ?? "") : ""}
        defaultAmount={chargeCardRental ? (rentalBalance(chargeCardRental) || Number(chargeCardRental.rate ?? chargeCardRental.weeklyRate ?? 0)) : 0}
        description={chargeCardRental ? (() => {
          const v = vehicleById(chargeCardRental.vehicleId);
          return `Camauto Rentals — ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim();
        })() : ""}
        savedCard={chargeCardRental ? getSavedCard(driverById(chargeCardRental.driverId)) : null}
        consentOnFile={chargeCardRental ? !!(chargeCardRental.clientSignedAt || chargeCardRental.signedAt) : true}
      />
      <ReturnVehicleDialog
        rental={returnChoiceRental}
        onClose={() => setReturnChoiceRental(null)}
      />
      <RecordPaymentDialog
        open={!!recordPayRental}
        onOpenChange={(o) => { if (!o) setRecordPayRental(null); }}
        renterName={recordPayRental ? (driverById(recordPayRental.driverId)?.fullName ?? "") : ""}
        balance={recordPayRental ? rentalBalance(recordPayRental) : 0}
        savedCard={recordPayRental ? getSavedCard(driverById(recordPayRental.driverId)) : null}
        onCash={() => recordPayRental && setCashRental(recordPayRental)}
        onCard={() => recordPayRental && setChargeCardRental(recordPayRental)}
        onLink={async () => {
          const r = recordPayRental;
          if (!r) return;
          const d = driverById(r.driverId);
          if (!d?.phone && !d?.email) { toast.error("No phone or email on file for renter"); return; }
          try { await ensureRentalSynced(r.id); } catch { /* best effort */ }
          setPayLinkRental(r);
        }}
      />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>;
}

function ChargeRentalDialog({
  rental, onClose, userEmail, userId,
}: { rental: Rental | null; onClose: () => void; userEmail?: string; userId?: string }) {
  const open = !!rental;
  if (!rental) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }
  const v = vehicleById(rental.vehicleId);
  const d = driverById(rental.driverId);
  const period = rental.billingPeriod ?? "weekly";
  const periodLabel = period === "daily" ? "day" : period === "monthly" ? "month" : "week";
  const amount = rental.rate ?? rental.weeklyRate;
  const amountInCents = Math.round(amount * 100);
  const returnUrl = `${window.location.origin}/rentals?paid=${rental.id}&session_id={CHECKOUT_SESSION_ID}`;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Charge first {periodLabel} — {fmtMoney(amount)}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div><span className="text-muted-foreground">Vehicle:</span> {v?.year} {v?.make} {v?.model}</div>
          <div><span className="text-muted-foreground">Renter:</span> {d?.fullName} · {d?.email}</div>
          <div><span className="text-muted-foreground">Reservation:</span> {rental.id}</div>
        </div>
        <StripeRentalCheckout
          kind="deposit"
          amountInCents={amountInCents}
          rentalId={rental.id}
          customerEmail={d?.email || userEmail}
          customerName={d?.fullName}
          userId={userId}
          returnUrl={returnUrl}
        />
      </DialogContent>
    </Dialog>
  );
}

function PendingHoldBadge({ rental }: { rental: Rental }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const exp = pendingExpiresAt(rental);
  if (!exp) return null;
  const remaining = exp - now;
  const hrs = Math.max(0, Math.floor(remaining / 3_600_000));
  const mins = Math.max(0, Math.floor((remaining % 3_600_000) / 60_000));
  const expired = remaining <= 0;
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${expired ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
      <Clock className="h-3.5 w-3.5" />
      {expired ? "Hold expired" : `Hold ${hrs}h ${mins}m left`}
    </div>
  );
}

function PaidBadge({ rental }: { rental: Rental }) {
  const paid = currentPeriodPaid(rental);
  if (rental.endDate) return null;
  return (
    <div
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        paid
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-destructive/15 text-destructive"
      }`}
      title={paid ? "Current period paid" : "Current period unpaid"}
    >
      <DollarSign className="h-3 w-3" />
      {paid ? "Paid" : "Unpaid"}
    </div>
  );
}

function PendingChecklist({ rental }: { rental: Rental }) {
  const signed = !!rental.signatureDataUrl;
  const paid = !!rental.paymentReceived;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5 text-xs">
      <div className="font-medium text-amber-700 dark:text-amber-400">
        Pending — collect first payment to activate
      </div>
      <div className="flex items-center gap-2">
        {paid ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
        <span className={paid ? "text-foreground font-medium" : "text-muted-foreground"}>
          First payment received <span className="text-[10px] uppercase tracking-wide">(activates reservation)</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        {signed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
        <span className={signed ? "text-foreground" : "text-muted-foreground"}>
          Rental agreement signed <span className="text-[10px] uppercase tracking-wide">(optional)</span>
        </span>
      </div>
    </div>
  );
}

function CaptureSignatureDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (rental) { setSig(rental.signatureDataUrl ?? null); setAccepted(false); }
  }, [rental]);
  function confirm() {
    if (!rental || !d) return;
    if (!accepted) { toast.error("Client must accept the agreement"); return; }
    if (!sig) { toast.error("Signature required"); return; }
    const activated = captureSignature(rental.id, sig, d.fullName, AGREEMENT_VERSION);
    toast.success(activated ? "Reservation activated" : "Signature captured");
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Capture rental agreement signature</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground">RENTALPRISE AUTO — VEHICLE RENTAL AGREEMENT {AGREEMENT_VERSION}</p>
              <p className="mt-2">Renter agrees to pay the contracted rate and a refundable deposit, and is responsible for damage, citations, tolls, impound fees, and parking violations during the rental term. Vehicle must be returned in the same condition as delivered. Failure to return or pay may result in repossession. Governed by the laws of the State of Georgia.</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
              <span>I, <span className="font-medium">{d.fullName}</span>, have read and agree to the terms.</span>
            </label>
            <div>
              <Label className="mb-1 block">Signature</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><FileSignature className="mr-1 h-4 w-4" /> Save signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

function HandoffStatus({ rental }: { rental: Rental }) {
  const insps = getInspectionsForRental(rental.id);
  const checkout = insps.find(i => i.type === "check-out");
  if (rental.endDate) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5" /> Returned {fmtDate(rental.endDate)}
      </div>
    );
  }
  if (checkout) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary">
        <Truck className="h-3.5 w-3.5" /> Out with driver — delivered {fmtDate(checkout.date)} at {checkout.mileage.toLocaleString()} mi
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      <ClipboardCheck className="h-3.5 w-3.5" /> Awaiting handoff — log delivery to give the driver the keys
    </div>
  );
}

function DeliveryDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const [mileage, setMileage] = useState(0);
  const [fuelLevel, setFuelLevel] = useState(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (rental && v) {
      setMileage(v.mileage);
      setFuelLevel(100);
      setDamageNoted(false);
      setCompletedBy("");
      setNotes("");
    }
  }, [rental, v]);
  function confirm() {
    if (!rental || !v) return;
    if (!completedBy.trim()) {
      toast.error("Who is delivering the vehicle?");
      return;
    }
    addInspection({
      vehicleId: v.id,
      rentalId: rental.id,
      type: "check-out",
      date: new Date().toISOString().slice(0, 10),
      mileage: Number(mileage) || v.mileage,
      fuelLevel: Number(fuelLevel),
      damageNoted,
      completedBy: completedBy.trim(),
    });
    if (notes.trim()) {
      updateRental(rental.id, { notes: [rental.notes, `Delivery: ${notes.trim()}`].filter(Boolean).join(" · ") });
    }
    toast.success("Vehicle delivered", { description: `${v.year} ${v.make} ${v.model} → ${d?.fullName}` });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deliver vehicle</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Handing off to {d.fullName} · {d.phone}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dl-mi">Odometer (mi)</Label>
                <Input id="dl-mi" type="number" inputMode="numeric" placeholder="Enter mileage" value={mileage || ""} onChange={e => setMileage(Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="dl-fuel">Fuel level (%)</Label>
                <Input id="dl-fuel" type="number" min={0} max={100} value={fuelLevel} onChange={e => setFuelLevel(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dl-by">Delivered by</Label>
                <Input id="dl-by" value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="Staff name" />
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="dl-dmg" type="checkbox" checked={damageNoted} onChange={e => setDamageNoted(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="dl-dmg" className="!mt-0">Pre-existing damage noted</Label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dl-notes">Delivery notes</Label>
                <Textarea id="dl-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Pickup location, fuel/cleanliness, walk-around notes…" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><Truck className="mr-1 h-4 w-4" /> Confirm delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const router = useRouter();
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const checkout = rental ? getInspectionsForRental(rental.id).find(i => i.type === "check-out") : undefined;
  const sendSmsFn = useServerFn(sendRentalSms);
  const closeout = useServerFn(closeoutRental);
  const settings = useAgreementSettings();
  const [mileage, setMileage] = useState(0);
  const [fuelLevel, setFuelLevel] = useState(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [check, setCheck] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (rental && v) {
      setMileage(v.mileage);
      setFuelLevel(100);
      setDamageNoted(false);
      setCompletedBy("");
      setNotes("");
      setCheck({});
    }
  }, [rental, v]);
  async function confirm() {
    if (!rental || !v) return;
    if (!completedBy.trim()) { toast.error("Who received the vehicle?"); return; }
    if (mileage < (checkout?.mileage ?? 0)) { toast.error("Return mileage can't be less than delivery mileage"); return; }
    const missing = RETURN_CHECKLIST.filter(item => !check[item]);
    if (missing.length > 0) {
      toast.error("Complete the return checklist", { description: `${missing.length} item(s) remaining` });
      return;
    }
    const inspection = addInspection({
      vehicleId: v.id,
      rentalId: rental.id,
      type: "check-in",
      date: new Date().toISOString().slice(0, 10),
      mileage: Number(mileage) || v.mileage,
      fuelLevel: Number(fuelLevel),
      damageNoted,
      completedBy: completedBy.trim(),
    });
    if (damageNoted) {
      const renter = d?.fullName ?? rental.driverId;
      const msg = `Rentalprise Auto: New damage reported on return of ${v.year} ${v.make} ${v.model} (Plate ${v.plate}) by ${renter}. Odo ${Number(mileage).toLocaleString()} mi · Fuel ${fuelLevel}%. Received by ${completedBy.trim()}.${notes.trim() ? ` Notes: ${notes.trim()}` : ""}`;
      const alertPhone = settings.company.damageAlertPhone?.trim();
      if (alertPhone) {
        sendSmsFn({ data: { phone: alertPhone, message: msg.slice(0, 1000), name: "Damage Alert" } })
          .then(() => toast.success("Damage alert SMS sent"))
          .catch(e => toast.error("Damage SMS failed", { description: e instanceof Error ? e.message : String(e) }));
      } else {
        toast.warning("No damage alert phone configured", { description: "Set it under Rental Agreement → Company." });
      }
      // Auto-create a maintenance record flagged as damage from return
      try {
        addMaintenance({
          vehicleId: v.id,
          serviceType: "Damage from rental return",
          cost: 0,
          vendor: "TBD",
          dateCompleted: new Date().toISOString().slice(0, 10),
          mileageAtService: Number(mileage) || v.mileage,
          nextServiceDue: new Date().toISOString().slice(0, 10),
          notes: `Damage reported on return of rental ${rental.id} (${v.plate}) by ${renter}. Received by ${completedBy.trim()}.${notes.trim() ? ` Details: ${notes.trim()}` : ""}`,
        });
      } catch (e) {
        console.error("Failed to auto-create damage maintenance record", e);
      }
    } else if (d?.phone) {
      // Clean return — send renter confirmation
      const confirmMsg = "Your vehicle return has been confirmed. Thanks for renting with Camauto!";
      sendSmsFn({ data: { phone: d.phone, message: confirmMsg, name: d.fullName } })
        .catch(e => console.error("Renter return SMS failed", e));
    }
    try {
      const res = await closeout({
        data: {
          rental_id: rental.id,
          inspection_id: inspection.id,
          mileage_in: Number(mileage) || v.mileage,
        },
      });
      if (!res.alreadyReturned) syncLocalReturn(rental.id);
      const checklistSummary = `Return checklist: ${RETURN_CHECKLIST.length}/${RETURN_CHECKLIST.length} verified by ${completedBy.trim()}`;
      const noteParts = [rental.notes, checklistSummary, notes.trim() ? `Return: ${notes.trim()}` : ""].filter(Boolean);
      updateRental(rental.id, { notes: noteParts.join(" · ") });
      await refreshStoreFromCloud();
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to return rental");
      return;
    }
    try { localStorage.removeItem(`return-checklist:${rental.id}`); } catch { /* ignore */ }
    const drove = checkout ? mileage - checkout.mileage : 0;
    toast.success("Vehicle returned — vehicle is available in fleet", {
      description: `${v.year} ${v.make} ${v.model}${drove > 0 ? ` · ${drove.toLocaleString()} mi driven` : ""}`,
    });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return inspection</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Returned by {d.fullName} · {d.phone}</div>
              {checkout && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Delivered {fmtDate(checkout.date)} at {checkout.mileage.toLocaleString()} mi · fuel {checkout.fuelLevel}%
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rt-mi">Return odometer (mi)</Label>
                <Input id="rt-mi" type="number" inputMode="numeric" placeholder="Enter mileage" value={mileage || ""} onChange={e => setMileage(Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="rt-fuel">Fuel level (%)</Label>
                <Input id="rt-fuel" type="number" min={0} max={100} value={fuelLevel} onChange={e => setFuelLevel(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rt-by">Received by</Label>
                <Input id="rt-by" value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="Staff name" />
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="rt-dmg" type="checkbox" checked={damageNoted} onChange={e => setDamageNoted(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="rt-dmg" className="!mt-0">New damage observed</Label>
              </div>
              <div className="sm:col-span-2 rounded-md border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <ListChecks className="h-4 w-4 text-primary" /> Required return checklist
                </div>
                <div className="grid gap-1.5">
                  {RETURN_CHECKLIST.map(item => (
                    <label key={item} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={!!check[item]}
                        onChange={e => setCheck(c => ({ ...c, [item]: e.target.checked }))}
                      />
                      <span className={check[item] ? "text-foreground" : "text-muted-foreground"}>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rt-notes">Return notes</Label>
                <Textarea id="rt-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Cleanliness, missing items, damage details…" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><PackageCheck className="mr-1 h-4 w-4" /> Confirm return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RETURN_CHECKLIST = [
  "Vehicle parked in return bay",
  "Both keys / fobs returned",
  "Walk-around inspection completed (4 sides + roof)",
  "Odometer photographed",
  "Fuel level photographed",
  "Interior cleaned & no personal items left",
  "Trunk / cargo area inspected",
  "Tires & lights checked",
  "Tolls / citations / damage logged",
  "Driver acknowledged final condition",
] as const;

function RentalCardTabs({ rental }: { rental: Rental }) {
  const storageKey = `return-checklist:${rental.id}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setChecked(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [storageKey]);
  function toggle(item: string, val: boolean) {
    setChecked(prev => {
      const next = { ...prev, [item]: val };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  const done = RETURN_CHECKLIST.filter(i => checked[i]).length;
  const total = RETURN_CHECKLIST.length;
  return (
    <Tabs defaultValue="overview" className="mt-2">
      <TabsList className="h-9">
        <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
        <TabsTrigger value="checklist" className="text-xs">
          Return checklist
          <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${done === total ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {done}/{total}
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-2 text-xs text-muted-foreground">
        Use the Return Checklist tab to walk through end-of-rental steps before processing the return.
      </TabsContent>
      <TabsContent value="checklist" className="mt-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" /> End-of-rental checklist
          </div>
          <div className="grid gap-1.5">
            {RETURN_CHECKLIST.map(item => (
              <label key={item} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={!!checked[item]}
                  onChange={e => toggle(item, e.target.checked)}
                />
                <span className={checked[item] ? "text-foreground line-through opacity-70" : "text-foreground"}>{item}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This is a pre-return guide. The official inspection is captured when you click <strong>Mark as Returned</strong>.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function EditRentalDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const [weeklyRate, setWeeklyRate] = useState(0);
  const [depositPaid, setDepositPaid] = useState(0);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [billingCadence, setBillingCadence] = useState<"daily" | "weekly">("weekly");
  const [rateAmount, setRateAmount] = useState<number>(0);
  const [autoRenew, setAutoRenew] = useState<boolean>(true);
  const [skipDailyMin, setSkipDailyMin] = useState<boolean>(false);
  useEffect(() => {
    if (rental) {
      setWeeklyRate(rental.weeklyRate);
      setDepositPaid(rental.depositPaid);
      setEndDate(rental.endDate ?? "");
      setNotes(rental.notes ?? "");
      setBillingCadence(rental.billingCadence ?? (rental.billingPeriod === "daily" ? "daily" : "weekly"));
      setRateAmount(rental.rateAmount ?? rental.rate ?? rental.weeklyRate ?? 0);
      setAutoRenew(rental.autoRenew ?? true);
      setSkipDailyMin(rental.skipDailyMinimum ?? false);
    }
  }, [rental]);
  const computedPeriodEnd = rental ? calcCurrentPeriodEnd(rental.startDate, billingCadence) : "";
  function save() {
    if (!rental) return;
    updateRental(rental.id, {
      weeklyRate, depositPaid,
      endDate: endDate || undefined,
      notes: notes || undefined,
      billingCadence,
      rateAmount,
      autoRenew,
      skipDailyMinimum: billingCadence === "daily" ? skipDailyMin : false,
      currentPeriodEnd: computedPeriodEnd,
    });
    toast.success("Reservation updated");
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit reservation</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Weekly rate</Label><Input type="number" inputMode="decimal" placeholder="Enter amount" value={weeklyRate || ""} onChange={e => setWeeklyRate(Number(e.target.value))} /></div>
          <div><Label>Deposit</Label><Input type="number" inputMode="decimal" placeholder="Enter amount" value={depositPaid || ""} onChange={e => setDepositPaid(Number(e.target.value))} /></div>
          <div>
            <Label>Billing cadence</Label>
            <Select value={billingCadence} onValueChange={(v) => setBillingCadence(v as "daily" | "weekly")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rate amount ($/period)</Label>
            <Input type="number" min={0} inputMode="decimal" placeholder="Enter amount" value={rateAmount || ""} onChange={e => setRateAmount(Number(e.target.value))} />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="block">Auto-renew</Label>
              <p className="text-xs text-muted-foreground">Keep advancing the billing period after each payment.</p>
            </div>
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
          </div>
          {billingCadence === "daily" && (
            <div className="sm:col-span-2 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div>
                <Label className="block">Skip 2-day minimum (family &amp; friends)</Label>
                <p className="text-xs text-muted-foreground">When ON, only 1 day is collected upfront. Default is 2 days.</p>
              </div>
              <Switch checked={skipDailyMin} onCheckedChange={setSkipDailyMin} />
            </div>
          )}
          <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground">Current period ends</div>
            <div className="mt-1 font-medium">{computedPeriodEnd ? fmtDate(computedPeriodEnd) : "—"}</div>
            <p className="mt-1 text-xs text-muted-foreground">Calculated from start date + cadence. Not user-editable.</p>
          </div>
          <div className="sm:col-span-2"><Label>End date</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtendRentalDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const createLinkFn = useServerFn(createExtensionLink);
  const [newEndDate, setNewEndDate] = useState("");
  const [duration, setDuration] = useState<"7" | "14" | "21" | "custom">("7");
  const [submitting, setSubmitting] = useState(false);
  const [sentInfo, setSentInfo] = useState<{ signUrl: string; amount: number; newEnd: string; phone: string | null; smsSent: boolean } | null>(null);
  useEffect(() => {
    if (rental) {
      const base = rental.endDate ? new Date(rental.endDate) : new Date();
      base.setDate(base.getDate() + 7);
      setNewEndDate(base.toISOString().slice(0, 10));
      setDuration("7");
      setSentInfo(null);
      setSubmitting(false);
    }
  }, [rental]);
  function applyDuration(value: "7" | "14" | "21" | "custom") {
    setDuration(value);
    if (value === "custom" || !rental) return;
    const days = Number(value);
    const base = rental.endDate ? new Date(rental.endDate) : new Date();
    base.setDate(base.getDate() + days);
    setNewEndDate(base.toISOString().slice(0, 10));
  }
  const charge = rental && newEndDate ? computeExtensionCharge(rental, newEndDate) : null;
  async function sendLink() {
    if (!rental || !newEndDate || !d) return;
    if (rental.endDate && newEndDate <= rental.endDate) {
      toast.error("New end date must be after the current end date");
      return;
    }
    if (!charge || charge.periods < 1) { toast.error("Pick a duration"); return; }
    setSubmitting(true);
    try {
      const r = await createLinkFn({ data: { rentalId: rental.id, periods: charge.periods, periodLabel: charge.periodLabel } });
      setSentInfo({ signUrl: r.signUrl, amount: r.additionalAmount, newEnd: r.newEndDate, phone: r.renterPhone, smsSent: r.smsSent });
      toast.success(r.smsSent ? "Extension link sent to renter" : "Extension link created");
    } catch (e: any) {
      toast.error(e?.message || "Could not create extension link");
    } finally {
      setSubmitting(false);
    }
  }
  function copyLink() {
    if (!sentInfo) return;
    navigator.clipboard.writeText(sentInfo.signUrl).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy"),
    );
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Extend rental</DialogTitle></DialogHeader>
        {rental && v && d && !sentInfo && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Current end date: {rental.endDate ? fmtDate(rental.endDate) : "open-ended"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ext-duration">Duration</Label>
                <select
                  id="ext-duration"
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={duration}
                  onChange={(e) => applyDuration(e.target.value as "7" | "14" | "21" | "custom")}
                >
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="21">21 days</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <Label htmlFor="ext-end">New end date</Label>
                <Input
                  id="ext-end"
                  type="date"
                  value={newEndDate}
                  onChange={(e) => { setNewEndDate(e.target.value); setDuration("custom"); }}
                />
              </div>
            </div>
            {charge && charge.additionalAmount > 0 && (
              <div className="rounded-md border bg-card p-3 text-sm">
                <div className="text-xs uppercase text-muted-foreground">Extension charge</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span>{charge.periods} additional {charge.periodLabel}{charge.periods === 1 ? "" : "s"} × {fmtMoney(rental.rate ?? rental.weeklyRate)}</span>
                  <span className="text-lg font-bold">{fmtMoney(charge.additionalAmount)}</span>
                </div>
              </div>
            )}
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              The renter will receive a text with one link. On that page they review the Extension
              Agreement, sign, and pay {charge?.additionalAmount ? fmtMoney(charge.additionalAmount) : ""} via Stripe.
              Once paid, the reservation end date, calendar, and P&amp;L update automatically.
            </div>
            {!d.phone && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800">
                No phone number on file for this renter — we'll generate the link but you'll need to share it manually.
              </div>
            )}
          </div>
        )}
        {sentInfo && (
          <div className="space-y-4">
            <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-3 text-sm">
              <div className="font-semibold text-green-700 dark:text-green-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {sentInfo.smsSent ? `Link sent to ${sentInfo.phone}` : "Link created"}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Once the renter signs and pays {fmtMoney(sentInfo.amount)}, the reservation extends to {fmtDate(sentInfo.newEnd)} automatically.
              </div>
            </div>
            <div className="rounded-md border p-2 text-xs flex items-center gap-2 bg-muted/30">
              <code className="flex-1 truncate">{sentInfo.signUrl}</code>
              <Button variant="outline" size="sm" onClick={copyLink}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{sentInfo ? "Done" : "Cancel"}</Button>
          {!sentInfo && (
            <Button onClick={sendLink} disabled={submitting}>
              <Send className="mr-1 h-4 w-4" /> {submitting ? "Sending…" : "Send Extension Link to Renter"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function SwapVehicleDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const sendSmsFn = useServerFn(sendRentalSms);
  const [newVehicleId, setNewVehicleId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  useStoreVersion();
  useEffect(() => { if (rental) { setNewVehicleId(""); setReason(""); } }, [rental]);
  if (!rental) return <Dialog open={false} onOpenChange={() => {}}><DialogContent /></Dialog>;
  const currentV = vehicleById(rental.vehicleId);
  const d = driverById(rental.driverId);
  const available = vehicles.filter(v => isVehicleBookable(v.id) && v.id !== rental.vehicleId);
  function confirm() {
    if (!rental || !newVehicleId) { toast.error("Pick a replacement vehicle"); return; }
    if (!reason.trim()) { toast.error("Reason for swap is required"); return; }
    setSubmitting(true);
    try {
      const { newVehicle } = swapVehicle(rental.id, newVehicleId, reason.trim());
      if (d?.phone) {
        const msg = `Your vehicle has been swapped to ${newVehicle.year} ${newVehicle.make} ${newVehicle.model} (Plate ${newVehicle.plate}). Your rental continues.`;
        sendSmsFn({ data: { phone: d.phone, message: msg.slice(0, 1000), name: d.fullName } })
          .catch(e => console.error("Swap SMS failed", e));
      }
      toast.success("Vehicle swapped successfully", { description: `${newVehicle.year} ${newVehicle.make} ${newVehicle.model}` });
      onClose();
    } catch (e) {
      toast.error("Swap failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Swap vehicle</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground">Currently on rental</div>
            <div className="font-medium">{currentV?.year} {currentV?.make} {currentV?.model} · {currentV?.plate}</div>
            <div className="text-xs text-muted-foreground mt-1">Renter: {d?.fullName}</div>
          </div>
          <div>
            <Label>Replacement vehicle</Label>
            {available.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No available vehicles in the fleet.</div>
            ) : (
              <select
                value={newVehicleId}
                onChange={(e) => setNewVehicleId(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a vehicle…</option>
                {available.map(v => (
                  <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <Label htmlFor="swap-reason">Reason for swap <span className="text-destructive">*</span></Label>
            <Textarea
              id="swap-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Mechanical issue with current vehicle, renter requested upgrade…"
              className="mt-1"
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The old vehicle will be marked Available and the new vehicle will be marked Rented. The renter will get an SMS with the new vehicle details.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={confirm} disabled={!newVehicleId || !reason.trim() || submitting}>
            <ArrowLeftRight className="mr-1 h-4 w-4" /> Confirm Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function ViolationChargeDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chargeFn = useServerFn(chargeViolation);

  useEffect(() => {
    if (rental) {
      setAmount("");
      setDescription("");
      setError(null);
      setSubmitting(false);
    }
  }, [rental?.id]);

  if (!rental) return null;
  const driver = driverById(rental.driverId);

  async function submit() {
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount greater than zero");
      return;
    }
    if (!description.trim()) {
      setError("Enter a description");
      return;
    }
    setSubmitting(true);
    try {
      const res = await chargeFn({
        data: { rentalId: rental!.id, amount: amt, description: description.trim() },
      });
      if (res.mode === "link") {
        toast.success("Payment link sent to renter", {
          description: `$${Number(res.amount).toFixed(2)} — ${description.trim()}. SMS + email sent.`,
        });
      } else {
        toast.success("Charged successfully", {
          description: `$${Number(res.amount).toFixed(2)} — ${description.trim()}`,
        });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Charge failed", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!rental} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Charge for Violation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            Rental <span className="font-mono">{rental.id}</span>
            {driver?.fullName ? <> · {driver.fullName}</> : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="violation-amount">Amount (USD)</Label>
            <Input
              id="violation-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="75.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="violation-desc">Description</Label>
            <Input
              id="violation-desc"
              placeholder="e.g., Parking ticket, Late return fee"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            <DollarSign className="mr-1 h-4 w-4" />
            {submitting ? "Charging…" : "Charge card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StopAutoBillDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const sendSmsFn = useServerFn(sendRentalSms);
  const settings = useAgreementSettings();
  const [submitting, setSubmitting] = useState(false);
  if (!rental) return <Dialog open={false} onOpenChange={() => {}}><DialogContent /></Dialog>;
  const d = driverById(rental.driverId);
  const v = vehicleById(rental.vehicleId);
  async function confirm() {
    if (!rental) return;
    setSubmitting(true);
    try {
      updateRental(rental.id, { autoRenew: false });
      const renterName = d?.fullName ?? rental.driverId;
      const vehLabel = v ? `${v.year} ${v.make} ${v.model} (Plate ${v.plate})` : "your vehicle";
      if (d?.phone) {
        sendSmsFn({ data: { phone: d.phone, message: `Auto-renewal has been stopped for ${vehLabel}. No further charges will be made.`, name: d.fullName } })
          .catch(e => console.error("Renter SMS failed", e));
      }
      const mgmtPhone = settings.company.damageAlertPhone?.trim();
      if (mgmtPhone) {
        sendSmsFn({ data: { phone: mgmtPhone, message: `${renterName} auto-renewal stopped`, name: "Management Alert" } })
          .catch(e => console.error("Management SMS failed", e));
      }
      toast.success("Auto-billing stopped");
      onClose();
    } catch (e) {
      toast.error("Failed to stop auto-billing", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Stop Auto-Renewal</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Stop charging for this rental? The reservation stays active, but daily/weekly charges will stop.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={confirm} disabled={submitting}>
            <Ban className="mr-1 h-4 w-4" />
            {submitting ? "Stopping…" : "Stop Auto-Renewal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
