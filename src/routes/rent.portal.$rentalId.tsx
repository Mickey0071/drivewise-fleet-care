import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRenterPortal, createRenterPaymentLink } from "@/lib/renter-portal.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CreditCard, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo-full.jpeg";

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
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    fetchInfo({ data: { rentalId } })
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [rentalId, fetchInfo]);

  async function handlePay(paymentId: string) {
    setPayingId(paymentId);
    try {
      const { url } = await createLink({ data: { rentalId, paymentId } });
      window.location.href = url;
    } catch (e) {
      toast.error("Could not start payment", { description: e instanceof Error ? e.message : String(e) });
      setPayingId(null);
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