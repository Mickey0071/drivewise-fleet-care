import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { fmtDate, fmtMoney, type Maintenance, type PartBreakdownItem, type LaborBreakdownItem } from "@/lib/mock/data";
import { updateMaintenance } from "@/lib/mock/store";
import { toast } from "sonner";

function nid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Read-only itemized Parts + Labor display for a repair. Falls back to the
 * roll-up totals from partsCost/laborCost when no line items were entered.
 */
export function RepairBreakdownView({ record }: { record: Maintenance }) {
  const parts = record.partsBreakdown ?? [];
  const labor = record.laborBreakdown ?? [];
  const partsRollup = Number(record.partsCost ?? record.selectedSolution?.partsCost ?? 0);
  const laborRollup = Number(record.laborCost ?? record.selectedSolution?.laborCost ?? 0);
  const partsSum = parts.reduce((s, p) => s + (Number(p.cost) || 0), 0);
  const laborSum = labor.reduce((s, l) => s + (Number(l.cost) || 0), 0);
  const partsTotal = parts.length > 0 ? partsSum : partsRollup;
  const laborTotal = labor.length > 0 ? laborSum : laborRollup;

  return (
    <div className="space-y-3 text-xs">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <div className="font-semibold uppercase tracking-wide text-muted-foreground">Parts</div>
          <div className="font-medium">{fmtMoney(partsTotal)}</div>
        </div>
        {parts.length === 0 ? (
          <div className="text-muted-foreground">
            {partsRollup > 0 ? "Roll-up total only — no itemized parts recorded." : "No parts recorded."}
          </div>
        ) : (
          <ul className="space-y-1">
            {parts.map(p => (
              <li key={p.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">• {p.name}</div>
                  <div className="text-muted-foreground">
                    {p.supplier ? `From ${p.supplier}` : "Supplier —"}
                    {p.purchaseDate ? ` · ${fmtDate(p.purchaseDate)}` : ""}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </div>
                </div>
                <div className="shrink-0 font-medium">{fmtMoney(p.cost)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <div className="font-semibold uppercase tracking-wide text-muted-foreground">Labor</div>
          <div className="font-medium">{fmtMoney(laborTotal)}</div>
        </div>
        {labor.length === 0 ? (
          <div className="text-muted-foreground">
            {laborRollup > 0 ? "Roll-up total only — no itemized labor recorded." : "No labor recorded."}
          </div>
        ) : (
          <ul className="space-y-1">
            {labor.map(l => (
              <li key={l.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">• {l.mechanicName}</div>
                  <div className="text-muted-foreground">
                    {l.hours != null ? `${l.hours} hr` : "—"}
                    {l.workDate ? ` · ${fmtDate(l.workDate)}` : ""}
                    {l.notes ? ` · ${l.notes}` : ""}
                  </div>
                </div>
                <div className="shrink-0 font-medium">{fmtMoney(l.cost)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface EditorProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Maintenance | null;
}

type PartDraft = PartBreakdownItem & { _dirty?: boolean };
type LaborDraft = LaborBreakdownItem & { _dirty?: boolean };

export function RepairBreakdownEditorDialog({ open, onOpenChange, record }: EditorProps) {
  const [parts, setParts] = useState<PartDraft[]>([]);
  const [labor, setLabor] = useState<LaborDraft[]>([]);

  useMemo(() => {
    if (open && record) {
      setParts((record.partsBreakdown ?? []).map(p => ({ ...p })));
      setLabor((record.laborBreakdown ?? []).map(l => ({ ...l })));
    }
  }, [open, record?.id]);

  if (!record) return null;

  const partsSum = parts.reduce((s, p) => s + (Number(p.cost) || 0), 0);
  const laborSum = labor.reduce((s, l) => s + (Number(l.cost) || 0), 0);

  function addPart() {
    setParts(p => [...p, { id: nid(), name: "", supplier: "", cost: 0, purchaseDate: "" }]);
  }
  function removePart(id: string) {
    setParts(p => p.filter(x => x.id !== id));
  }
  function updatePart(id: string, patch: Partial<PartBreakdownItem>) {
    setParts(p => p.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }
  function addLabor() {
    setLabor(l => [...l, { id: nid(), mechanicName: "", cost: 0, hours: undefined, workDate: "" }]);
  }
  function removeLabor(id: string) {
    setLabor(l => l.filter(x => x.id !== id));
  }
  function updateLabor(id: string, patch: Partial<LaborBreakdownItem>) {
    setLabor(l => l.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }

  function save() {
    if (!record) return;
    const cleanParts = parts
      .filter(p => p.name.trim().length > 0)
      .map(({ _dirty, ...p }) => ({ ...p, cost: Number(p.cost) || 0 }));
    const cleanLabor = labor
      .filter(l => l.mechanicName.trim().length > 0)
      .map(({ _dirty, ...l }) => ({
        ...l,
        cost: Number(l.cost) || 0,
        hours: l.hours != null ? Number(l.hours) : undefined,
      }));
    const partsSumFinal = cleanParts.reduce((s, p) => s + p.cost, 0);
    const laborSumFinal = cleanLabor.reduce((s, l) => s + l.cost, 0);

    const patch: Partial<Maintenance> = {
      partsBreakdown: cleanParts,
      laborBreakdown: cleanLabor,
    };
    // When breakdown items exist, roll up totals from them so the P&L
    // aggregate stays consistent with the itemized view.
    if (cleanParts.length > 0) patch.partsCost = partsSumFinal;
    if (cleanLabor.length > 0) patch.laborCost = laborSumFinal;
    if (cleanParts.length > 0 || cleanLabor.length > 0) {
      patch.cost = (patch.partsCost ?? record.partsCost ?? 0) + (patch.laborCost ?? record.laborCost ?? 0);
    }
    updateMaintenance(record.id, patch);
    toast.success("Repair breakdown saved");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit parts & labor breakdown</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 text-sm">
          {/* Parts */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parts ({fmtMoney(partsSum)})</div>
              <Button variant="outline" size="sm" onClick={addPart}><Plus className="mr-1 h-3.5 w-3.5" />Add part</Button>
            </div>
            {parts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No parts. Click "Add part" to record what was used and where it came from.</p>
            ) : parts.map(p => (
              <div key={p.id} className="rounded-md border border-border p-2 space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Part name</span>
                    <Input value={p.name} onChange={e => updatePart(p.id, { name: e.target.value })} placeholder="e.g. Fuel gauge sender" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Supplier / where from</span>
                    <Input value={p.supplier ?? ""} onChange={e => updatePart(p.id, { supplier: e.target.value })} placeholder="e.g. AutoZone" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Cost ($)</span>
                    <Input type="number" step="0.01" value={p.cost} onChange={e => updatePart(p.id, { cost: parseFloat(e.target.value) || 0 })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Date purchased</span>
                    <Input type="date" value={p.purchaseDate ?? ""} onChange={e => updatePart(p.id, { purchaseDate: e.target.value })} />
                  </label>
                  <div className="flex items-end justify-end">
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removePart(p.id)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                    </Button>
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">Notes</span>
                  <Input value={p.notes ?? ""} onChange={e => updatePart(p.id, { notes: e.target.value })} placeholder="Optional — invoice #, warranty, etc." />
                </label>
              </div>
            ))}
          </section>

          {/* Labor */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labor ({fmtMoney(laborSum)})</div>
              <Button variant="outline" size="sm" onClick={addLabor}><Plus className="mr-1 h-3.5 w-3.5" />Add labor</Button>
            </div>
            {labor.length === 0 ? (
              <p className="text-xs text-muted-foreground">No labor entries. Click "Add labor" to record who did the work.</p>
            ) : labor.map(l => (
              <div key={l.id} className="rounded-md border border-border p-2 space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Mechanic name</span>
                    <Input value={l.mechanicName} onChange={e => updateLabor(l.id, { mechanicName: e.target.value })} placeholder="e.g. Mike R." />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Work date</span>
                    <Input type="date" value={l.workDate ?? ""} onChange={e => updateLabor(l.id, { workDate: e.target.value })} />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Hours</span>
                    <Input type="number" step="0.1" value={l.hours ?? ""} onChange={e => updateLabor(l.id, { hours: e.target.value === "" ? undefined : parseFloat(e.target.value) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Cost ($)</span>
                    <Input type="number" step="0.01" value={l.cost} onChange={e => updateLabor(l.id, { cost: parseFloat(e.target.value) || 0 })} />
                  </label>
                  <div className="flex items-end justify-end">
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeLabor(l.id)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                    </Button>
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">Notes</span>
                  <Input value={l.notes ?? ""} onChange={e => updateLabor(l.id, { notes: e.target.value })} placeholder="Optional" />
                </label>
              </div>
            ))}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save breakdown</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Compact button that opens the breakdown editor for a repair. */
export function EditBreakdownButton({ record }: { record: Maintenance }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1 h-3.5 w-3.5" />
        Edit breakdown
      </Button>
      <RepairBreakdownEditorDialog open={open} onOpenChange={setOpen} record={record} />
    </>
  );
}