import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Send, Eye, RotateCcw, Lock, Plus } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { vehicles, fmtDate } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { listRunners } from "@/lib/runners.functions";
import {
  listVehicleChecklists,
  startVehicleChecklist,
  sendChecklistTask,
  getChecklistDetail,
  reopenChecklist,
  lockVehicleForChecklist,
  type ChecklistSummaryRow,
} from "@/lib/prerental-checklist.functions";

export const Route = createFileRoute("/admin/checklists")({
  head: () => ({
    meta: [
      { title: "Pre-Rental Checklists — Camauto Rentals" },
      { name: "description", content: "Assign, track and review pre-rental vehicle inspection checklists." },
      { property: "og:title", content: "Pre-Rental Checklists — Camauto Rentals" },
      { property: "og:description", content: "Assign, track and review pre-rental vehicle inspection checklists." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChecklistsPage,
});

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    in_progress: "bg-warning/20 text-warning-foreground",
    completed: "bg-success/15 text-success",
    failed: "bg-destructive/15 text-destructive",
  };
  const label: Record<string, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    failed: "Failed",
  };
  return <Badge className={cn("border-transparent", map[status] ?? map.pending)}>{label[status] ?? status}</Badge>;
}

function ChecklistsPage() {
  useStoreVersion();
  const listFn = useServerFn(listVehicleChecklists);
  const startFn = useServerFn(startVehicleChecklist);
  const sendFn = useServerFn(sendChecklistTask);
  const detailFn = useServerFn(getChecklistDetail);
  const reopenFn = useServerFn(reopenChecklist);
  const lockFn = useServerFn(lockVehicleForChecklist);
  const runnersFn = useServerFn(listRunners);

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["vehicle-checklists"],
    queryFn: () => listFn({}),
  });
  const { data: runners = [] } = useQuery({ queryKey: ["runners"], queryFn: () => runnersFn({}) });

  const [newOpen, setNewOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState("");
  const [sendFor, setSendFor] = useState<ChecklistSummaryRow | null>(null);
  const [runnerId, setRunnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: detail } = useQuery({
    queryKey: ["checklist-detail", detailId],
    queryFn: () => detailFn({ data: { id: detailId! } }),
    enabled: !!detailId,
  });

  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "in_progress").length;
  const overdue = rows.filter(
    (r) => r.status === "pending" && Date.now() - new Date(r.createdAt).getTime() > 864e5,
  ).length;

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => !v.archived).sort((a, b) => a.plate.localeCompare(b.plate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles.length],
  );

  async function createChecklist() {
    if (!newVehicle) { toast.error("Pick a vehicle"); return; }
    setBusy(true);
    try {
      await startFn({ data: { vehicleId: newVehicle } });
      toast.success("Checklist created");
      setNewOpen(false);
      setNewVehicle("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create checklist");
    } finally {
      setBusy(false);
    }
  }

  async function dispatch() {
    if (!sendFor) return;
    const runner = runners.find((r) => r.id === runnerId);
    if (!runner) { toast.error("Pick a runner"); return; }
    setBusy(true);
    try {
      const res = await sendFn({
        data: {
          checklistId: sendFor.id,
          runnerId: runner.id,
          runnerName: runner.name,
          runnerPhone: runner.phone,
          adminName: "Camauto",
        },
      });
      toast[res.smsStatus === "sent" ? "success" : "warning"](
        res.smsStatus === "sent" ? `Checklist texted to ${runner.name}` : "Saved, but the text failed to send",
      );
      setSendFor(null);
      setRunnerId("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send checklist");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pre-Rental Checklists"
        subtitle={`${pendingCount} awaiting completion${overdue ? ` · ${overdue} overdue` : ""}`}
        action={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New checklist
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pending checklists" value={pendingCount} tone={pendingCount ? "warning" : "muted"} />
        <Stat label="Overdue (24h+)" value={overdue} tone={overdue ? "danger" : "muted"} />
        <Stat label="Completed" value={rows.filter((r) => r.status === "completed").length} tone="success" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> All checklists
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No checklists yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Runner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.plate}
                      <div className="text-xs text-muted-foreground">{r.vehicleLabel}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.assignedRunnerName ?? "Unassigned"}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-success">{r.passed} pass</span>
                      {r.failed > 0 && <span className="ml-2 font-semibold text-destructive">{r.failed} fail</span>}
                      {r.na > 0 && <span className="ml-2 text-muted-foreground">{r.na} n/a</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button size="sm" variant="outline" onClick={() => { setSendFor(r); setRunnerId(""); }}>
                        <Send className="mr-1 h-3.5 w-3.5" />
                        {r.assignedRunnerName ? "Reassign" : "Send task"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New checklist */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New pre-rental checklist</DialogTitle></DialogHeader>
          <div>
            <Label>Vehicle</Label>
            <Select value={newVehicle} onValueChange={setNewVehicle}>
              <SelectTrigger><SelectValue placeholder="Pick a vehicle" /></SelectTrigger>
              <SelectContent>
                {activeVehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.plate} · {v.year} {v.make} {v.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={createChecklist} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to runner */}
      <Dialog open={!!sendFor} onOpenChange={(o) => !o && setSendFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send checklist to runner</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {sendFor?.plate} · {sendFor?.vehicleLabel}
          </p>
          <div>
            <Label>Runner</Label>
            <Select value={runnerId} onValueChange={setRunnerId}>
              <SelectTrigger><SelectValue placeholder="Pick a runner" /></SelectTrigger>
              <SelectContent>
                {runners.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name} · {r.phone}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {runners.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">No saved runners yet — add one on the Create Task page.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendFor(null)}>Cancel</Button>
            <Button onClick={dispatch} disabled={busy}>{busy ? "Sending…" : "Send text"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Results */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-3">
            <DialogTitle className="text-base">
              Checklist results · {detail?.plate ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {!detail ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-success">{detail.passed} passed</span>
                  <span className="font-semibold text-destructive">{detail.failed} failed</span>
                  <span className="text-muted-foreground">{detail.na} n/a</span>
                  {detail.pending > 0 && <span className="text-warning-foreground">{detail.pending} not checked</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {detail.completedByName ? `Completed by ${detail.completedByName}` : "Not yet completed"}
                  {detail.completedAt ? ` · ${fmtDate(detail.completedAt)}` : ""}
                  {detail.assignedRunnerName ? ` · assigned to ${detail.assignedRunnerName}` : ""}
                </div>
                {detail.notes && (
                  <div className="rounded border bg-muted/40 p-2 text-sm">
                    <span className="font-medium">Runner notes: </span>{detail.notes}
                  </div>
                )}
                {Array.from(new Set(detail.items.map((i) => i.category))).map((cat) => (
                  <div key={cat}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
                    <div className="divide-y rounded border">
                      {detail.items.filter((i) => i.category === cat).map((i) => (
                        <div
                          key={i.id}
                          className={cn("flex flex-col gap-0.5 px-3 py-1.5 text-sm", i.status === "fail" && "bg-destructive/5")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn(i.status === "fail" && "font-semibold text-destructive")}>{i.itemName}</span>
                            <span
                              className={cn(
                                "text-xs",
                                i.status === "pass" && "text-success",
                                i.status === "fail" && "font-semibold text-destructive",
                                i.status === "pending" && "text-warning-foreground",
                                i.status === "n/a" && "text-muted-foreground",
                              )}
                            >
                              {i.status === "pending" ? "not checked" : i.status}
                            </span>
                          </div>
                          {i.notes && <p className="text-xs text-muted-foreground">{i.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <DialogFooter className="gap-2 border-t px-6 py-3">
            <Button
              variant="outline"
              disabled={!detail || busy}
              onClick={async () => {
                if (!detail) return;
                setBusy(true);
                try {
                  await reopenFn({ data: { id: detail.id } });
                  toast.success("Checklist reopened");
                  refetch();
                  setDetailId(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not reopen");
                } finally { setBusy(false); }
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen checklist
            </Button>
            <Button
              variant="destructive"
              disabled={!detail || busy}
              onClick={async () => {
                if (!detail) return;
                setBusy(true);
                try {
                  await lockFn({ data: { id: detail.id } });
                  toast.success("Vehicle locked until a new checklist passes");
                  refetch();
                  setDetailId(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not lock vehicle");
                } finally { setBusy(false); }
              }}
            >
              <Lock className="mr-1.5 h-4 w-4" /> Lock vehicle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "muted" | "warning" | "danger" | "success" }) {
  const toneClass = {
    muted: "text-muted-foreground",
    warning: "text-warning-foreground",
    danger: "text-destructive",
    success: "text-success",
  }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
      </CardContent>
    </Card>
  );
}
