import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createDriverSetupIntent, saveDriverCard } from "@/lib/driver-card.functions";
import { refreshStoreFromCloud } from "@/lib/mock/store";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  driverId: string;
  driverName?: string;
  onSaved?: () => void;
}

function CardForm({
  driverId,
  onDone,
}: {
  driverId: string;
  onDone: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const saveFn = useServerFn(saveDriverCard);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: submitErr } = await elements.submit();
      if (submitErr) throw new Error(submitErr.message || "Card details invalid");

      const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (confirmErr) throw new Error(confirmErr.message || "Could not save card");

      const pmId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;
      if (!pmId) throw new Error("No payment method returned");

      const res = await saveFn({
        data: { driverId, paymentMethodId: pmId, environment: getStripeEnvironment() },
      });
      if (!res.ok) throw new Error(res.error || "Could not save card");

      toast.success("Card saved", {
        description: res.last4 ? `•••• ${res.last4}` : undefined,
      });
      await refreshStoreFromCloud();
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Could not save card", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement options={{ fields: { billingDetails: { name: "auto" } } }} />
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={!stripe || submitting} className="w-full">
          {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1 h-4 w-4" />}
          {submitting ? "Saving…" : "Save Card"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function AddCardDialog({ open, onOpenChange, driverId, driverName, onSaved }: Props) {
  const setupFn = useServerFn(createDriverSetupIntent);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !driverId) return;
    setClientSecret(null);
    setLoadError(null);
    setLoading(true);
    setupFn({ data: { driverId, environment: getStripeEnvironment() } })
      .then((res) => {
        if (!res.ok || !res.clientSecret) throw new Error(res.error || "Could not start card setup");
        setClientSecret(res.clientSecret);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driverId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Add / Update Card
          </DialogTitle>
        </DialogHeader>
        {driverName && (
          <p className="text-xs text-muted-foreground">Saving a card on file for {driverName}.</p>
        )}
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing secure form…
          </div>
        )}
        {loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {loadError}
          </div>
        )}
        {clientSecret && (
          <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <CardForm
              driverId={driverId}
              onDone={() => {
                onSaved?.();
                onOpenChange(false);
              }}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
