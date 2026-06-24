import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPortalData, createPortalPayment } from "@/lib/portal.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Car, CalendarDays, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/$token")({
  head: () => ({
    meta: [
      { title: "Your Rental Portal — Camauto Rentals" },
      { name: "description", content: "View your reservation, extensions, and make a payment." },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalPage,
});

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString() : "—";

function StatusBadge({ status }: { status: string }) {
  if (status === "signed_paid")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">signed · paid</Badge>;
  if (status === "signed_due")
    return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">signed · due</Badge>;
  return <Badge className="bg-blue-500 hover:bg-blue-500 text-white">link sent</Badge>;
}

function PortalPage() {
  const { token } = Route.useParams();
  const getData = useServerFn(getPortalData);
  const payFn = useServerFn(createPortalPayment);
  const [amount, setAmount] = useState("");
  const [paying, setPaying] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal", token],
    queryFn: () => getData({ data: { token } }),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-sm w-full">
          <CardHeader>
            <CardTitle>Link unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "This link is invalid or has expired."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const r = data.reservation;
  const v = r.vehicle;
  const vehicleName =
    [v.year, v.make, v.model].filter(Boolean).join(" ") || "Your vehicle";

  async function handlePay() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter an amount to pay");
      return;
    }
    setPaying(true);
    try {
      const res = await payFn({ data: { token, amount: amt } });
      window.location.href = res.url;
    } catch (e) {
      toast.error("Could not start payment", {
        description: e instanceof Error ? e.message : String(e),
      });
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-6 px-4">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-bold">Camauto Rentals</h1>
          <p className="text-sm text-muted-foreground">Your rental portal</p>
        </div>

        <Tabs defaultValue="reservation" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="reservation">Reservation</TabsTrigger>
            <TabsTrigger value="extensions">Extensions</TabsTrigger>
            <TabsTrigger value="pay">Pay</TabsTrigger>
          </TabsList>

          {/* Tab 1 — Reservation */}
          <TabsContent value="reservation">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Car className="h-4 w-4" /> {vehicleName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Plate" value={v.plate ?? "—"} />
                <Row label="Start date" value={fmtDate(r.startDate)} />
                <Row label="Current end date" value={fmtDate(r.endDate)} />
                <Row
                  label="Rate"
                  value={`${fmt(r.rate)} / ${r.rateCadence === "weekly" ? "week" : "day"}`}
                />
                <div className="border-t pt-3 space-y-3">
                  <Row label="Total charged to date" value={fmt(r.totalCharged)} />
                  <Row label="Total paid to date" value={fmt(r.totalPaid)} />
                  <Row
                    label="Balance owed"
                    value={fmt(Math.max(0, r.balance))}
                    strong
                    highlight={r.balance > 0}
                  />
                  {r.balance < 0 && (
                    <p className="text-xs text-emerald-600">
                      Credit on file: {fmt(Math.abs(r.balance))}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2 — Extensions */}
          <TabsContent value="extensions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" /> Extensions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.extensions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No extensions on this reservation.</p>
                )}
                {data.extensions.map((e) => (
                  <div key={e.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{e.label}</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {fmtDate(e.startDate)} – {fmtDate(e.endDate)}
                      {e.days != null ? ` · ${e.days} day${e.days === 1 ? "" : "s"}` : ""}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <span className="text-muted-foreground">Charged</span>
                      <span className="text-right">{fmt(e.amountCharged)}</span>
                      <span className="text-muted-foreground">Paid</span>
                      <span className="text-right">{fmt(e.amountPaid)}</span>
                      {e.paymentDate && (
                        <>
                          <span className="text-muted-foreground">Payment</span>
                          <span className="text-right">
                            {fmtDate(e.paymentDate)}
                            {e.paymentMethod ? ` · ${e.paymentMethod}` : ""}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3 — Make a payment */}
          <TabsContent value="pay">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" /> Make a payment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg bg-muted p-3 space-y-2">
                  <Row label="Balance owed" value={fmt(Math.max(0, r.balance))} strong />
                  <Row label="Next due date" value={fmtDate(r.nextDueDate)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amt">Amount to pay</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="amt"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter any amount you'd like to pay.
                  </p>
                </div>
                <Button className="w-full" onClick={handlePay} disabled={paying}>
                  {paying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting…
                    </>
                  ) : (
                    "Pay via Stripe"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  highlight,
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          (strong ? "font-semibold " : "") +
          (highlight ? "text-destructive" : "")
        }
      >
        {value}
      </span>
    </div>
  );
}
