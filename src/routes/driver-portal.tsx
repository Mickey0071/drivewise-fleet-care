import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { drivers, rentals, payments, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { Camera, IdCard } from "lucide-react";
import { toast } from "sonner";
import { ReportActions } from "@/components/app/ReportActions";

export const Route = createFileRoute("/driver-portal")({
  head: () => ({ meta: [{ title: "Driver Portal — Camauto Rentals" }] }),
  component: DriverPortalPage,
});

function DriverPortalPage() {
  // Demo: show as Marcus Reed
  const me = drivers.find(d => d.id === "D-1001")!;
  const myRental = rentals.find(r => r.driverId === me.id)!;
  const v = vehicleById(myRental.vehicleId)!;
  const myPayments = payments.filter(p => p.driverId === me.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = myPayments.find(p => p.status !== "paid");

  return (
    <div>
      <PageHeader
        title="Driver Portal"
        subtitle={`Hi, ${me.fullName.split(" ")[0]} 👋`}
        action={
          <ReportActions csv={{
            filename: `${me.fullName.replace(/\s+/g, "_")}-history.csv`,
            headers: ["Payment ID", "Amount", "Due", "Paid", "Method", "Status", "Vehicle", "Plate"],
            rows: myPayments.map(p => [p.id, p.amount, p.dueDate, p.paidDate ?? "", p.method ?? "", p.status, `${v.year} ${v.make} ${v.model}`, v.plate]),
          }} />
        }
      />

      <Card className="mb-6 overflow-hidden">
        <div className="relative aspect-[16/9] w-full bg-muted">
          <img src={carImage(v.model)} alt={v.model} className="h-full w-full object-cover" />
        </div>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Your rental</div>
              <div className="font-semibold">{v.year} {v.make} {v.model}</div>
              <div className="text-xs text-muted-foreground">Plate {v.plate} · Started {fmtDate(myRental.startDate)}</div>
            </div>
            <StatusBadge status="active" />
          </div>
        </CardContent>
      </Card>

      {next && (
        <Card className="mb-6 border-primary/40 bg-primary/5">
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Next payment</div>
            <div className="mt-1 flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{fmtMoney(next.amount)}</div>
                <div className="text-xs text-muted-foreground">Due {fmtDate(next.dueDate)}</div>
              </div>
              <Button>Pay now</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {myPayments.map(p => (
            <div key={p.id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{fmtMoney(p.amount)}</div>
                <div className="text-xs text-muted-foreground">Due {fmtDate(p.dueDate)}{p.paidDate && ` · paid ${fmtDate(p.paidDate)}`}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="outline" className="h-auto justify-start gap-3 p-4" onClick={() => toast("Camera would open here")}>
          <Camera className="h-5 w-5 text-primary" />
          <div className="text-left">
            <div className="font-medium">Upload return photos</div>
            <div className="text-xs text-muted-foreground">For check-out inspection</div>
          </div>
        </Button>
        <Button variant="outline" className="h-auto justify-start gap-3 p-4" onClick={() => toast.success("Insurance card requested")}>
          <IdCard className="h-5 w-5 text-primary" />
          <div className="text-left">
            <div className="font-medium">Request insurance card</div>
            <div className="text-xs text-muted-foreground">Sent to your email</div>
          </div>
        </Button>
      </div>
    </div>
  );
}
