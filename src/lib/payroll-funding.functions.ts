import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/stripe/v1";

const Input = z.object({
  payrollRunId: z.string().min(1).max(64),
  amountCents: z.number().int().min(50).max(5_000_000),
  description: z.string().min(1).max(200),
  returnUrl: z.string().url(),
});

export const createPayrollFundingSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const STRIPE_KEY = process.env.STRIPE_SANDBOX_API_KEY ?? process.env.STRIPE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!STRIPE_KEY) throw new Error("STRIPE_SANDBOX_API_KEY is not configured");

    const body = new URLSearchParams();
    body.append("ui_mode", "embedded");
    body.append("mode", "payment");
    body.append("return_url", `${data.returnUrl}?session_id={CHECKOUT_SESSION_ID}`);
    body.append("payment_method_types[]", "card");
    body.append("line_items[0][quantity]", "1");
    body.append("line_items[0][price_data][currency]", "usd");
    body.append("line_items[0][price_data][unit_amount]", String(data.amountCents));
    body.append("line_items[0][price_data][product_data][name]", `Payroll funding · ${data.payrollRunId}`);
    body.append("line_items[0][price_data][product_data][description]", data.description.slice(0, 200));
    body.append("metadata[payroll_run_id]", data.payrollRunId);
    body.append("metadata[purpose]", "payroll_funding");

    const res = await fetch(`${GATEWAY_URL}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": STRIPE_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = await res.json();
    if (!res.ok) {
      console.error("Stripe checkout session error", res.status, json);
      throw new Error(`Stripe error [${res.status}]: ${json?.error?.message ?? "failed to create session"}`);
    }

    return {
      clientSecret: json.client_secret as string,
      sessionId: json.id as string,
    };
  });

const StatusInput = z.object({ sessionId: z.string().min(1).max(200) });

export const getPayrollFundingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const STRIPE_KEY = process.env.STRIPE_SANDBOX_API_KEY ?? process.env.STRIPE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!STRIPE_KEY) throw new Error("STRIPE_SANDBOX_API_KEY is not configured");

    const res = await fetch(`${GATEWAY_URL}/checkout/sessions/${encodeURIComponent(data.sessionId)}`, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": STRIPE_KEY,
      },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Stripe error [${res.status}]: ${json?.error?.message ?? "failed"}`);
    return {
      status: json.status as string,
      paymentStatus: json.payment_status as string,
      amountTotal: (json.amount_total as number) ?? 0,
      payrollRunId: (json.metadata?.payroll_run_id as string) ?? null,
    };
  });
