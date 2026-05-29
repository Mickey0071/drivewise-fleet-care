import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRenterPortal, createRenterPaymentLink } from "@/lib/renter-portal.functions";
import { verifyCardOwner } from "@/lib/renter-portal.functions";
import { getRenterHistoryByRentalId } from "@/lib/my-rentals.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CreditCard, CheckCircle2, XCircle, Clock, History, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo-full.jpeg";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/rent/portal/$rentalId")({
  head: () => ({ meta: [{ title: "Your reservation — Camauto Rentals" }] }),
  component: PortalPage,
});

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

function PortalPage() {
  const { rentalId } = Route.useParams();
  const fetchInfo = useServerFn(getRenterPortal);
  const createLink = useServerFn(createRenterPaymentLink);
  const verifyOwner = useServerFn(verifyCardOwner);
  const fetchHistory = useServerFn(getRenterHistoryByRentalId);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<any>>([]);

  // Card verification flow (shown before redirecting to Stripe)
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [cardInName, setCardInName] = useState<"yes" | "no" | null>(null);
  const [idDataUrl, setIdDataUrl] = useState<string | null>(null);
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [payerPhone, setPayerPhone] = useState("");
  const [loadingImg, setLoadingImg] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    { verified: boolean; cardOwnerName: string | null } | null
  >(null);

  useEffect(() => {
    fetchInfo({ data: { rentalId } })
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    fetchHistory({ data: { rentalId } })
      .then((res) => setHistory(res.rentals ?? []))
      .catch(() => { /* non-fatal */ });
  }, [rentalId, fetchInfo, fetchHistory]);

  async function handlePay(paymentId: string) {
    // Ask for card verification before starting payment.
    setVerifyFor(paymentId);
    setCardInName(null);
    setIdDataUrl(null);
    setSelfieDataUrl(null);
    setVerifyResult(null);
    setPayerPhone("");
  }

  async function readImage(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function onPickImage(file: File | null, which: "id" | "selfie") {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("File must be under 8MB"); return; }
    setLoadingImg(true);
    try {
      const dataUrl = await readImage(file);
      if (which === "id") setIdDataUrl(dataUrl);
      else setSelfieDataUrl(dataUrl);
      setVerifyResult(null);
      toast.success(`${which === "id" ? "ID" : "Selfie"} added`);
    } catch (e: any) {
      toast.error(e?.message || "Could not load image");
    } finally {
      setLoadingImg(false);
    }
  }

  async function runVerification() {
    if (!idDataUrl || !selfieDataUrl) { toast.error("Upload both the ID and a selfie"); return; }
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await verifyOwner({
        data: { rentalId, idDataUrl, selfieDataUrl, payerPhone: payerPhone.trim() || undefined },
      });
      setVerifyResult({ verified: res.verified, cardOwnerName: res.cardOwnerName });
      if (!res.verified) toast.error("ID name doesn't match. Please re-upload.");
    } catch (e) {
      toast.error("Could not verify", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setVerifying(false);
    }
  }

  async function proceedToPayment() {
    const paymentId = verifyFor;
    if (!paymentId) return;
    if (cardInName === "no" && !verifyResult?.verified) {
      toast.error("Please verify the card owner's ID first");
      return;
    }
    setPayingId(paymentId);
    try {
      const { url } = await createLink({ data: { rentalId, paymentId } });
      window.location.href = url;
    } catch (e) {
      toast.error("Could not start payment", { description: e instanceof Error ? e.message : String(e) });
      setPayingId(null);
      setVerifyFor(null);
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

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-center pb-2">
        <img src={logo} alt="Camauto Rentals" className="h-12 object-contain" />
      </header>

      <div className="text-center">
        <h1 className="text-2xl font-semibold">Hi{driver?.full_name ? `, ${driver.full_name.split(" ")[0]}` : ""} 👋</h1>
        <p className="text-sm text-muted-foreground">Here's your reservation with Camauto Rentals.</p>
      </div>

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
          <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
            <Stat label="Starts" value={fmtDate(rental.start_date)} />
            <Stat label="Rate" value={`${fmtMoney(rate)}/${periodLabel}`} />
          </div>
        </CardContent>
      </Card>

      <Card className={balance > 0 ? "border-primary/40 bg-primary/5" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</div>
              <div className="text-3xl font-bold">{fmtMoney(balance)}</div>
              {next && balance > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">Next due {fmtDate(next.due_date)}</div>
              )}
            </div>
            {next && balance > 0 && (
              <Button size="lg" onClick={() => handlePay(next.id)} disabled={!!payingId}>
                {payingId === next.id ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
                ) : (
                  <><CreditCard className="mr-2 h-4 w-4" /> Make a payment</>
                )}
              </Button>
            )}
          </div>
          {balance === 0 && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> You're all paid up — thank you!
            </div>
          )}
        </CardContent>
      </Card>

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

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Questions? Reply to your text from Camauto Rentals.
      </p>

      {history.filter((h) => h.id !== rentalId).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Your rental history
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {history.filter((h) => h.id !== rentalId).map((h) => (
              <Link
                key={h.id}
                to="/my-rentals/$rentalId"
                params={{ rentalId: h.id }}
                className="flex items-center justify-between p-3 text-sm hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">
                    {h.vehicle ? `${h.vehicle.year} ${h.vehicle.make} ${h.vehicle.model}` : "Vehicle"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(h.start_date)} → {h.end_date ? fmtDate(h.end_date) : "—"}
                    {h.vehicle?.plate ? ` · Plate ${h.vehicle.plate}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
          <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
            Sign in to view full documents and receipts.
          </div>
        </Card>
      )}

      <Dialog open={!!verifyFor} onOpenChange={(o) => { if (!o && !payingId) setVerifyFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Card verification</DialogTitle>
            <DialogDescription>Is the payment card in your name?</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={cardInName === "yes" ? "default" : "outline"}
                onClick={() => { setCardInName("yes"); setPayerIdDataUrl(null); }}
              >
                Yes, it's mine
              </Button>
              <Button
                type="button"
                variant={cardInName === "no" ? "default" : "outline"}
                onClick={() => setCardInName("no")}
              >
                No
              </Button>
            </div>

            {cardInName === "no" && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div>
                  <Label htmlFor="payer-id" className="text-xs">Upload ID of card owner</Label>
                  <Input
                    id="payer-id"
                    type="file"
                    accept="image/*"
                    className="mt-1"
                    disabled={uploadingId}
                    onChange={(e) => onPickPayerId(e.target.files?.[0] ?? null)}
                  />
                  {uploadingId && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </p>
                  )}
                  {payerIdDataUrl && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> ID uploaded
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="payer-phone" className="text-xs">Card owner's phone (optional)</Label>
                  <Input
                    id="payer-phone"
                    type="tel"
                    inputMode="tel"
                    className="mt-1"
                    value={payerPhone}
                    onChange={(e) => setPayerPhone(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              disabled={
                !!payingId || cardInName === null ||
                (cardInName === "no" && (!payerIdDataUrl || uploadingId))
              }
              onClick={proceedToPayment}
            >
              {payingId ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…</>
              ) : (
                <><CreditCard className="mr-2 h-4 w-4" /> Continue to payment</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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