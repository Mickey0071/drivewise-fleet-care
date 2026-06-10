import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";
import { listQuotedPartInquiries } from "@/lib/parts.functions";

type Item = {
  id: string;
  supplier_name: string;
  part_name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  quote_price: number | null;
  quote_availability: string | null;
};

function availLabel(a: string | null) {
  if (a === "in_stock") return "In stock";
  if (a === "order") return "Can order";
  if (a === "unavailable") return "Unavailable";
  return "";
}

export function PartsQuotedCard() {
  const fetchQuoted = useServerFn(listQuotedPartInquiries);
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchQuoted()
      .then((res) => active && setItems((res?.items ?? []) as Item[]))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [fetchQuoted]);

  if (!items || items.length === 0) return null;

  return (
    <Card className="mb-4 border-emerald-500/40 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <DollarSign className="h-4 w-4 text-emerald-600" /> Parts Prices In
          <Badge variant="secondary">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it) => {
          const vehicle = [it.year, it.make, it.model].filter(Boolean).join(" ");
          return (
            <button
              key={it.id}
              onClick={() => navigate({ to: "/admin/parts" })}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 text-sm">
                <div className="font-medium truncate">
                  {it.part_name}
                  {vehicle ? <span className="text-muted-foreground"> · {vehicle}</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.supplier_name} · {availLabel(it.quote_availability)}
                </div>
              </div>
              <Badge variant="default">
                {it.quote_price != null ? `$${Number(it.quote_price).toFixed(2)}` : "—"}
              </Badge>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}