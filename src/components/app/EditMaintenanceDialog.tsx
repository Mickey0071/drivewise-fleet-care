import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";
import { updateMaintenance, deleteMaintenance } from "@/lib/mock/store";
import { vehicleById, fmtDate, type Maintenance } from "@/lib/mock/data";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Maintenance | null;
}

export function EditMaintenanceDialog({ open, onOpenChange, record }: Props) {
  const { role } = useAuth();
  const [serviceType, setServiceType] = useState("");
  const [problemCategory, setProblemCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [dateCompleted, setDateCompleted] = useState<string>("");
  const [mileage, setMileage] = useState<string>("0");
  const [cost, setCost] = useState<string>("0");
  const [nextServiceDue, setNextServiceDue] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [inspectorName, setInspectorName] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    setServiceType(record.serviceType);
    setProblemCategory(record.problemCategory ?? "");
    setVendor(record.vendor);
    setDateCompleted(record.dateCompleted ?? "");
    setMileage(String(record.mileageAtService ?? 0));
    setCost(String(record.cost ?? 0));
    setNextServiceDue(record.nextServiceDue ?? "");
    setNotes(record.notes ?? "");
    setInspectorName(null);
    if (record.sourceInspectionId) {
      // best-effort pull inspector name for the banner
      import("@/integrations/supabase/client").then(({ supabase }) =>
        supabase
          .from("inspections")
          .select("inspector_name, completed_by")
          .eq("id", record.sourceInspectionId!)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setInspectorName((data as any).inspector_name ?? (data as any).completed_by ?? null);
          }),
      );
    }
  }, [record]);

  if (!record) return null;
  const v = vehicleById(record.vehicleId);

  const save = () => {
    const costNum = Number(cost);
    const mileageNum = Number(mileage);
    if (!serviceType.trim()) return toast.error("Service type required");
    if (!vendor.trim()) return toast.error("Vendor required");
    if (!Number.isFinite(costNum) || costNum < 0) return toast.error("Valid cost required");
    updateMaintenance(record.id, {
      serviceType: serviceType.trim(),
      problemCategory: problemCategory || undefined,
      vendor: vendor.trim(),
      dateCompleted: dateCompleted || undefined,
      mileageAtService: mileageNum,
      cost: costNum,
      nextServiceDue: nextServiceDue || record.nextServiceDue,
      notes: notes.trim() || undefined,
    });
    toast.success("Maintenance updated");
    onOpenChange(false);
  };

  const remove = () => {
    if (!confirm("Delete this maintenance ticket?")) return;
    deleteMaintenance(record.id);
    toast.success("Ticket deleted");
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit maintenance</DialogTitle>
            <DialogDescription>
              {v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : record.vehicleId}
            </DialogDescription>
          </DialogHeader>

          {record.sourceInspectionId && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="flex-1">
                  <div className="font-medium">Auto-created from runner inspection</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(record.createdAt?.slice(0, 10))}
                    {inspectorName ? ` · by ${inspectorName}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setInspectionOpen(true)}>
                  View inspection
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Service type</Label>
              <Input value={serviceType} onChange={e => setServiceType(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-2">
                Problem category
                {problemCategory && <Badge variant="outline" className="text-[10px]">{problemCategory}</Badge>}
              </Label>
              <ProblemCategorySelect value={problemCategory} onChange={setProblemCategory} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Vendor</Label>
                <Input value={vendor} onChange={e => setVendor(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Date completed</Label>
                <Input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Mileage</Label>
                <Input type="number" min={0} value={mileage} onChange={e => setMileage(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Cost ($)</Label>
                <Input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} />
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label>Next service due</Label>
                <Input type="date" value={nextServiceDue} onChange={e => setNextServiceDue(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InspectionDetailDialog
        inspectionId={record.sourceInspectionId ?? null}
        open={inspectionOpen}
        onOpenChange={setInspectionOpen}
      />
    </>
  );
}