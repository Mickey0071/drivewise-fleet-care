import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inspections, vehicleById, rentalById, driverById, fmtDate } from "@/lib/mock/data";
import { Camera, Upload } from "lucide-react";

export const Route = createFileRoute("/inspections")({
  head: () => ({ meta: [{ title: "Inspections — Camauto Rentals" }] }),
  component: InspectionsPage,
});

function InspectionsPage() {
  return (
    <div>
      <PageHeader title="Inspection Tool" subtitle="Document vehicle condition at check-in and check-out" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">New inspection</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option>check-in</option><option>check-out</option></select></Field>
              <Field label="Vehicle"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option>V-001 GRN-241</option><option>V-002 GRN-118</option></select></Field>
              <Field label="Mileage"><Input placeholder="42180" /></Field>
              <Field label="Fuel level %"><Input placeholder="100" /></Field>
            </div>
            <Field label="Damage noted">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">No</Button>
                <Button variant="outline" size="sm" className="flex-1">Yes</Button>
              </div>
            </Field>
            <div className="rounded-md border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <Camera className="mx-auto mb-2 h-6 w-6" />
              Tap to capture or upload damage photos
            </div>
            <Button className="w-full"><Upload className="mr-2 h-4 w-4" />Submit inspection</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent inspections</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {inspections.map(i => {
              const v = vehicleById(i.vehicleId);
              const r = rentalById(i.rentalId);
              const d = r ? driverById(r.driverId) : null;
              return (
                <div key={i.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{v?.year} {v?.make} {v?.model} · {v?.plate}</div>
                    <StatusBadge status={i.type} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fmtDate(i.date)} · {i.mileage.toLocaleString()} mi · Fuel {i.fuelLevel}%
                    {d && ` · ${d.fullName}`}
                  </div>
                  {i.damageNoted && <div className="mt-2 text-xs font-medium text-destructive">Damage flagged</div>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}
