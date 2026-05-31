import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NewTaskDialog, TASK_TYPE_OPTIONS } from "@/components/app/NewTaskDialog";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { Plus, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { resendTaskSms, approveInspectionTask, approveMechanicRunTask, approvePartsRunTask } from "@/lib/tasks.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/runners/tasks")({
  head: () => ({ meta: [{ title: "Runner Tasks — Camauto Rentals" }] }),
  component: RunnerTasksPage,
});

type TaskRow = {
  id: string;
  task_type: string;
  status: string;
  priority_level: string;
  description: string | null;
  address: string | null;
  due_date: string | null;
  runner_name: string | null;
  assigned_to_user_id: string | null;
  linked_vehicle_id: string | null;
  linked_rental_id: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  completed_at: string | null;
  completed_inspection_id: string | null;
  runner_notes: string | null;
  created_at: string;
  approved_at: string | null;
  mr_vendor_name: string | null;
  mr_contact_phone: string | null;
  mr_work_order: string | null;
  mr_dropoff_mileage: number | null;
  mr_dropoff_at: string | null;
  mr_mechanic_notes: string | null;
  mr_photos: string[] | null;
  pr_vendor_name: string | null;
  pr_contact_phone: string | null;
  pr_parts_needed: string | null;
  pr_destination: string | null;
  pr_parts_picked_up: { label: string; checked: boolean }[] | null;
  pr_cost: number | null;
  pr_photos: string[] | null;
  pr_pickup_at: string | null;
  pr_delivered_at: string | null;
  pr_delivery_notes: string | null;
};

