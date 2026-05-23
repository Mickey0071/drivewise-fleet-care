import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicles, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, updateRental, markReturnedAwaitingInspection, getInspectionsForRental, addInspection, addMaintenance, extendRental, computeExtensionCharge, prunePendingReservations, pendingExpiresAt, cancelReservation, captureSignature, markReservationPaid, ensureRentalSynced, currentPeriodPaid, isVehicleBookable, swapVehicle } from "@/lib/mock/store";
import { calcCurrentPeriodEnd } from "@/lib/mock/store";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useEffect, useRef, useState } from "react";
import { Car, Truck, ClipboardCheck, CheckCircle2, CalendarPlus, FileSignature, Clock, DollarSign, X as XIcon, Receipt, MessageSquare, Printer, Send, PackageCheck, ListChecks, Mail, Copy, ChevronDown, ArrowLeftRight, Undo2, Ban, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { SignaturePad } from "@/components/app/SignaturePad";
import logoUrl from "@/assets/camauto-logo-full.jpeg";
import { StripeRentalCheckout } from "@/components/StripeEmbeddedCheckout";
import { NotifyRenterDialog } from "@/components/app/NotifyRenterDialog";
import { NewTaskDialog } from "@/components/app/NewTaskDialog";
import { ReturnVehicleDialog } from "@/components/app/ReturnVehicleDialog";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendRentalSms } from "@/lib/rental-sms.functions";
import { chargeViolation } from "@/lib/violation-charge.functions";
import { startReturnInspection } from "@/lib/inspection.functions";
import { useAgreementSettings } from "@/lib/agreementSettings";
import { sendSigningLink, getSigningLink } from "@/lib/sign.functions";
import { generateAgreementPdf } from "@/lib/agreement-pdf.functions";
import { downloadClientPacket } from "@/lib/client-packet.functions";
import { generateReceiptPdf } from "@/lib/receipt.functions";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import type { Rental } from "@/lib/mock/data";

const getPublicAppOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Reservations — Camauto Rentals" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    paid: typeof search.paid === "string" ? search.paid : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: RentalsPage,
});

const AGREEMENT_VERSION = "v1.0";

