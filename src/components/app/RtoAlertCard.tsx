import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { rtoSummary } from "@/lib/rto";
import { loadRtoContracts } from "@/lib/rto-data";

/** Dashboard alert: newly signed rent-to-own agreements and late payments. */
export function RtoAlertCard() {
  const { data } = useQuery({
    queryKey: ["rto-contracts"],
    queryFn: () => loadRtoContracts(supabase),
    refetchInterval: 60_000,
  });
  if (!data) return null;
  const signed = data.filter((c) => c.status === "signed" && !c.staff_seen);
  const late = data.filter((c) => (c.status === "active" || c.status === "signed") && rtoSummary(c.terms, c.payments).daysLate > 0);
  if (!signed.length && !late.length) return null;
  return (
    <Card className="mb-4 border-primary/40 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-primary">
          <Handshake className="h-4 w-4" /> Rent To Own
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {signed.map((c) => <div key={c.id}>✍️ {c.customer_name} signed — ready to review</div>)}
        {late.map((c) => {
          const s = rtoSummary(c.terms, c.payments);
          return <div key={c.id} className={s.inDefault ? "text-destructive" : ""}>⏰ {c.customer_name} is {s.daysLate} day{s.daysLate === 1 ? "" : "s"} late{s.inDefault ? " — in default" : ""}</div>;
        })}
        <Link to="/rent-to-own" className="underline">Open Rent To Own →</Link>
      </CardContent>
    </Card>
  );
}
