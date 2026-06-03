import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getRenterPortal,
  createRenterCustomPayment,
  submitExtensionRequest,
  submitSupportRequest,
} from "@/lib/renter-portal.functions";
import { getRenterHistoryByRentalId } from "@/lib/my-rentals.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, CreditCard, CheckCircle2, Clock, History, ChevronRight,
  CalendarPlus, MessageSquare, FileText, Receipt, Download, Phone,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/rent/portal/$rentalId")({
  head: () => ({ meta: [{ title: "Your reservation — Camauto Rentals" }] }),
  component: PortalRouteComponent,
});

function PortalRouteComponent() {
  const { rentalId } = Route.useParams();
  return <PortalPage rentalId={rentalId} />;
}

type Info = Awaited<ReturnType<typeof getRenterPortal>>;

function fmtMoney(n: number) {
  return `$${Number(n).toFixed(2)}`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

export function PortalPage({ rentalId }: { rentalId: string }) {
  const fetchInfo = useServerFn(getRenterPortal);
  const payCustom = useServerFn(createRenterCustomPayment);
  const extendFn = useServerFn(submitExtensionRequest);
  const supportFn = useServerFn(submitSupportRequest);
  const fetchHistory = useServerFn(getRenterHistoryByRentalId);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<any>>([]);

  // Payment
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);

  // Extension
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendWeeks, setExtendWeeks] = useState("1");
  const [extendReason, setExtendReason] = useState("");
  const [extending, setExtending] = useState(false);

  // Support
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");
  const [supporting, setSupporting] = useState(false);

  useEffect(() => {
    fetchInfo({ data: { rentalId } })
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    fetchHistory({ data: { rentalId } })
      .then((res) => setHistory(res.rentals ?? []))
      .catch(() => { /* non-fatal */ });
  }, [rentalId, fetchInfo, fetchHistory]);

  async function handlePay() {
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt < 1) { toast.error("Enter an amount of at least $1"); return; }
    if (amt > 10000) { toast.error("Maximum is $10,000"); return; }
    setPaying(true);
    try {
      const { url } = await payCustom({ data: { rentalId, amount: amt, note: "Portal payment" } });
      window.location.href = url;
    } catch (e) {
      toast.error("Could not start payment", { description: e instanceof Error ? e.message : String(e) });
      setPaying(false);
    }
  }

  async function handleExtend() {
    setExtending(true);
    try {
      const res = await extendFn({ data: { rentalId, periods: Number(extendWeeks), reason: extendReason.trim() || undefined } });
      toast.success("Extension requested", {
        description: `We'll confirm a new return date of ${fmtDate(res.newEndDate)}. Our team will be in touch.`,
      });
      setExtendOpen(false);
      setExtendReason("");
    } catch (e) {
      toast.error("Could not request extension", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExtending(false);
    }
  }

  async function handleSupport() {
    if (supportMsg.trim().length < 3) { toast.error("Please describe your issue"); return; }
    setSupporting(true);
    try {
      const res = await supportFn({ data: { rentalId, message: supportMsg.trim() } });
      toast.success(`Ticket ${res.ticketId} created`, { description: "Our support team will reach out shortly." });
      setSupportOpen(false);
      setSupportMsg("");
    } catch (e) {
      toast.error("Could not send message", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSupporting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="p-6 text-center">
          <p className="font-medium text-destructive">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Please contact Camauto Rentals if you believe this is a mistake.
          </p>
        </Card>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { rental, vehicle, driver, payments } = info;
  const periodLabel =
    rental.billing_period === "daily" ? "day" : rental.billing_period === "monthly" ? "month" : "week";
  const rate = Number(rental.rate ?? rental.weekly_rate ?? 0);
  const next = payments.find((p) => p.status !== "paid") ?? null;
  const balance = payments
    .filter((p) => p.status !== "paid")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const pastRentals = history.filter((h) => h.id !== rentalId);
  const isActive = (rental.reservation_status ?? "pending") === "active";
  const isWeekly = (rental.billing_period || "weekly") === "weekly";

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-center pb-2">
        <img src={logo} alt="Camauto Rentals" className="h-12 object-contain" />
      </header>

      <div className="text-center">
        <h1 className="text-2xl font-semibold">Hi{driver?.full_name ? `, ${driver.full_name.split(" ")[0]}` : ""} 👋</h1>
        <p className="text-sm text-muted-foreground">Manage your rental with Camauto Rentals.</p>
      </div>

      <Tabs defaultValue="current" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="current">Current Rental</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        {/* ---------------- Current Rental ---------------- */}
        <TabsContent value="current" className="space-y-4">
          <Card className="overflow-hidden">
            {vehicle?.image_url && (
              <div className="aspect-[16/9] w-full bg-muted">
                <img src={vehicle.image_url} alt="vehicle" className="h-full w-full object-cover" />
              </div>
            )}
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Your vehicle</div>
                  <div className="text-lg font-semibold">
                    {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "—"}
                  </div>
                  {vehicle?.plate && (
                    <div className="text-xs text-muted-foreground">Plate {vehicle.plate}</div>
                  )}
                </div>
                <ReservationStatusBadge status={rental.reservation_status ?? "pending"} />
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2 text-sm">
                <Stat label="Starts" value={fmtDate(rental.start_date)} />
                <Stat label="Ends" value={fmtDate(rental.end_date)} />
                <Stat label="Rate" value={`${fmtMoney(rate)}/${periodLabel}`} />
              </div>
            </CardContent>
          </Card>

          {/* Payment section */}
          <Card className={balance > 0 ? "border-primary/40 bg-primary/5" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Make a payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</div>
                <div className="text-3xl font-bold">{fmtMoney(balance)}</div>
                {next && balance > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">Next due {fmtDate(next.due_date)}</div>
                )}
              </div>

              {balance === 0 ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> You're all paid up — thank you!
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pay the full balance or enter a custom amount below.
                </p>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <Label htmlFor="pay-amount" className="text-xs">Amount (USD)</Label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="pay-amount"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      max="10000"
                      step="0.01"
                      className="pl-6"
                      placeholder="0.00"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      disabled={paying}
                    />
                  </div>
                </div>
                {balance > 0 && (
                  <Button type="button" variant="outline" onClick={() => setPayAmount(balance.toFixed(2))} disabled={paying}>
                    Full {fmtMoney(balance)}
                  </Button>
                )}
              </div>
              <Button className="w-full" size="lg" onClick={handlePay} disabled={paying || !payAmount}>
                {paying ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                ) : (
                  <><CreditCard className="mr-2 h-4 w-4" /> Pay Now</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setExtendOpen(true)} disabled={!isActive || !isWeekly}>
              <CalendarPlus className="mr-2 h-4 w-4" /> Request Extension
            </Button>
            <Button variant="outline" onClick={() => setSupportOpen(true)}>
              <MessageSquare className="mr-2 h-4 w-4" /> Contact Support
            </Button>
          </div>

          {/* Payment history */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Payment history</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {payments.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No payments scheduled yet.</div>
              )}
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{fmtMoney(Number(p.amount))}</div>
                    <div className="text-xs text-muted-foreground">
                      Due {fmtDate(p.due_date)}
                      {p.paid_date && ` · paid ${fmtDate(p.paid_date)}${p.method ? ` via ${p.method}` : ""}`}
                    </div>
                  </div>
                  <PaymentStatusBadge status={p.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- History ---------------- */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" /> Past rentals
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {pastRentals.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No previous rentals yet.</div>
              )}
              {pastRentals.map((h) => (
                <div key={h.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {h.vehicle ? `${h.vehicle.year} ${h.vehicle.make} ${h.vehicle.model}` : "Vehicle"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(h.start_date)} → {h.end_date ? fmtDate(h.end_date) : "—"}
                      {h.vehicle?.plate ? ` · Plate ${h.vehicle.plate}` : ""}
                    </div>
                  </div>
                  <ReservationStatusBadge status={h.reservation_status ?? "completed"} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Invoices & Receipts ---------------- */}
        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">This rental</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              <DocRow icon={<FileText className="h-4 w-4" />} label="Rental Agreement (PDF)" url={(rental as any).agreement_pdf_url} />
              <DocRow icon={<Receipt className="h-4 w-4" />} label="Receipt (PDF)" url={(rental as any).receipt_pdf_url} />
            </CardContent>
          </Card>

          {pastRentals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Past rentals</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border p-0">
                {pastRentals.map((h) => (
                  <div key={h.id} className="space-y-1 p-3">
                    <div className="text-sm font-medium">
                      {h.vehicle ? `${h.vehicle.year} ${h.vehicle.make} ${h.vehicle.model}` : "Vehicle"}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtDate(h.start_date)}</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {h.agreement_pdf_url ? (
                        <a href={h.agreement_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <FileText className="h-3.5 w-3.5" /> Agreement
                        </a>
                      ) : null}
                      {h.receipt_pdf_url ? (
                        <a href={h.receipt_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <Receipt className="h-3.5 w-3.5" /> Receipt
                        </a>
                      ) : null}
                      {!h.agreement_pdf_url && !h.receipt_pdf_url && (
                        <span className="text-xs text-muted-foreground">No documents available</span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-center text-sm">
        <div className="flex items-center justify-center gap-2 font-medium">
          <Phone className="h-4 w-4" /> Need help?
        </div>
        <p className="text-xs text-muted-foreground">
          Call or text us at <a href="tel:+18666255550" className="font-medium text-primary">1-866-625-5550</a>, or use Contact Support above.
        </p>
      </div>

      {/* Extension dialog */}
      <Dialog open={extendOpen} onOpenChange={(o) => !extending && setExtendOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request an extension</DialogTitle>
            <DialogDescription>Tell us how much longer you need the vehicle. Our team will confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="ext-weeks" className="text-xs">Additional weeks</Label>
              <Input
                id="ext-weeks"
                type="number"
                min="1"
                max="12"
                value={extendWeeks}
                onChange={(e) => setExtendWeeks(e.target.value)}
                className="mt-1"
                disabled={extending}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Estimated cost: {fmtMoney(rate * (Number(extendWeeks) || 0))}
              </p>
            </div>
            <div>
              <Label htmlFor="ext-reason" className="text-xs">Reason (optional)</Label>
              <Textarea
                id="ext-reason"
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                className="mt-1"
                rows={3}
                maxLength={300}
                disabled={extending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)} disabled={extending}>Cancel</Button>
            <Button onClick={handleExtend} disabled={extending}>
              {extending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Support dialog */}
      <Dialog open={supportOpen} onOpenChange={(o) => !supporting && setSupportOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact support</DialogTitle>
            <DialogDescription>Describe your issue and our team will reach out.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="support-msg" className="text-xs">Your message</Label>
            <Textarea
              id="support-msg"
              value={supportMsg}
              onChange={(e) => setSupportMsg(e.target.value)}
              className="mt-1"
              rows={4}
              maxLength={1000}
              placeholder="e.g. Vehicle has an issue with the AC"
              disabled={supporting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupportOpen(false)} disabled={supporting}>Cancel</Button>
            <Button onClick={handleSupport} disabled={supporting || supportMsg.trim().length < 3}>
              {supporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocRow({ icon, label, url }: { icon: ReactNode; label: string; url: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between p-3 text-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">Not available</span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function ReservationStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Active", cls: "bg-emerald-100 text-emerald-700" },
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-700" },
    completed: { label: "Completed", cls: "bg-zinc-100 text-zinc-700" },
    cancelled: { label: "Cancelled", cls: "bg-rose-100 text-rose-700" },
  };
  const s = map[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-700" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function PaymentStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Paid
      </span>
    );
  }
  if (status === "late") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
        <Clock className="h-3 w-3" /> Late
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <Clock className="h-3 w-3" /> Due
    </span>
  );
}