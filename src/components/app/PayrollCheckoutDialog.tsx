import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createPayrollFundingSession } from "@/lib/payroll-funding.functions";
import { Loader2 } from "lucide-react";

const PUBLISHABLE_KEY = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise && PUBLISHABLE_KEY) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payrollRunId: string;
  amountCents: number;
  description: string;
}

export function PayrollCheckoutDialog({ open, onOpenChange, payrollRunId, amountCents, description }: Props) {
  const createSession = useServerFn(createPayrollFundingSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setClientSecret(null); setError(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await createSession({
          data: {
            payrollRunId,
            amountCents,
            description,
            returnUrl: `${window.location.origin}/payroll-return`,
          },
        });
        if (!cancelled) setClientSecret(res.clientSecret);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to start checkout");
      }
    })();
    return () => { cancelled = true; };
  }, [open, payrollRunId, amountCents, description, createSession]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Fund payroll · {payrollRunId}</DialogTitle>
          <DialogDescription>Charge your debit or credit card to fund this payroll run.</DialogDescription>
        </DialogHeader>
        <div className="bg-muted/30">
          {!PUBLISHABLE_KEY && (
            <div className="p-6 text-sm text-destructive">Payments not configured. Missing publishable key.</div>
          )}
          {error && <div className="p-6 text-sm text-destructive">{error}</div>}
          {!error && PUBLISHABLE_KEY && !clientSecret && (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing secure checkout…
            </div>
          )}
          {clientSecret && PUBLISHABLE_KEY && (
            <div className="min-h-[480px]">
              <EmbeddedCheckoutProvider stripe={getStripe()!} options={{ clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
