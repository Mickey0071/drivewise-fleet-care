import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inspections, vehicleById, fmtDate } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/inspections")({
  head: () => ({ meta: [{ title: "Inspection History — Camauto Rentals" }] }),
  component: InspectionsPage,
});

function InspectionsPage() {
  useStoreVersion();
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const [openId, setOpenId] = useState<string | null>(null);

  const myName = typeof window !== "undefined" ? localStorage.getItem("inspector_name") || "" : "";

  const rows = useMemo(() => {
    const all = [...inspections].sort((a, b) => (b.submittedAt ?? b.createdAt ?? b.date).localeCompare(a.submittedAt ?? a.createdAt ?? a.date));
    if (isAdmin) return all;
    return all.filter(i =>
      (myName && i.inspectorName?.toLowerCase() === myName.toLowerCase()) ||
      (user?.id && i.completedBy === user.id)
    );
  }, [isAdmin, myName, user?.id]);

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Inspection History" : "My Inspection History"}
        subtitle={isAdmin ? "Audit log of all submitted vehicle inspections" : "Inspections you have submitted"}
      />
      <Card>
        <CardContent className="space-y-2 py-4">
          {rows.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No inspections yet.</div>
          )}
          {rows.map(i => {
            const v = vehicleById(i.vehicleId);
            const fails = i.checklistItems ? Object.values(i.checklistItems).filter(x => x === "fail").length : 0;
            return (
              <div key={i.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>{v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : i.vehicleId}</span>
                    {i.readyToRent === false && <Badge variant="destructive">Needs mechanic</Badge>}
                    {i.readyToRent === true && <Badge variant="secondary">Ready</Badge>}
                    {fails > 0 && <Badge variant="outline">{fails} fail{fails === 1 ? "" : "s"}</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {fmtDate(i.date)} · {i.mileage.toLocaleString()} mi
                    {i.inspectorName && ` · ${i.inspectorName}`}
                    {i.jobType && ` · ${i.jobType.replace(/_/g, " ")}`}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setOpenId(i.id)}>View</Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <InspectionDetailDialog inspectionId={openId} open={!!openId} onOpenChange={(v) => !v && setOpenId(null)} />
    </div>
  );
}
