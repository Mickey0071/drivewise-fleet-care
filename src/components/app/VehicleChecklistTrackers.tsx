import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ClipboardList, DollarSign } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Link } from "@tanstack/react-router";
import { fmtDate, fmtMoney } from "@/lib/mock/data";
import { TRACKER_TYPES, trackerTypeLabel } from "@/lib/prerental-checklist-items";
import {
  listTrackerItems,
  addTrackerItem,
  deleteTrackerItem,
  listVehicleChecklists,
  startVehicleChecklist,
  getVehiclePurchase,
  setVehiclePurchase,
} from "@/lib/prerental-checklist.functions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function VehicleChecklistTrackers({ vehicleId, plate }: { vehicleId: string; plate: string }) {
  const listFn = useServerFn(listTrackerItems);
  const addFn = useServerFn(addTrackerItem);
  const delFn = useServerFn(deleteTrackerItem);
  const checklistsFn = useServerFn(listVehicleChecklists);
  const startFn = useServerFn(startVehicleChecklist);
  const purchaseFn = useServerFn(getVehiclePurchase);
  const savePurchaseFn = useServerFn(setVehiclePurchase);

  const { data: trackers = [], refetch } = useQuery({
    queryKey: ["trackers", vehicleId],
    queryFn: () => listFn({ data: { vehicleId } }),
  });
  const { data: checklists = [], refetch: refetchChecklists } = useQuery({
    queryKey: ["vehicle-checklists"],
    queryFn: () => checklistsFn({}),
  });
  const { data: purchase, refetch: refetchPurchase } = useQuery({
    queryKey: ["vehicle-purchase", vehicleId],
    queryFn: () => purchaseFn({ data: { vehicleId } }),
  });

  const mine = checklists.filter((c) => c.vehicleId === vehicleId);
  const latest = mine[0];

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("oil_change");
  const [description, setDescription] = useState("");
  const [parts, setParts] = useState("");
  const [installedDate, setInstalledDate] = useState(today());
  const [installedBy, setInstalledBy] = useState("");
  const [cost, setCost] = useState("");
  const [nextDue, setNextDue] = useState("");

  const [price, setPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [savingPurchase, setSavingPurchase] = useState(false);

  function pickType(v: string) {
    setType(v);
    const months = TRACKER_TYPES.find((t) => t.value === v)?.monthsUntilNext;
    setNextDue(months ? addMonths(installedDate || today(), months) : "");
  }

  async function submit() {
    setBusy(true);
    try {
      await addFn({
        data: {
          vehicleId,
          trackerType: type,
          description,
          partsInstalled: parts,
          installedDate,
          installedBy,
          cost: cost === "" ? null : Number(cost),
          nextServiceDue: nextDue || null,
        },
      });
      toast.success("Tracker added");
      setOpen(false);
      setDescription(""); setParts(""); setInstalledBy(""); setCost("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function savePurchase() {
    setSavingPurchase(true);
    try {
      await savePurchaseFn({
        data: { vehicleId, price: price === "" ? null : Number(price), date: purchaseDate || null },
      });
      toast.success("Purchase price saved");
      refetchPurchase();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingPurchase(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Purchase price */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" /> Purchase price
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Purchase price ($)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={price !== "" ? price : purchase?.price != null ? String(purchase.price) : ""}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label>Purchase date</Label>
            <Input
              type="date"
              value={purchaseDate || purchase?.date || ""}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={savePurchase} disabled={savingPurchase}>
              {savingPurchase ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checklist status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> Pre-rental checklist
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setBusy(true);
                try {
                  await startFn({ data: { vehicleId } });
                  toast.success("Checklist created — send it to a runner");
                  refetchChecklists();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not create");
                } finally { setBusy(false); }
              }}
              disabled={busy}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New checklist
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/admin/checklists">Manage</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {!latest ? (
            <p className="text-muted-foreground">
              No checklist yet for {plate}. This vehicle can't be listed as available until one is completed.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={latest.status === "completed" ? "default" : "secondary"}>{latest.status.replace("_", " ")}</Badge>
              <span className="text-muted-foreground">Created {fmtDate(latest.createdAt)}</span>
              {latest.assignedRunnerName && <span className="text-muted-foreground">· {latest.assignedRunnerName}</span>}
              <span className="text-success">{latest.passed} pass</span>
              {latest.failed > 0 && <span className="font-semibold text-destructive">{latest.failed} fail</span>}
              {latest.vehicleCanList && <span className="text-success">Ready to list</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trackers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Trackers — maintenance installed</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add tracker
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {trackers.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No tracker entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Parts installed</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Installed by</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trackers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{trackerTypeLabel(t.trackerType)}</TableCell>
                    <TableCell className="text-sm">{t.description ?? "—"}</TableCell>
                    <TableCell className="text-sm">{t.partsInstalled ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(t.installedDate)}</TableCell>
                    <TableCell className="text-sm">{t.installedBy ?? "—"}</TableCell>
                    <TableCell className="text-sm">{t.cost != null ? fmtMoney(t.cost) : "—"}</TableCell>
                    <TableCell className="text-sm">{t.nextServiceDue ? fmtDate(t.nextServiceDue) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm("Delete this tracker entry?")) return;
                          try {
                            await delFn({ data: { id: t.id } });
                            refetch();
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Could not delete");
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add tracker</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Tracker type</Label>
              <Select value={type} onValueChange={pickType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRACKER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was done" />
            </div>
            <div className="sm:col-span-2">
              <Label>Parts installed</Label>
              <Input value={parts} onChange={(e) => setParts(e.target.value)} placeholder="What was replaced / added" />
            </div>
            <div>
              <Label>Installation date</Label>
              <Input type="date" value={installedDate} onChange={(e) => setInstalledDate(e.target.value)} />
            </div>
            <div>
              <Label>Installed by</Label>
              <Input value={installedBy} onChange={(e) => setInstalledBy(e.target.value)} placeholder="Mechanic / runner" />
            </div>
            <div>
              <Label>Cost ($)</Label>
              <Input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div>
              <Label>Next service due</Label>
              <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add tracker"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
