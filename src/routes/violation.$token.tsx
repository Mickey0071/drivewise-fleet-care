import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getViolationForCustomer,
  createViolationCustomerPayment,
} from "@/lib/violation-resolution.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle2,
  Loader2,
  CreditCard,
  FileSignature,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import logoUrl from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/violation/$token")({
  head: () => ({ meta: [{ title: "EZPass Violation Notice — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    paid: s.paid === "1" || s.paid === 1 ? "1" : undefined,
    signed: s.signed === "1" || s.signed === 1 ? "1" : undefined,
  }),
  component: ViolationPage,
});

function fmtMoney(n: number) {
  return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return s;
  }
}

type Data = Awaited<ReturnType<typeof getViolationForCustomer>>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-center mb-6">
          <img src={logoUrl} alt="Camauto Rentals" className="h-12" />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Phone className="inline h-3 w-3 mr-1" />
          Need help? Call (866) 625-5550
        </p>
      </div>
    </div>
  );
}

function ViolationPage() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fetchFn = useServerFn(getViolationForCustomer);
  const payFn = useServerFn(createViolationCustomerPayment);

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { token } });
        if (!cancelled) setData(r);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load violation");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchFn]);

  async function onPay() {
    setPaying(true);
    try {
      const { url } = await payFn({ data: { token } });
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message || "Could not start payment");
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
          Loading violation details…
        </Card>
      </Shell>
    );
  }

  if (err || !data || !data.found) {
    return (
      <Shell>
        <Card className="p-8 text-center space-y-2">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <div className="text-lg font-semibold">Link unavailable</div>
          <p className="text-sm text-muted-foreground">
            {err || "This link is invalid or has expired. Please call (866) 625-5550."}
          </p>
        </Card>
      </Shell>
    );
  }

  const justPaid = search.paid === "1";
  const justSigned = search.signed === "1";

  // Confirmation page (after pay/sign or already resolved)
  if (justPaid || justSigned || data.resolved) {
    const paid = justPaid || data.status === "paid";
    return (
      <Shell>
        <Card className="p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <div className="text-xl font-bold">✓ Submitted</div>
          {paid ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Thank you for your payment of {fmtMoney(data.amount)}.</p>
              <p>We'll resolve this violation with EZPass on your behalf.</p>
              <p>You'll receive a receipt by email.</p>
            </div>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Thank you for signing the affidavit.</p>
              <p>Camauto will submit your information to EZPass.</p>
              <p>You'll be contacted by EZPass directly to resolve.</p>
              <p className="font-medium text-foreground">Estimated processing: 5–10 business days.</p>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">EZPass Violation Notice</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose how you'd like to resolve this
          </p>
        </div>

        <div className="rounded-md border bg-card p-4 text-sm space-y-1">
          <div className="font-medium">
            {data.vehicle.year} {data.vehicle.make} {data.vehicle.model}
            {data.vehicle.plate ? ` (Plate: ${data.vehicle.plate})` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            Date Issued: {fmtDate(data.dateIssued)}
          </div>
          {data.location && (
            <div className="text-xs text-muted-foreground">Location: {data.location}</div>
          )}
          {(data.rentalStart || data.rentalEnd) && (
            <div className="text-xs text-muted-foreground">
              Rental Period: {fmtDate(data.rentalStart)} to{" "}
              {data.rentalEnd ? fmtDate(data.rentalEnd) : "ongoing"}
            </div>
          )}
          <div className="pt-2 flex items-baseline justify-between border-t mt-2">
            <span className="text-xs uppercase text-muted-foreground">Amount Due</span>
            <span className="text-2xl font-bold">{fmtMoney(data.amount)}</span>
          </div>
        </div>

        {/* Recommended: Sign Affidavit */}
        <div className="rounded-lg border-2 border-primary bg-primary/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            <span className="font-semibold">📝 Sign Affidavit</span>
            <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
              Recommended
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Admit responsibility and handle this directly with EZPass. We'll transfer liability to
            you with a legal affidavit.
          </p>
          <Button
            className="w-full"
            size="lg"
            onClick={() => navigate({ to: "/violation/$token/affidavit", params: { token } })}
          >
            <FileSignature className="mr-2 h-4 w-4" /> Review &amp; Sign Affidavit
          </Button>
        </div>

        {/* Pay Now */}
        <div className="rounded-lg border p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            <span className="font-semibold">💳 Pay Now</span>
            <span className="ml-auto font-semibold">{fmtMoney(data.amount)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Settle this violation directly through Camauto. We'll handle the rest with EZPass.
          </p>
          <Button
            variant="outline"
            className="w-full"
            size="lg"
            onClick={onPay}
            disabled={paying}
          >
            {paying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting to payment…
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" /> Pay {fmtMoney(data.amount)} Now
              </>
            )}
          </Button>
        </div>
      </Card>
    </Shell>
  );
}
