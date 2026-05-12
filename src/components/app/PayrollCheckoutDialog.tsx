import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createPayrollFundingSession } from "@/lib/payroll-funding.functions";
import { Loader2, Check, ArrowLeft, ArrowRight, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

type Step = 0 | 1 | 2;
const STEPS = ["Review", "Payment", "Confirm"] as const;

export function PayrollCheckoutDialog({ open, onOpenChange, payrollRunId, amountCents, description }: Props) {
  const createSession = useServerFn(createPayrollFundingSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setError(null);
      setStep(0);
      setLoading(false);
    }
  }, [open]);

  async function goToPayment() {
    setLoading(true);
    setError(null);
    try {
      const res = await createSession({
        data: {
          payrollRunId,
          amountCents,
          description,
          returnUrl: `${window.location.origin}/payroll-return`,
        },
      });
      setClientSecret(res.clientSecret);
      setStep(1);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start checkout");
    } finally {
      setLoading(false);
    }
  }

  const dollars = (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Fund payroll · {payrollRunId}</DialogTitle>
          <DialogDescription>Step {step + 1} of {STEPS.length} · {STEPS[step]}</DialogDescription>
          <Stepper current={step} />
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto bg-muted/30">
          {!PUBLISHABLE_KEY && (
            <div className="p-6 text-sm text-destructive">Payments not configured. Missing publishable key.</div>
          )}

          {step === 0 && (
            <div className="space-y-4 p-6">
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount due</div>
                <div className="mt-1 text-3xl font-bold">{dollars}</div>
                <div className="mt-3 text-sm text-muted-foreground">{description}</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-sm">
                <div className="flex justify-between py-1"><span className="text-muted-foreground">Reference</span><span className="font-medium">{payrollRunId}</span></div>
                <div className="flex justify-between py-1"><span className="text-muted-foreground">Method</span><span className="font-medium">Debit / credit card</span></div>
                <div className="flex justify-between py-1"><span className="text-muted-foreground">Processor</span><span className="font-medium">Stripe</span></div>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Card details are entered on Stripe's secure checkout in the next step.
              </p>
              {error && <div className="text-sm text-destructive">{error}</div>}
            </div>
          )}

          {step === 1 && (
            <div className="min-h-[480px]">
              {error && <div className="p-6 text-sm text-destructive">{error}</div>}
              {!error && !clientSecret && (
                <div className="flex items-center justify-center p-12 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing secure checkout…
                </div>
              )}
              {clientSecret && PUBLISHABLE_KEY && (
                <EmbeddedCheckoutProvider
                  stripe={getStripe()!}
                  options={{ clientSecret, onComplete: () => setStep(2) }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-7 w-7 text-primary" />
              </div>
              <div>
                <div className="text-lg font-semibold">Payment submitted</div>
                <p className="mt-1 text-sm text-muted-foreground">{dollars} is being charged. You'll see confirmation in payments shortly.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-background p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 0 || step === 2}
            onClick={() => setStep(0)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {step === 0 && (
            <Button size="sm" disabled={loading || !PUBLISHABLE_KEY} onClick={goToPayment}>
              {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1 h-4 w-4" />}
              Continue to payment <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 1 && (
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {step === 2 && (
            <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done && "bg-primary text-primary-foreground",
                active && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn("text-xs", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}
