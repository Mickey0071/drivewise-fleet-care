import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { getPayrollFundingStatus } from "@/lib/payroll-funding.functions";
import { PageHeader } from "@/components/app/PageHeader";

const Search = z.object({ session_id: z.string().optional() });

export const Route = createFileRoute("/payroll-return")({
  validateSearch: (s) => Search.parse(s),
  head: () => ({ meta: [{ title: "Payment confirmation — Camauto Rentals" }] }),
  component: PayrollReturnPage,
});

function PayrollReturnPage() {
  const { session_id } = useSearch({ from: "/payroll-return" });
  const getStatus = useServerFn(getPayrollFundingStatus);
  const [state, setState] = useState<{ loading: boolean; ok: boolean; msg: string; amount: number; runId: string | null }>({
    loading: true, ok: false, msg: "", amount: 0, runId: null,
  });

  useEffect(() => {
    if (!session_id) { setState({ loading: false, ok: false, msg: "Missing session id", amount: 0, runId: null }); return; }
    (async () => {
      try {
        const res = await getStatus({ data: { sessionId: session_id } });
        const ok = res.paymentStatus === "paid" || res.status === "complete";
        setState({ loading: false, ok, msg: ok ? "Payment received" : `Status: ${res.paymentStatus}`, amount: res.amountTotal, runId: res.payrollRunId });
      } catch (e: any) {
        setState({ loading: false, ok: false, msg: e?.message ?? "Failed to verify", amount: 0, runId: null });
      }
    })();
  }, [session_id, getStatus]);

  return (
    <div>
      <PageHeader title="Payroll funding" subtitle="Card charge confirmation" />
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          {state.loading ? (
            <><Loader2 className="h-10 w-10 animate-spin text-primary" /><p>Verifying your payment…</p></>
          ) : state.ok ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-success" />
              <h2 className="text-xl font-semibold">Funds received</h2>
              <p className="text-sm text-muted-foreground">${(state.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} captured for {state.runId ?? "payroll"}.</p>
              <Button asChild className="mt-2"><Link to="/payroll">Back to Payroll</Link></Button>
            </>
          ) : (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <h2 className="text-xl font-semibold">Payment not completed</h2>
              <p className="text-sm text-muted-foreground">{state.msg}</p>
              <Button asChild variant="outline" className="mt-2"><Link to="/payroll">Back to Payroll</Link></Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
