import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CarFront, CheckCircle2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listPlateReviewRentals,
  resolvePlateReview,
} from "@/lib/plate-review.functions";

export const Route = createFileRoute("/admin/malibu-plate-review")({
  head: () => ({ meta: [{ title: "Malibu Plate Review — Camauto Rentals" }] }),
  component: MalibuPlateReviewPage,
});

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString() : "—";

function MalibuPlateReviewPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPlateReviewRentals);
  const resolve = useServerFn(resolvePlateReview);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["plate-review-malibu"],
    queryFn: () => list(),
  });

  const rows = data ?? [];

  const assign = async (id: string, plate: "N90VCG" | "MVP8071") => {
    setBusyId(id);
    try {
      await resolve({ data: { id, plate } });
      toast.success(`Assigned ${plate}`);
      qc.invalidateQueries({ queryKey: ["plate-review-malibu"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign plate");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Malibu Plate Review"
        subtitle="2015 Chevrolet Malibu rentals with no color on file — pick the correct plate"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <p className="font-medium">All caught up</p>
              <p className="text-sm text-muted-foreground">
                No Malibu rentals are waiting for plate review.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Rental Dates</th>
                    <th className="p-3">Vehicle (stored)</th>
                    <th className="p-3 text-right">Assign Plate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 font-medium">{r.renter_name || "—"}</td>
                      <td className="p-3">
                        {fmtDate(r.start_datetime)} – {fmtDate(r.end_datetime)}
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1">
                          <CarFront className="h-4 w-4 text-muted-foreground" />
                          {[r.year, r.vehicle].filter(Boolean).join(" ") || "—"}
                          {r.color ? (
                            <Badge variant="secondary" className="ml-1">{r.color}</Badge>
                          ) : (
                            <Badge variant="outline" className="ml-1">no color</Badge>
                          )}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === r.id}
                            onClick={() => assign(r.id, "N90VCG")}
                            className="border-red-300 text-red-700 hover:bg-red-50"
                          >
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Assign Red N90VCG"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === r.id}
                            onClick={() => assign(r.id, "MVP8071")}
                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                          >
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Assign Blue MVP8071"
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
