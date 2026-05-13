import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createWeeklyRentalCheckout, createDepositCheckout } from "@/utils/payments.functions";

export type CheckoutKind = "weekly" | "deposit";

export interface StripeCheckoutProps {
  kind: CheckoutKind;
  amountInCents: number;
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
  userId?: string;
  returnUrl?: string;
}

export function StripeRentalCheckout(props: StripeCheckoutProps) {
  const fetchClientSecret = async (): Promise<string> => {
    const payload = {
      amountInCents: props.amountInCents,
      rentalId: props.rentalId,
      customerEmail: props.customerEmail,
      customerName: props.customerName,
      userId: props.userId,
      returnUrl: props.returnUrl || window.location.href,
      environment: getStripeEnvironment(),
    };
    const fn = props.kind === "weekly" ? createWeeklyRentalCheckout : createDepositCheckout;
    const cs = await fn({ data: payload });
    if (!cs) throw new Error("Could not create checkout session");
    return cs;
  };

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}