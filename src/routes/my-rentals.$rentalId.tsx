import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getMyRentalDetail } from "@/lib/my-rentals.functions";
import { downloadClientPacket } from "@/lib/client-packet.functions";
import { createCustomRenterPayment } from "@/lib/custom-renter-payment.functions";
import { requestRentalExtension, cancelRentalByAdmin } from "@/lib/renter-actions.functions";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Loader2, FileText, IdCard, Receipt, Download,
  AlertTriangle, Image as ImageIcon, CreditCard, CalendarPlus, MessageSquare, Ban,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/my-rentals/$rentalId")({
  head: () => ({ meta: [{ title: "Rental details — Camauto Rentals" }] }),
  component: MyRentalDetailPage,
});

type Detail = Awaited<ReturnType<typeof getMyRentalDetail>>;

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
function fmtMoney(n: number | null | undefined) {
  return `$${Number(n ?? 0).toFixed(2)}`;
}
function daysBetween(a: string, b: string | null | undefined) {
  if (!a || !b) return null;
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function MyRentalDetailPage() {
  const { rentalId } = Route.useParams();
  const fetchDetail = useServerFn(getMyRentalDetail);
  const downloadPacket = useServerFn(downloadClientPacket);
  const createPayment = useServerFn(createCustomRenterPayment);
  const extendRentalFn = useServerFn(requestRentalExtension);
  const cancelRentalFn = useServerFn(cancelRentalByAdmin);
  const { role } = useAuth();
  const isStaff = role === "admin" || role === "runner" || role === "va";
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paying, setPaying] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendWeeks, setExtendWeeks] = useState("1");
  const [extending, setExtending] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchDetail({ data: { rentalId } })
      .then(setD)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [rentalId, fetchDetail]);

  async function handleDownloadAll() {
    setDownloading(true);
    try {
      const { filename, base64, missing } = await downloadPacket({ data: { rentalId } });
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      if (missing.length) toast.warning("Some files were missing", { description: missing.join(", ") });
      else toast.success("Packet downloaded");
    } catch (e) {
      toast.error("Couldn't build packet", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDownloading(false);
    }
  }

  if (err) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <Card className="p-6 text-center text-sm text-destructive">{err}</Card>
      </div>
    );
  }
  if (!d) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const { rental, vehicle, payments, violations, extensions } = d;
  const r: any = rental;
  const duration = daysBetween(r.start_date, r.end_date ?? r.returned_at?.slice(0, 10));
  const rate = Number(r.rate ?? r.weekly_rate ?? 0);
  const periodLabel = r.billing_period === "daily" ? "day" : r.billing_period === "monthly" ? "month" : "week";
  const paid = payments.filter((p: any) => p.status === "paid");
  const totalPaid = paid.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const violationsTotal = violations.reduce((s: number, v: any) => s + Number(v.amount ?? 0), 0);
  const extensionsTotal = extensions.reduce((s: number, e: any) => s + Number(e.additional_amount ?? 0), 0);
  const baseRental = Math.max(0, totalPaid - violationsTotal);
  const lastPaidWithCard = [...paid].reverse().find((p: any) => p.method && /card|stripe/i.test(p.method));

  const canPay = r.reservation_status === "active" || r.reservation_status === "returned";
  const isActive = r.reservation_status === "active";
  const isWeekly = (r.billing_period || "weekly") === "weekly";
  const canExtend = isActive && isWeekly;
  const weeklyRate = Number(r.rate ?? r.weekly_rate ?? 0);
  const extensionCharge = weeklyRate * (Number(extendWeeks) || 0);

  async function handleExtend() {
    setExtending(true);
    try {
      const { url } = await extendRentalFn({ data: { rentalId, periods: Number(extendWeeks) } });
      window.location.href = url;
    } catch (e) {
      toast.error("Couldn't start extension", { description: e instanceof Error ? e.message : String(e) });
      setExtending(false);
    }
  }

  function handleOpenSupportSms() {
    const body = encodeURIComponent(supportMsg || "");
    window.location.href = `sms:+18666255550?&body=${body}`;
    setSupportOpen(false);
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelRentalFn({ data: { rentalId } });
      toast.success("Rental canceled");
      setCancelOpen(false);
      const updated = await fetchDetail({ data: { rentalId } });
      setD(updated);
    } catch (e) {
      toast.error("Cancel failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCancelling(false);
    }
  }

  async function handlePay() {
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt < 1) {
      toast.error("Enter an amount of at least $1");
      return;
    }
    if (amt > 10000) {
      toast.error("Maximum is $10,000");
      return;
    }
    setPaying(true);
    try {
      const { url } = await createPayment({ data: { rentalId, amount: amt, note: payNote.trim() || undefined } });
      window.location.href = url;
    } catch (e) {
      toast.error("Couldn't start payment", { description: e instanceof Error ? e.message : String(e) });
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BackLink />
        <Button size="sm" variant="outline" onClick={handleDownloadAll} disabled={downloading}>
          {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
          Download all
        </Button>
      </div>

      {/* Rental details */}
      <Card className="overflow-hidden">
        {vehicle?.image_url && (
          <div className="aspect-[16/9] w-full bg-muted">
            <img src={vehicle.image_url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <CardContent className="space-y-3 p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</div>
            <div className="text-lg font-semibold">
              {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {vehicle?.plate ? `Plate ${vehicle.plate}` : ""}
              {vehicle?.vin ? ` · VIN ${vehicle.vin}` : ""}
              {vehicle?.color ? ` · ${vehicle.color}` : ""}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Start" value={fmtDate(r.start_date)} />
            <Stat label="End" value={fmtDate(r.end_date ?? r.returned_at)} />
            <Stat label="Duration" value={duration ? `${duration} day${duration === 1 ? "" : "s"}` : "—"} />
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Documents</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          <DocRow icon={<FileText className="h-4 w-4" />} label="Rental Agreement (PDF)" url={r.agreement_pdf_url} />
          <DocRow icon={<Receipt className="h-4 w-4" />} label="Receipt (PDF)" url={r.receipt_pdf_url} />
          {isStaff && (
            <>
              <DocRow icon={<IdCard className="h-4 w-4" />} label="Driver's License" url={r.license_image_url} />
              <DocRow icon={<ImageIcon className="h-4 w-4" />} label="Selfie" url={r.selfie_image_url} />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Signature" url={r.client_signature_url} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Renter actions */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4">
          {canExtend && (
            <Button variant="outline" onClick={() => setExtendOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" /> Extend Rental
            </Button>
          )}
          <Button variant="outline" onClick={() => setSupportOpen(true)}>
            <MessageSquare className="mr-2 h-4 w-4" /> Contact Support
          </Button>
          {isStaff && isActive && (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-2 h-4 w-4" /> Cancel Rental
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Billing</CardTitle></CardHeader>
        <CardContent className="space-y-2 p-4 text-sm">
          <Row label={`Rate (${fmtMoney(rate)} / ${periodLabel})`} value={duration ? `${duration} day${duration === 1 ? "" : "s"}` : "—"} />
          <Row label="Base rental paid" value={fmtMoney(baseRental)} />
          {extensions.length > 0 && (
            <Row label={`Extensions (${extensions.length})`} value={fmtMoney(extensionsTotal)} />
          )}
          {violations.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> Violations / Incidentals
              </div>
              {violations.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between py-1 text-xs">
                  <span>{v.type} · {fmtDate(v.date_issued)}{v.notes ? ` — ${v.notes}` : ""}</span>
                  <span className="font-medium">{fmtMoney(Number(v.amount))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t pt-2">
            <Row label="Total paid" value={<span className="text-base font-semibold">{fmtMoney(totalPaid)}</span>} />
          </div>
          {lastPaidWithCard && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" /> Paid via {lastPaidWithCard.method}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments timeline */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {payments.length === 0 && <div className="p-4 text-sm text-muted-foreground">No payments recorded.</div>}
          {payments.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{fmtMoney(Number(p.amount))}</div>
                <div className="text-xs text-muted-foreground">
                  Due {fmtDate(p.due_date)}
                  {p.paid_date && ` · paid ${fmtDate(p.paid_date)}${p.method ? ` via ${p.method}` : ""}`}
                </div>
                {p.note && <div className="text-xs italic text-muted-foreground">{p.note}</div>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                p.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                p.status === "late" ? "bg-rose-100 text-rose-700" :
                "bg-amber-100 text-amber-700"
              }`}>{p.status}</span>
            </div>
          ))}
          <div className="bg-muted/30 p-3 text-xs text-muted-foreground">
            Total paid on this rental: <span className="font-semibold text-foreground">{fmtMoney(totalPaid)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Make a custom payment */}
      {canPay && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Make a payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              Pay any amount toward an extension, violation, or balance owed. $1–$10,000.
            </p>
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <div>
                <Label htmlFor="pay-amount" className="text-xs">Amount (USD)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10000"
                  step="0.01"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  disabled={paying}
                />
              </div>
              <div>
                <Label htmlFor="pay-note" className="text-xs">What's this payment for? (optional)</Label>
                <Input
                  id="pay-note"
                  type="text"
                  placeholder="Extension, Violation, Early payment…"
                  maxLength={200}
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  disabled={paying}
                />
              </div>
            </div>
            <Button onClick={handlePay} disabled={paying || !payAmount} className="w-full sm:w-auto">
              {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Pay Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Extend Rental dialog */}
      <Dialog open={extendOpen} onOpenChange={(o) => !extending && setExtendOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Extend rental</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Extend your weekly rental of the {vehicle?.year} {vehicle?.make} {vehicle?.model}.
            </p>
            <div>
              <Label className="text-xs">Extend for how long?</Label>
              <Select value={extendWeeks} onValueChange={setExtendWeeks} disabled={extending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 week (+7 days)</SelectItem>
                  <SelectItem value="2">2 weeks (+14 days)</SelectItem>
                  <SelectItem value="3">3 weeks (+21 days)</SelectItem>
                  <SelectItem value="4">4 weeks (+28 days)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between">
                <span>{extendWeeks} week{extendWeeks === "1" ? "" : "s"} × {fmtMoney(weeklyRate)}</span>
                <span className="font-semibold">{fmtMoney(extensionCharge)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)} disabled={extending}>Cancel</Button>
            <Button onClick={handleExtend} disabled={extending}>
              {extending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Confirm Extension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Support dialog */}
      <Dialog open={supportOpen} onOpenChange={setSupportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Contact Support</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Send to</Label>
              <Input value="1-866-625-5550" readOnly />
            </div>
            <div>
              <Label htmlFor="support-msg" className="text-xs">Your message</Label>
              <Textarea
                id="support-msg"
                rows={4}
                placeholder="How can we help?"
                value={supportMsg}
                onChange={(e) => setSupportMsg(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Opens your phone's messaging app with the number and message pre-filled.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupportOpen(false)}>Cancel</Button>
            <Button onClick={handleOpenSupportSms}>
              <MessageSquare className="mr-2 h-4 w-4" /> Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Cancel confirmation */}
      <AlertDialog open={cancelOpen} onOpenChange={(o) => !cancelling && setCancelOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this rental?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately cancel the reservation, free the vehicle, and SMS the renter. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep rental</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel rental
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/my-rentals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> All rentals
    </Link>
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DocRow({ icon, label, url }: { icon: React.ReactNode; label: string; url: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">View</a>
      ) : (
        <span className="text-xs text-muted-foreground">Not on file</span>
      )}
    </div>
  );
}