function RentalsPage() {
  const navigate = Route.useNavigate();
  const { paid } = Route.useSearch();
  const { user, role } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Rental | null>(null);
  const [delivering, setDelivering] = useState<Rental | null>(null);
  const [returning, setReturning] = useState<Rental | null>(null);
  const [extending, setExtending] = useState<Rental | null>(null);
  const [swapping, setSwapping] = useState<Rental | null>(null);
  const [stoppingAutoBill, setStoppingAutoBill] = useState<Rental | null>(null);
  const [viewingAgreement, setViewingAgreement] = useState<Rental | null>(null);
  const [signing, setSigning] = useState<Rental | null>(null);
  const [taskRental, setTaskRental] = useState<Rental | null>(null);
  const [returnChoiceRental, setReturnChoiceRental] = useState<Rental | null>(null);
  const [returnDispatchRental, setReturnDispatchRental] = useState<Rental | null>(null);
  const [charging, setCharging] = useState<Rental | null>(null);
  const [violationFor, setViolationFor] = useState<Rental | null>(null);
  const [receipt, setReceipt] = useState<Rental | null>(null);
  const [chatting, setChatting] = useState<Rental | null>(null);
  const [detail, setDetail] = useState<Rental | null>(null);
  // (Mark as Returned now opens the full Return Inspection dialog directly.)
  const sendSmsFn = useServerFn(sendRentalSms);
  const sendSignLinkFn = useServerFn(sendSigningLink);
  const getSignLinkFn = useServerFn(getSigningLink);
  const sendPayLinkFn = useServerFn(sendPaymentLink);
  const [payLinkSendingId, setPayLinkSendingId] = useState<string | null>(null);
  const genPdfFn = useServerFn(generateAgreementPdf);
  const [pdfRegenId, setPdfRegenId] = useState<string | null>(null);
  const genReceiptFn = useServerFn(generateReceiptPdf);
  const [receiptRegenId, setReceiptRegenId] = useState<string | null>(null);
  const downloadPacketFn = useServerFn(downloadClientPacket);
  const [packetId, setPacketId] = useState<string | null>(null);

  async function handleDownloadPacket(r: Rental) {
    setPacketId(r.id);
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
      if (res.missing.length > 0) {
        toast.warning("Packet downloaded — some items missing", {
          description: res.missing.join(", "),
          duration: 8000,
        });
      } else {
        toast.success("Client packet downloaded");
      }
    } catch (e) {
      toast.error("Download failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPacketId(null);
    }
  }
  useStoreVersion();
  // Notify staff when a remote signature arrives (via realtime) and the
  // reservation flips from pending → active.
  const seenSignedRef = useRef<Set<string>>(new Set());
  const startInspectionFn = useServerFn(startReturnInspection);
  const inspectionSettings = useAgreementSettings();
  // Track previous reservationStatus per rental so we only fire the runner
  // inspection SMS on the transition into "active" (a.k.a. "On Rent"), not
  // on every render of an already-active rental.
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const sentInspectionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevStatusRef.current;
    for (const r of rentals) {
      const status = r.reservationStatus ?? "active";
      const previous = prev.get(r.id);
      prev.set(r.id, status);
      // First time we see this rental — record baseline only.
      if (previous === undefined) continue;
      // Only act on transitions FROM pending INTO active (vehicle picked up).
      if (previous === "active" || status !== "active") continue;
      if (sentInspectionRef.current.has(r.id)) continue;
      sentInspectionRef.current.add(r.id);
      const v = vehicleById(r.vehicleId);
      if (!v) continue;
      const runnerPhone = inspectionSettings.company.runnerInspectionPhone?.trim();
      if (!runnerPhone) {
        toast.warning("No runner inspection phone configured", {
          description: "Set it under Rental Agreement → Company.",
        });
        continue;
      }
      startInspectionFn({ data: {
        vehicleId: v.id,
        rentalId: r.id,
        runnerPhone,
        origin: getPublicAppOrigin(),
        vehicleLabel: `${v.year} ${v.make} ${v.model} (${v.plate})`,
      }})
        .then(() => toast.success("Runner inspection link sent"))
        .catch(e => {
          sentInspectionRef.current.delete(r.id);
          toast.error("Could not send inspection link", {
            description: e instanceof Error ? e.message : String(e),
          });
        });
    }
  });
  useEffect(() => {
    for (const r of rentals) {
      const key = `${r.id}:${r.signatureDataUrl ? 1 : 0}:${r.reservationStatus ?? "active"}`;
      if (seenSignedRef.current.has(key)) continue;
      // First pass: just record current state, don't toast.
      if (seenSignedRef.current.size === 0) { seenSignedRef.current.add(key); continue; }
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
  });
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
            {!isPending && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs uppercase text-muted-foreground">Next payment</div>
                {next ? (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-medium">{fmtMoney(next.amount)} due {fmtDate(next.dueDate)}</span>
                    <StatusBadge status={next.status} />
                  </div>
                ) : <div className="mt-1 text-sm text-muted-foreground">All paid</div>}
              </div>
            )}
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
                    disabled={!!r.paymentReceived || payLinkSendingId === r.id}
                    onClick={async () => {
                      const d = driverById(r.driverId);
                      const v = vehicleById(r.vehicleId);
                      if (!d?.phone) { toast.error("No phone on file for renter"); return; }
                      const amount = Number(r.rate ?? r.weeklyRate ?? 0);
                      if (amount < 0.5) { toast.error("Set a rate before sending a payment link"); return; }
                      const periodLbl = r.billingPeriod === "daily" ? "day" : r.billingPeriod === "monthly" ? "month" : "week";
                      setPayLinkSendingId(r.id);
                      try {
                        await ensureRentalSynced(r.id);
                        await sendPayLinkFn({ data: {
                          phone: d.phone,
                          name: d.fullName,
                          amountCents: Math.round(amount * 100),
                          description: `First ${periodLbl} — ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim(),
                          environment: getStripeEnvironment(),
                          rentalId: r.id,
                        } });
                        toast.success("Payment link texted to renter", { description: d.phone });
                      } catch (e) {
                        const msg = e instanceof Error ? (e.stack || e.message) : String(e);
                        console.error("[sendPaymentLink] failed:", e);
                        toast.error("Could not send payment link", {
                          description: msg,
                          duration: 15000,
                        });
                      } finally {
                        setPayLinkSendingId(null);
                      }
                    }}
                  >
                    <Send className="mr-1 h-4 w-4" />
                    {r.paymentReceived ? "Paid ✓" : payLinkSendingId === r.id ? "Sending…" : "Send Payment Link"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setCharging(r)}
                    disabled={!!r.paymentReceived}
                  >
                    <DollarSign className="mr-1 h-4 w-4" />
                    {r.paymentReceived ? "Paid ✓" : "Charge Now"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!r.paymentReceived}
                    onClick={() => {
                      if (!confirm(`Record cash payment of ${fmtMoney(r.rate ?? r.weeklyRate)} for ${r.id}?`)) return;
                      const activated = markReservationPaid(r.id);
                      toast.success(activated ? "Cash payment recorded — reservation activated" : "Cash payment recorded");
                    }}
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
                  {!r.endDate && getInspectionsForRental(r.id).every(i => i.type !== "check-out") && (
                    <Button size="sm" onClick={() => setDelivering(r)}>
                      <Truck className="mr-1 h-4 w-4" /> Deliver vehicle
                    </Button>
                  )}
                  {!r.endDate && (
                    <Button size="sm" onClick={() => setReturning(r)}>
                      <PackageCheck className="mr-1 h-4 w-4" /> Mark as Returned
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setReturnChoiceRental(r)}>
                    <Undo2 className="mr-1 h-4 w-4" /> Return Vehicle
                  </Button>
                  {!r.endDate && (
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
                  {role === "admin" && (
                    <Button variant="outline" size="sm" onClick={() => setViolationFor(r)}>
                      <DollarSign className="mr-1 h-4 w-4" /> Charge for Violation
                    </Button>
                  )}
                  {r.signatureDataUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setViewingAgreement(r)}>
                      <FileSignature className="mr-1 h-4 w-4" /> View agreement
                    </Button>
                  )}
                  {r.agreementPdfUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      title={r.agreementPdfGeneratedAt ? `Generated ${new Date(r.agreementPdfGeneratedAt).toLocaleString()}` : undefined}
                      onClick={() => window.open(r.agreementPdfUrl!, "_blank", "noopener")}
                    >
                      📄 Agreement PDF
                    </Button>
                  ) : (r.clientSignedAt || r.signedAt) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pdfRegenId === r.id}
                      onClick={async () => {
                        setPdfRegenId(r.id);
                        try {
                          const res = await genPdfFn({ data: { rentalId: r.id } });
                          if (res?.url) {
                            toast.success("Agreement PDF generated");
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
                    >
                      📄 {pdfRegenId === r.id ? "Generating…" : "Regenerate PDF"}
                    </Button>
                  ) : null}
                  {r.receiptPdfUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      title={r.receiptPdfGeneratedAt ? `Generated ${new Date(r.receiptPdfGeneratedAt).toLocaleString()}` : undefined}
                      onClick={() => window.open(r.receiptPdfUrl!, "_blank", "noopener")}
                    >
                      📄 Receipt
                    </Button>
                  ) : r.paymentReceived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={receiptRegenId === r.id}
                      onClick={async () => {
                        setReceiptRegenId(r.id);
                        try {
                          const res = await genReceiptFn({ data: { rentalId: r.id } });
                          if (res?.url) {
                            toast.success("Receipt PDF generated");
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
                    >
                      📄 {receiptRegenId === r.id ? "Generating…" : "Generate Receipt"}
                    </Button>
                  ) : null}
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
                  <Button variant="ghost" size="sm" onClick={() => setReceipt(r)}>
                    <Receipt className="mr-1 h-4 w-4" /> Receipt
                  </Button>
                  {role === "admin" && (
                    <Button variant="ghost" size="sm" onClick={() => setTaskRental(r)}>
                      <Send className="mr-1 h-4 w-4" /> Send Task
                    </Button>
                  )}
                </>
              )}
            </div>
            {!isPending && !r.endDate && (
              <RentalCardTabs rental={r} />
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
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm font-semibold hover:bg-muted/60 transition-colors">
            <span>On Rent <span className="ml-1.5 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{active.length}</span></span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 [[data-state=open]>svg]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1.5 pt-2">
            {active.length === 0 ? <EmptyState label="No vehicles currently on rent." /> : active.map(renderRow)}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm font-semibold hover:bg-muted/60 transition-colors">
            <span>Pending <span className="ml-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">{pending.length}</span></span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 [[data-state=open]>svg]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1.5 pt-2">
            {pending.length === 0 ? (
              <EmptyState label="No pending reservations. New reservations are held here for 24h until signature + payment." />
            ) : pending.map(renderRow)}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm font-semibold hover:bg-muted/60 transition-colors">
            <span>Returned <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{completed.length}</span></span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 [[data-state=open]>svg]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1.5 pt-2">
            {completed.length === 0 ? <EmptyState label="No returned rentals yet." /> : completed.map(renderRow)}
          </CollapsibleContent>
        </Collapsible>
      </div>
      <NewReservationDialog open={newOpen} onOpenChange={setNewOpen} />
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
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
      <AgreementDialog rental={viewingAgreement} onClose={() => setViewingAgreement(null)} />
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
      <ReceiptDialog rental={receipt} onClose={() => setReceipt(null)} />
      <NotifyRenterDialog
        open={!!chatting}
        onOpenChange={(o) => !o && setChatting(null)}
        renterName={chatting ? (driverById(chatting.driverId)?.fullName ?? "") : ""}
        phone={chatting ? (driverById(chatting.driverId)?.phone ?? "") : ""}
      />
      <NewTaskDialog
        open={!!taskRental}
        onOpenChange={(o) => { if (!o) setTaskRental(null); }}
        prefill={taskRental ? (() => {
          const v = vehicleById(taskRental.vehicleId);
          const d = driverById(taskRental.driverId);
          const vLabel = v ? `${v.year} ${v.make} ${v.model}` : taskRental.vehicleId;
          return {
            linked_vehicle_id: taskRental.vehicleId,
            linked_rental_id: taskRental.id,
            address: d?.streetAddress ?? d?.address ?? "",
            description: `Pickup ${vLabel} from ${d?.fullName ?? "renter"}`,
          };
        })() : undefined}
      />
      <ReturnVehicleDialog
        rental={returnChoiceRental}
        onClose={() => setReturnChoiceRental(null)}
        onDispatchRunner={(r) => {
          setReturnChoiceRental(null);
          setReturnDispatchRental(r);
        }}
      />
      <NewTaskDialog
        open={!!returnDispatchRental}
        onOpenChange={(o) => { if (!o) setReturnDispatchRental(null); }}
        prefill={returnDispatchRental ? (() => {
          const v = vehicleById(returnDispatchRental.vehicleId);
          const d = driverById(returnDispatchRental.driverId);
          const vLabel = v
            ? `${v.year} ${v.make} ${v.model} ${v.plate}`
            : returnDispatchRental.vehicleId;
          return {
            task_type: "pickup" as const,
            linked_vehicle_id: returnDispatchRental.vehicleId,
            linked_rental_id: returnDispatchRental.id,
            address: d?.streetAddress ?? d?.address ?? "",
            description: `Retrieve ${vLabel} from ${d?.fullName ?? "renter"}`,
            mode: "return" as const,
          };
        })() : undefined}
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
                <Input id="dl-mi" type="number" value={mileage} onChange={e => setMileage(Number(e.target.value))} />
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
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const checkout = rental ? getInspectionsForRental(rental.id).find(i => i.type === "check-out") : undefined;
  const sendSmsFn = useServerFn(sendRentalSms);
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
  function confirm() {
    if (!rental || !v) return;
    if (!completedBy.trim()) { toast.error("Who received the vehicle?"); return; }
    if (mileage < (checkout?.mileage ?? 0)) { toast.error("Return mileage can't be less than delivery mileage"); return; }
    const missing = RETURN_CHECKLIST.filter(item => !check[item]);
    if (missing.length > 0) {
      toast.error("Complete the return checklist", { description: `${missing.length} item(s) remaining` });
      return;
    }
    addInspection({
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
    const checklistSummary = `Return checklist: ${RETURN_CHECKLIST.length}/${RETURN_CHECKLIST.length} verified by ${completedBy.trim()}`;
    const noteParts = [rental.notes, checklistSummary, notes.trim() ? `Return: ${notes.trim()}` : ""].filter(Boolean);
    updateRental(rental.id, { notes: noteParts.join(" · ") });
    try { localStorage.removeItem(`return-checklist:${rental.id}`); } catch { /* ignore */ }
    markReturnedAwaitingInspection(rental.id);
    const drove = checkout ? mileage - checkout.mileage : 0;
    toast.success("Vehicle returned — awaiting runner inspection", {
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
                <Input id="rt-mi" type="number" value={mileage} onChange={e => setMileage(Number(e.target.value))} />
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
          <div><Label>Weekly rate</Label><Input type="number" value={weeklyRate} onChange={e => setWeeklyRate(Number(e.target.value))} /></div>
          <div><Label>Deposit</Label><Input type="number" value={depositPaid} onChange={e => setDepositPaid(Number(e.target.value))} /></div>
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
            <Input type="number" min={0} value={rateAmount} onChange={e => setRateAmount(Number(e.target.value))} />
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
  const sendSmsFn = useServerFn(sendRentalSms);
  const [newEndDate, setNewEndDate] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (rental) {
      const base = rental.endDate ? new Date(rental.endDate) : new Date();
      base.setDate(base.getDate() + 7);
      setNewEndDate(base.toISOString().slice(0, 10));
      setSig(null);
      setAccepted(false);
    }
  }, [rental]);
  const charge = rental && newEndDate ? computeExtensionCharge(rental, newEndDate) : null;
  function confirm() {
    if (!rental || !newEndDate || !d) return;
    if (rental.endDate && newEndDate <= rental.endDate) {
      toast.error("New end date must be after the current end date");
      return;
    }
    if (!accepted) { toast.error("Renter must accept the extension addendum"); return; }
    if (!sig) { toast.error("Signature required for the addendum"); return; }
    const ext = extendRental(rental.id, newEndDate, {
      signatureDataUrl: sig,
      signedBy: d.fullName,
      agreementVersion: AGREEMENT_VERSION,
    });
    if (d.phone) {
      const amountStr = ext && ext.additionalAmount > 0 ? ` Amount due: ${fmtMoney(ext.additionalAmount)}.` : "";
      const msg = `Camauto Rentals: Your rental of the ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""} has been extended through ${fmtDate(newEndDate)}.${amountStr} Reply with any questions.`;
      sendSmsFn({ data: { phone: d.phone, message: msg.slice(0, 1000), name: d.fullName } })
        .catch(e => console.error("Extension SMS failed", e));
    }
    toast.success("Rental extended", {
      description: `${v?.year} ${v?.make} ${v?.model} → ${fmtDate(newEndDate)}${ext && ext.additionalAmount > 0 ? ` · ${fmtMoney(ext.additionalAmount)} added to receipt` : ""}`,
    });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Extend rental</DialogTitle></DialogHeader>
        {rental && v && d && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Current end date: {rental.endDate ? fmtDate(rental.endDate) : "open-ended"}
              </div>
            </div>
            <div>
              <Label htmlFor="ext-end">New end date</Label>
              <Input id="ext-end" type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
            </div>
            {charge && charge.additionalAmount > 0 && (
              <div className="rounded-md border bg-card p-3 text-sm">
                <div className="text-xs uppercase text-muted-foreground">Extension charge (added to receipt)</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span>{charge.periods} additional {charge.periodLabel}{charge.periods === 1 ? "" : "s"} × {fmtMoney(rental.rate ?? rental.weeklyRate)}</span>
                  <span className="text-lg font-bold">{fmtMoney(charge.additionalAmount)}</span>
                </div>
              </div>
            )}
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="font-semibold text-foreground">EXTENSION ADDENDUM TO RENTAL AGREEMENT {AGREEMENT_VERSION}</div>
              <p className="mt-2">
                This addendum extends the rental of <span className="font-medium text-foreground">{v.year} {v.make} {v.model} (Plate {v.plate})</span> by{" "}
                <span className="font-medium text-foreground">{charge?.periods ?? 0} {charge?.periodLabel}{(charge?.periods ?? 0) === 1 ? "" : "s"}</span>
                {rental.endDate ? <> from {fmtDate(rental.endDate)}</> : null} through{" "}
                <span className="font-medium text-foreground">{newEndDate ? fmtDate(newEndDate) : "—"}</span>.
                Renter agrees to pay an additional <span className="font-medium text-foreground">{fmtMoney(charge?.additionalAmount ?? 0)}</span> at the contracted rate of {fmtMoney(rental.rate ?? rental.weeklyRate)}/{(rental.billingPeriod ?? "weekly").replace("ly", "")}. All other terms of the original agreement remain in full force.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
              <span>I, <span className="font-medium">{d.fullName}</span>, agree to the extension and the additional charge above.</span>
            </label>
            <div>
              <Label className="mb-1 block">Renter signature (addendum)</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><CalendarPlus className="mr-1 h-4 w-4" /> Confirm extension</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  return <AgreementDialogInner rental={rental} onClose={onClose} />;
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

function AgreementDialogInner({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl p-0">
        <DialogHeader>
          <DialogTitle className="px-4 pt-4">Signed rental agreement</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="max-h-[80vh] overflow-y-auto bg-zinc-100 p-4">
            <RentalAgreement rental={rental} driver={d} vehicle={v} />
          </div>
        )}
        <DialogFooter className="px-4 pb-4">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const sched = rental ? payments.filter(p => p.rentalId === rental.id) : [];
  const baseTotal = rental ? (rental.depositPaid ?? 0) + sched.reduce((s, p) => s + p.amount, 0) : 0;
  const extTotal = rental?.extensions?.reduce((s, e) => s + e.additionalAmount, 0) ?? 0;
  const grandTotal = baseTotal + extTotal;
  const paidTotal = sched.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0) + (rental?.paymentReceived ? 0 : 0);
  const balance = grandTotal - paidTotal - (rental?.depositPaid ?? 0);

  function printReceipt() {
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win || !rental || !v || !d) return;
    const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const lines: string[] = [];
    lines.push(`<tr><td>${esc(fmtDate(rental.startDate))}</td><td>Security deposit</td><td style="text-align:right">${fmt(rental.depositPaid)}</td><td>—</td></tr>`);
    sched.forEach(p => {
      lines.push(`<tr><td>${esc(fmtDate(p.dueDate))}</td><td>Rental payment (${esc(p.status)})</td><td style="text-align:right">${fmt(p.amount)}</td><td>${esc(p.method ?? "—")}</td></tr>`);
    });
    rental.extensions?.forEach((e, i) => {
      lines.push(`<tr><td>${esc(new Date(e.extendedAt).toLocaleDateString())}</td><td>Extension addendum #${i + 1} (+${esc(e.periods)} ${esc(e.periodLabel)}${e.periods === 1 ? "" : "s"})</td><td style="text-align:right">${fmt(e.additionalAmount)}</td><td>—</td></tr>`);
    });
    win.document.write(`<!doctype html><html><head><title>Receipt ${esc(rental.id)}</title>
      <style>
        body{font-family:system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#111}
        h1{margin:0 0 4px;font-size:22px}
        .brand{display:flex;align-items:center;gap:12px;margin-bottom:8px}
        .brand img{height:56px;width:auto;object-fit:contain}
        .meta{color:#666;font-size:12px;margin-bottom:24px}
        .box{border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px;font-size:13px}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
        th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
        th{background:#f7f7f7;font-size:11px;text-transform:uppercase;color:#555}
        tfoot td{font-weight:600;border-top:2px solid #333;border-bottom:none;padding-top:10px}
        .totals{margin-top:16px;text-align:right;font-size:14px}
        .totals .grand{font-size:18px;font-weight:700;margin-top:6px}
        @media print { button{display:none} }
      </style></head><body>
      <div class="brand"><img src="${esc(new URL(logoUrl, window.location.origin).href)}" alt="Camauto"/><h1>Camauto — Receipt</h1></div>
      <div class="meta">Reservation ${esc(rental.id)} · Issued ${esc(new Date().toLocaleString())}</div>
      <div class="box">
        <strong>${esc(v.year)} ${esc(v.make)} ${esc(v.model)}</strong> · Plate ${esc(v.plate)} · VIN ${esc(v.vin)}<br/>
        Renter: ${esc(d.fullName)} · ${esc(d.phone)} · ${esc(d.email)}<br/>
        Period: ${esc(fmtDate(rental.startDate))}${rental.endDate ? ` → ${esc(fmtDate(rental.endDate))}` : " (open)"}<br/>
        Rate: ${fmt(rental.rate ?? rental.weeklyRate)} / ${esc((rental.billingPeriod ?? "weekly").replace("ly", ""))}
      </div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th>Method</th></tr></thead>
        <tbody>${lines.join("")}</tbody>
      </table>
      <div class="totals">
        Subtotal (rental + deposit): ${fmt(baseTotal)}<br/>
        Extensions: ${fmt(extTotal)}<br/>
        <div class="grand">Total: ${fmt(grandTotal)}</div>
      </div>
      ${rental.signatureDataUrl ? `<div style="margin-top:32px"><div style="font-size:11px;color:#666;text-transform:uppercase">Signed by ${esc(rental.signedBy ?? d.fullName)}</div><img src="${esc(rental.signatureDataUrl)}" style="max-width:240px;border:1px solid #ddd;padding:4px;margin-top:4px"/></div>` : ""}
      <button onclick="window.print()" style="margin-top:24px;padding:8px 16px;background:#111;color:#fff;border:0;border-radius:4px;cursor:pointer">Print / Save as PDF</button>
      </body></html>`);
    win.document.close();
  }

  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Camauto" className="h-10 w-auto object-contain" />
            <DialogTitle>Camauto Receipt — {rental?.id}</DialogTitle>
          </div>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground">
                {fmtDate(rental.startDate)}{rental.endDate ? ` → ${fmtDate(rental.endDate)}` : " · open"}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left py-1">Date</th><th className="text-left">Description</th><th className="text-right">Amount</th><th className="text-left pl-2">Method</th></tr>
              </thead>
              <tbody>
                <tr className="border-t"><td className="py-1.5">{fmtDate(rental.startDate)}</td><td>Security deposit</td><td className="text-right">{fmtMoney(rental.depositPaid)}</td><td className="pl-2">—</td></tr>
                {sched.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1.5">{fmtDate(p.dueDate)}</td>
                    <td>Rental payment <span className="text-muted-foreground">({p.status})</span></td>
                    <td className="text-right">{fmtMoney(p.amount)}</td>
                    <td className="pl-2">{p.method ?? "—"}</td>
                  </tr>
                ))}
                {rental.extensions?.map((e, i) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-1.5">{new Date(e.extendedAt).toLocaleDateString()}</td>
                    <td>Extension #{i + 1} (+{e.periods} {e.periodLabel}{e.periods === 1 ? "" : "s"})</td>
                    <td className="text-right">{fmtMoney(e.additionalAmount)}</td>
                    <td className="pl-2">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-md border bg-muted/30 p-3 text-right text-sm space-y-0.5">
              <div>Subtotal: <span className="font-medium">{fmtMoney(baseTotal)}</span></div>
              <div>Extensions: <span className="font-medium">{fmtMoney(extTotal)}</span></div>
              <div className="text-base font-bold pt-1 border-t mt-1">Total: {fmtMoney(grandTotal)}</div>
              {balance !== 0 && <div className="text-xs text-muted-foreground">Outstanding balance: {fmtMoney(Math.max(0, balance))}</div>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={printReceipt}><Printer className="mr-1 h-4 w-4" /> Print / Save PDF</Button>
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
      toast.success("Charged successfully", {
        description: `$${Number(res.amount).toFixed(2)} — ${description.trim()}`,
      });
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