function RunnerTasksPage() {
  const { role } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<TaskRow | null>(null);
  const [inspId, setInspId] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const resendFn = useServerFn(resendTaskSms);
  const approveFn = useServerFn(approveInspectionTask);
  const approveMrFn = useServerFn(approveMechanicRunTask);
  const approvePrFn = useServerFn(approvePartsRunTask);
  const [approving, setApproving] = useState<string | null>(null);

  async function handleResend(taskId: string) {
    setResending(taskId);
    try {
      const res = await resendFn({ data: { task_id: taskId } });
      if (res.sms_status === "sent") toast.success("SMS resent");
      else if (res.sms_status === "skipped_no_phone") toast.error("Runner has no phone on file");
      else toast.error(`SMS failed: ${res.error ?? "unknown"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setResending(null);
    }
  }

  async function handleApprove(task: TaskRow) {
    setApproving(task.id);
    try {
      const res = await approveFn({ data: { task_id: task.id } });
      toast.success(
        res.mileage != null
          ? `Fleet updated · mileage ${res.mileage.toLocaleString()} mi recorded`
          : "Inspection approved · fleet record updated",
      );
      setDetail((d) => (d && d.id === task.id ? { ...d, approved_at: res.last_inspection_at } : d));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(null);
    }
  }

  async function handleApproveMechanicRun(task: TaskRow) {
    setApproving(task.id);
    try {
      const res = await approveMrFn({ data: { task_id: task.id } });
      toast.success(`Fleet updated · vehicle in shop at ${res.vendor}`);
      setDetail((d) => (d && d.id === task.id ? { ...d, approved_at: res.approved_at } : d));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(null);
    }
  }

  async function handleApprovePartsRun(task: TaskRow) {
    setApproving(task.id);
    try {
      const res = await approvePrFn({ data: { task_id: task.id } });
      toast.success(
        res.cost != null
          ? `Approved · $${Number(res.cost).toFixed(2)} logged to maintenance`
          : "Parts run approved",
      );
      setDetail((d) => (d && d.id === task.id ? { ...d, approved_at: res.approved_at } : d));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(null);
    }
  }

  const [fStatus, setFStatus] = useState("all");
  const [fType, setFType] = useState("all");
  const [fRunner, setFRunner] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("id, task_type, status, priority_level, description, address, due_date, runner_name, assigned_to_user_id, linked_vehicle_id, linked_rental_id, year, make, model, plate, completed_at, completed_inspection_id, runner_notes, created_at, approved_at, mr_vendor_name, mr_contact_phone, mr_work_order, mr_dropoff_mileage, mr_dropoff_at, mr_mechanic_notes, mr_photos, pr_vendor_name, pr_contact_phone, pr_parts_needed, pr_destination, pr_parts_picked_up, pr_cost, pr_photos, pr_pickup_at, pr_delivered_at, pr_delivery_notes")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) return;
    setTasks((data ?? []) as TaskRow[]);
  }
  useEffect(() => { load(); }, []);

  const runners = useMemo(() => Array.from(new Set(tasks.map(t => t.runner_name).filter(Boolean) as string[])), [tasks]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (fStatus !== "all" && t.status !== fStatus) return false;
    if (fType !== "all" && t.task_type !== fType) return false;
    if (fRunner !== "all" && t.runner_name !== fRunner) return false;
    if (fFrom && (t.due_date ?? "") < fFrom) return false;
    if (fTo && (t.due_date ?? "") > fTo) return false;
    return true;
  }), [tasks, fStatus, fType, fRunner, fFrom, fTo]);

  if (role !== "admin") {
    return <div className="mx-auto max-w-xl py-10 text-center"><h1 className="text-xl font-semibold">Admins only</h1></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Runner Tasks"
        subtitle="Dispatched tasks across all runners"
        action={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> New Task</Button>}
      />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid gap-2 sm:grid-cols-5">
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TASK_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fRunner} onValueChange={setFRunner}>
              <SelectTrigger><SelectValue placeholder="Runner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All runners</SelectItem>
                {runners.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} placeholder="From" />
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} placeholder="To" />
          </div>

          {loading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : filtered.length === 0 ? <p className="text-sm text-muted-foreground">No tasks match.</p>
          : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Runner</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{t.runner_name ?? "—"}</TableCell>
                      <TableCell>{TASK_TYPE_OPTIONS.find(o => o.value === t.task_type)?.label ?? t.task_type}</TableCell>
                      <TableCell className="text-xs">{t.year ? `${t.year} ${t.make} ${t.model} ${t.plate ?? ""}` : "—"}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{t.description ?? "—"}</TableCell>
                      <TableCell className="text-xs">{t.due_date ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "completed" ? "default" : t.status === "in_progress" ? "secondary" : "outline"}>{t.status}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => setDetail(t)}>View</Button>
                        {t.status !== "completed" && t.status !== "cancelled" && (
                          <Button size="sm" variant="secondary" disabled={resending === t.id} onClick={() => handleResend(t.id)}>
                            <Send className="mr-1 h-3 w-3" />{resending === t.id ? "Sending…" : "Resend SMS"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewTaskDialog open={newOpen} onOpenChange={setNewOpen} onCreated={load} />

      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Task {detail?.id}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Runner:</span> {detail.runner_name ?? "—"}</p>
              <p><span className="text-muted-foreground">Type:</span> {TASK_TYPE_OPTIONS.find(o => o.value === detail.task_type)?.label ?? detail.task_type}</p>
              <p><span className="text-muted-foreground">Status:</span> {detail.status}</p>
              <p><span className="text-muted-foreground">Priority:</span> {detail.priority_level}</p>
              <p><span className="text-muted-foreground">Vehicle:</span> {detail.year ? `${detail.year} ${detail.make} ${detail.model} ${detail.plate ?? ""}` : "—"}</p>
              {detail.linked_rental_id && <p><span className="text-muted-foreground">Rental:</span> <Link to="/rentals" className="underline">{detail.linked_rental_id}</Link></p>}
              <p><span className="text-muted-foreground">Address:</span> {detail.address ?? "—"}</p>
              <p><span className="text-muted-foreground">Due:</span> {detail.due_date ?? "—"}</p>
              <p><span className="text-muted-foreground">Description:</span> {detail.description ?? "—"}</p>
              {detail.completed_at && <p><span className="text-muted-foreground">Completed:</span> {new Date(detail.completed_at).toLocaleString()}</p>}
              {detail.runner_notes && (
                <div>
                  <p className="text-muted-foreground">Runner notes:</p>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{detail.runner_notes}</pre>
                </div>
              )}
              {detail.completed_inspection_id && (
                <Button size="sm" variant="outline" onClick={() => setInspId(detail.completed_inspection_id)}>View Inspection</Button>
              )}
              {detail.task_type === "mechanic_run" && (
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <p className="mb-1 font-semibold">🔧 Mechanic Run</p>
                  {detail.mr_vendor_name && <p><span className="text-muted-foreground">Vendor:</span> {detail.mr_vendor_name}</p>}
                  {detail.mr_contact_phone && <p><span className="text-muted-foreground">Phone:</span> {detail.mr_contact_phone}</p>}
                  {detail.mr_work_order && <p><span className="text-muted-foreground">Work Order:</span> {detail.mr_work_order}</p>}
                  {detail.mr_dropoff_mileage != null && <p><span className="text-muted-foreground">Mileage at drop-off:</span> {detail.mr_dropoff_mileage.toLocaleString()}</p>}
                  {detail.mr_dropoff_at && <p><span className="text-muted-foreground">Drop-off:</span> {new Date(detail.mr_dropoff_at).toLocaleString()}</p>}
                  {detail.mr_mechanic_notes && <p><span className="text-muted-foreground">Mechanic notes:</span> {detail.mr_mechanic_notes}</p>}
                  {detail.mr_photos && detail.mr_photos.length > 0 && (
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {detail.mr_photos.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`Drop-off ${i + 1}`} className="h-14 w-full rounded object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detail.task_type === "mechanic_run" && detail.status === "completed" && (
                detail.approved_at ? (
                  <p className="text-xs text-emerald-600">✓ Approved & fleet updated {new Date(detail.approved_at).toLocaleString()}</p>
                ) : (
                  <Button
                    size="sm"
                    disabled={approving === detail.id}
                    onClick={() => handleApproveMechanicRun(detail)}
                  >
                    {approving === detail.id ? "Updating…" : "Approve & Update Fleet"}
                  </Button>
                )
              )}
              {detail.task_type === "parts" && (
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                  <p className="mb-1 font-semibold">📦 Parts Run</p>
                  {detail.pr_vendor_name && <p><span className="text-muted-foreground">Vendor:</span> {detail.pr_vendor_name}</p>}
                  {detail.pr_contact_phone && <p><span className="text-muted-foreground">Phone:</span> {detail.pr_contact_phone}</p>}
                  {detail.pr_parts_needed && <p><span className="text-muted-foreground">Parts needed:</span> {detail.pr_parts_needed}</p>}
                  {detail.pr_destination && <p><span className="text-muted-foreground">Destination:</span> {detail.pr_destination}</p>}
                  {detail.pr_parts_picked_up && detail.pr_parts_picked_up.length > 0 && (
                    <p><span className="text-muted-foreground">Picked up:</span> {detail.pr_parts_picked_up.filter((p) => p.checked).map((p) => p.label).join(", ") || "(none)"}</p>
                  )}
                  {detail.pr_cost != null && <p><span className="text-muted-foreground">Cost:</span> ${Number(detail.pr_cost).toFixed(2)}</p>}
                  {detail.pr_pickup_at && <p><span className="text-muted-foreground">Pickup:</span> {new Date(detail.pr_pickup_at).toLocaleString()}</p>}
                  {detail.pr_delivered_at && <p><span className="text-muted-foreground">Delivered:</span> {new Date(detail.pr_delivered_at).toLocaleString()}</p>}
                  {detail.pr_delivery_notes && <p><span className="text-muted-foreground">Delivery notes:</span> {detail.pr_delivery_notes}</p>}
                  {detail.pr_photos && detail.pr_photos.length > 0 && (
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {detail.pr_photos.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`Parts ${i + 1}`} className="h-14 w-full rounded object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detail.task_type === "parts" && detail.status === "completed" && (
                detail.approved_at ? (
                  <p className="text-xs text-emerald-600">✓ Approved & parts logged {new Date(detail.approved_at).toLocaleString()}</p>
                ) : (
                  <Button
                    size="sm"
                    disabled={approving === detail.id}
                    onClick={() => handleApprovePartsRun(detail)}
                  >
                    {approving === detail.id ? "Updating…" : "Approve & Update Fleet"}
                  </Button>
                )
              )}
              {detail.task_type === "inspection" && detail.status === "completed" && (
                detail.approved_at ? (
                  <p className="text-xs text-emerald-600">✓ Approved & fleet updated {new Date(detail.approved_at).toLocaleString()}</p>
                ) : (
                  <Button
                    size="sm"
                    className="ml-2"
                    disabled={approving === detail.id}
                    onClick={() => handleApprove(detail)}
                  >
                    {approving === detail.id ? "Updating…" : "Approve & Update Fleet"}
                  </Button>
                )
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InspectionDetailDialog
        open={!!inspId}
        onOpenChange={(v) => { if (!v) setInspId(null); }}
        inspectionId={inspId}
      />
    </div>
  );
}