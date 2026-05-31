import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vehicles } from "@/lib/mock/data";
import { addMaintenance, addExpense, useStoreVersion } from "@/lib/mock/store";
import { RepairTypeCombobox } from "@/components/app/RepairTypeCombobox";
import { fmtMoney } from "@/lib/mock/data";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialVehicleId?: string;
}

interface PartRow {
  key: string;
  selection: string;
  partPrice: string;
  laborPrice: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function emptyRow(): PartRow {
  return { key: Math.random().toString(36).slice(2), selection: "", partPrice: "", laborPrice: "" };
}

function defaultReturn() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddIssueDialog({ open, onOpenChange, initialVehicleId }: Props) {
  useStoreVersion();
  const [startedAt] = useState(() => new Date());
  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId ?? "");
  const [rows, setRows] = useState<PartRow[]>([emptyRow()]);
  const [downPayment, setDownPayment] = useState<string>("");
  const [estReturn, setEstReturn] = useState<string>(defaultReturn());
  const [vendor, setVendor] = useState<string>("");
  const [completedBy, setCompletedBy] = useState<string>("");

  const reset = () => {
    setVehicleId(initialVehicleId ?? "");
    setRows([emptyRow()]);
    setDownPayment("");
    setEstReturn(defaultReturn());
    setVendor("");
    setCompletedBy("");
  };

  const subtotalOf = (r: PartRow) => (Number(r.partPrice) || 0) + (Number(r.laborPrice) || 0);
  const total = useMemo(() => rows.reduce((s, r) => s + subtotalOf(r), 0), [rows]);
  const balance = total - (Number(downPayment) || 0);

  const updateRow = (key: string, patch: Partial<PartRow>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!vehicleId) return toast.error("Select a vehicle");
    const valid = rows.filter(r => r.selection.trim());
    if (valid.length === 0) return toast.error("Add at least one part");
    for (const r of valid) {
      if (!(Number(r.partPrice) >= 0) || r.partPrice === "") return toast.error(`Part price required for ${r.selection}`);
      if (!(Number(r.laborPrice) >= 0) || r.laborPrice === "") return toast.error(`Labor price required for ${r.selection}`);
    }
    const down = Number(downPayment) || 0;
    if (down < 0) return toast.error("Down payment cannot be negative");

    const partsSummary = valid.map(r => r.selection.trim()).join(", ");
    const v = vehicles.find(x => x.id === vehicleId);
    const estReturnLabel = estReturn ? new Date(estReturn).toLocaleString() : "—";

    const detailLines = [
      `Issue opened ${startedAt.toLocaleString()}`,
      "Parts / labor:",
      ...valid.map(r => `  • ${r.selection.trim()} — part ${fmtMoney(Number(r.partPrice) || 0)} + labor ${fmtMoney(Number(r.laborPrice) || 0)} = ${fmtMoney(subtotalOf(r))}`),
      `Total cost: ${fmtMoney(total)}`,
      `Down payment: ${fmtMoney(down)}`,
      `Balance: ${fmtMoney(balance)}`,
      `Estimated return: ${estReturnLabel}`,
    ];

    const rec = addMaintenance({
      vehicleId,
      serviceType: partsSummary,
      vendor: vendor.trim(),
      dateCompleted: undefined as unknown as string,
      mileageAtService: v?.mileage ?? 0,
      cost: total,
      nextServiceDue: estReturn ? estReturn.slice(0, 10) : today(),
      notes: detailLines.join("\n"),
      completedBy: completedBy.trim() || undefined,
    });

    if (down > 0) {
      addExpense({
        category: "Maintenance",
        amount: down,
        date: today(),
        vehicleId,
        notes: `Down payment for ${rec.id} — ${partsSummary} (balance ${fmtMoney(balance)})`,
      });
    }

    toast.success(`Created ticket ${rec.id}`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add issue</DialogTitle>
          <DialogDescription>Open a maintenance ticket with parts, labor, and pricing.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date started</Label>
              <Input value={startedAt.toLocaleString()} readOnly disabled />
            </div>
            <div className="grid gap-1.5">
              <Label>Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Parts / Repairs</Label>
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Repair {i + 1}</span>
                  {rows.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2">
                  <RepairTypeCombobox value={r.selection} onChange={(v) => updateRow(r.key, { selection: v })} />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs">Part price ($)</Label>
                      <Input type="number" min={0} step="0.01" value={r.partPrice}
                        onChange={e => updateRow(r.key, { partPrice: e.target.value })} />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Labor price ($)</Label>
                      <Input type="number" min={0} step="0.01" value={r.laborPrice}
                        onChange={e => updateRow(r.key, { laborPrice: e.target.value })} />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Subtotal</Label>
                      <Input value={fmtMoney(subtotalOf(r))} readOnly disabled />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit"
              onClick={() => setRows(rs => [...rs, emptyRow()])}>
              <Plus className="mr-1 h-4 w-4" /> Add another repair
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Vendor</Label>
              <Input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ABC Repairs" />
            </div>
            <div className="grid gap-1.5">
              <Label>Completed by</Label>
              <Input value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="e.g. JR" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Down payment ($)</Label>
              <Input type="number" min={0} step="0.01" value={downPayment}
                onChange={e => setDownPayment(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Estimated return</Label>
              <Input type="datetime-local" value={estReturn} onChange={e => setEstReturn(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total cost</span>
              <span className="font-semibold">{fmtMoney(total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Down payment</span>
              <span>{fmtMoney(Number(downPayment) || 0)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">Balance</span>
              <span className="font-semibold">{fmtMoney(balance)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Create Ticket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
