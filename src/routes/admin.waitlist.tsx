import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWaitlistEntries, markWaitlistSeen, markWaitlistConverted,
} from "@/lib/waitlist.functions";
import { vehicles } from "@/lib/mock/data";
import { isVehicleBookable, addDriver, addRental, useStoreVersion } from "@/lib/mock/store";

export const Route = createFileRoute("/admin/waitlist")({
  head: () => ({ meta: [{ title: "Waitlist — Camauto Rentals" }] }),
  component: WaitlistAdminPage,
});

type Entry = {
  id: string;
  name: string;
  phone: string;
  email: string;
  license_url: string | null;
  selfie_url: string | null;
  status: string;
  converted_rental_id: string | null;
  created_at: string;
};

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleString("en-US") : "—";
}

function WaitlistAdminPage() {
  useStoreVersion();
  const list = useServerFn(listWaitlistEntries);
  const seen = useServerFn(markWaitlistSeen);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["waitlist-entries"],
    queryFn: () => list(),
    refetchInterval: 60_000,
  });
  const entries: Entry[] = (data?.entries ?? []) as any;

  // Clear the badge whenever the admin opens this tab.
  useEffect(() => {
    seen().then(() => qc.invalidateQueries({ queryKey: ["waitlist-new-count"] })).catch(() => {});
  }, [seen, qc]);

  const [assignTarget, setAssignTarget] = useState<Entry | null>(null);

  return (
    <div>
      <PageHeader title="Waitlist" subtitle="Prospective renters waiting for the next available vehicle" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">License</th>
                  <th className="px-3 py-2">Selfie</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No waitlist entries yet.
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2">{e.phone}</td>
                    <td className="px-3 py-2">{e.email}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(e.created_at)}</td>
                    <td className="px-3 py-2">
                      {e.license_url ? (
                        <a href={e.license_url} target="_blank" rel="noreferrer">
                          <img src={e.license_url} alt="license" className="h-12 w-16 rounded border object-cover" />
                        </a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {e.selfie_url ? (
                        <a href={e.selfie_url} target="_blank" rel="noreferrer">
                          <img src={e.selfie_url} alt="selfie" className="h-12 w-12 rounded-full border object-cover" />
                        </a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {e.status === "Converted" ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Converted
                        </Badge>
                      ) : (
                        <Badge variant="outline">{e.status}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.status === "Converted" ? (
                        <span className="text-xs text-muted-foreground">{e.converted_rental_id ?? ""}</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setAssignTarget(e)}>
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Assign Vehicle
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AssignVehicleDialog
        entry={assignTarget}
        onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
        onDone={() => {
          setAssignTarget(null);
          qc.invalidateQueries({ queryKey: ["waitlist-entries"] });
        }}
      />
    </div>
  );
}

function AssignVehicleDialog({
  entry, onOpenChange, onDone,
}: {
  entry: Entry | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  useStoreVersion();
  const convert = useServerFn(markWaitlistConverted);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [weeklyRate, setWeeklyRate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const available = useMemo(
    () => vehicles.filter((v) => isVehicleBookable(v.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id, vehicles.length],
  );

  useEffect(() => {
    if (entry) {
      setVehicleId("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setWeeklyRate("");
    }
  }, [entry]);

  const chosen = available.find((v) => v.id === vehicleId);
  useEffect(() => {
    if (chosen && !weeklyRate) {
      setWeeklyRate(String((chosen as any).weeklyRate ?? (chosen as any).weekly_rate ?? ""));
    }
  }, [chosen, weeklyRate]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry || !vehicleId || !startDate) throw new Error("Pick a vehicle and start date");
      const rate = Number(weeklyRate);
      if (!rate || rate <= 0) throw new Error("Enter a valid weekly rate");

      // Create the driver from the waitlist info (license/selfie images carried in).
      const driver = addDriver({
        fullName: entry.name,
        phone: entry.phone,
        email: entry.email,
        licenseImageUrl: entry.license_url ?? undefined,
      } as any);
      await (driver as any).cloudReady?.catch?.(() => {});

      // Create the reservation (defaults to pending, weekly cadence).
      const rental = addRental({
        driverId: driver.id,
        vehicleId,
        startDate,
        billingPeriod: "weekly",
        billingCadence: "weekly",
        rate,
        weeklyRate: rate,
        rateAmount: rate,
        deposit: 0,
        licenseImageUrl: entry.license_url ?? undefined,
        selfieImageUrl: entry.selfie_url ?? undefined,
      } as any);
      await (rental as any).cloudReady?.catch?.(() => {});

      await convert({ data: { id: entry.id, rentalId: rental.id } });
      return rental.id;
    },
    onSuccess: (id) => {
      toast.success(`Reservation ${id} created`);
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not assign vehicle");
    },
    onSettled: () => setSaving(false),
  });

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Vehicle — {entry?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Available Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue placeholder={available.length ? "Choose a vehicle" : "No vehicles available"} /></SelectTrigger>
              <SelectContent>
                {available.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model} · {v.plate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-start">Start date</Label>
              <Input id="wl-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-rate">Weekly rate</Label>
              <Input id="wl-rate" type="number" min="0" step="1" value={weeklyRate} onChange={(e) => setWeeklyRate(e.target.value)} placeholder="500" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!vehicleId || !startDate || !weeklyRate || saving}
            onClick={() => { setSaving(true); mutation.mutate(); }}
          >
            {saving ? "Creating…" : "Create Reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}