import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateMaintenance, addExpense } from "@/lib/mock/store";
import { vehicleById, fmtMoney, type Maintenance } from "@/lib/mock/data";
import { RepairTypeCombobox } from "@/components/app/RepairTypeCombobox";
import { Trash2, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Maintenance | null;
}

interface RepairRow {
  key: string;
  name: string;
  partPrice: string;
  laborPrice: string;
}

interface PaymentEntry {
  date: string;
  amount: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number((s || "").replace(/,/g, "")) || 0;

function emptyRow(): RepairRow {
  return { key: Math.random().toString(36).slice(2), name: "", partPrice: "", laborPrice: "" };
}

/** Parse repair rows from the ticket notes block. */
function parseRepairs(notes: string): RepairRow[] {
  const rows: RepairRow[] = [];
  const re = /•\s*(.+?)\s*—\s*part\s*\$([\d,.]+)\s*\+\s*labor\s*\$([\d,.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(notes))) {
    rows.push({
      key: Math.random().toString(36).slice(2),
      name: m[1].trim(),
      partPrice: String(num(m[2])),
      laborPrice: String(num(m[3])),
    });
  }
  return rows;
}

function parseDownPayment(notes: string): number {
  const m = notes.match(/Down payment:\s*\$([\d,.]+)/i);
  return m ? num(m[1]) : 0;
}

function parsePayments(notes: string): PaymentEntry[] {
  const out: PaymentEntry[] = [];
  const idx = notes.indexOf("Additional payments:");
  if (idx === -1) return out;
  const section = notes.slice(idx);
  const re = /•\s*(\d{4}-\d{2}-\d{2})\s*—\s*\$([\d,.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) out.push({ date: m[1], amount: num(m[2]) });
  return out;
}

function parseOpenedLine(notes: string): string | null {
  const line = notes.split("\n").find(l => l.trim().startsWith("Issue opened"));
  return line ? line.trim() : null;
}

function parseEstReturn(notes: string): string | null {
  const line = notes.split("\n").find(l => l.trim().startsWith("Estimated return:"));
  return line ? line.trim() : null;
}

export function EditTicketCostsDialog({ open, onOpenChange, record }: Props) {
  const [rows, setRows] = useState<RepairRow[]>([]);
  const [downPayment, setDownPayment] = useState("");
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [newPayment, setNewPayment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    const notes = record.notes ?? "";
    const parsed = parseRepairs(notes);
    setRows(parsed.length ? parsed : [emptyRow()]);
    setDownPayment(String(parseDownPayment(notes) || ""));
    setPayments(parsePayments(notes));
    setNewPayment("");
    setSaving(false);
  }, [open, record]);

  const subtotal = (r: RepairRow) => num(r.partPrice) + num(r.laborPrice);
  const total = useMemo(() => rows.reduce((s, r) => s + subtotal(r), 0), [rows]);
  const downNum = num(downPayment);
  const paidSoFar = downNum + payments.reduce((s, p) => s + p.amount, 0);
  const balance = total - paidSoFar;

  if (!record) return null;
  const v = vehicleById(record.vehicleId);

  const updateRow = (key: string, patch: Partial<RepairRow>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    const valid = rows.filter(r => r.name.trim());
    if (valid.length === 0) return toast.error("Add at least one repair");
    const extra = newPayment.trim() === "" ? 0 : num(newPayment);
    if (extra < 0) return toast.error("Payment cannot be negative");

    const newTotal = valid.reduce((s, r) => s + subtotal(r), 0);
    const allPayments = extra > 0 ? [...payments, { date: today(), amount: extra }] : payments;
    const paid = downNum + allPayments.reduce((s, p) => s + p.amount, 0);
    const newBalance = newTotal - paid;

    const opened = parseOpenedLine(record.notes ?? "");
    const est = parseEstReturn(record.notes ?? "");

    const lines: string[] = [];
    if (opened) lines.push(opened);
    lines.push("Parts / labor:");
    valid.forEach(r => {
      lines.push(`  • ${r.name} — part ${fmtMoney(num(r.partPrice))} + labor ${fmtMoney(num(r.laborPrice))} = ${fmtMoney(subtotal(r))}`);
    });
    lines.push(`Total cost: ${fmtMoney(newTotal)}`);
    lines.push(`Down payment: ${fmtMoney(downNum)}`);
    if (allPayments.length > 0) {
      lines.push("Additional payments:");
      allPayments.forEach(p => lines.push(`  • ${p.date} — ${fmtMoney(p.amount)}`));
    }
    lines.push(`Total paid: ${fmtMoney(paid)}`);
    lines.push(`Balance: ${fmtMoney(newBalance)}`);
    if (est) lines.push(est);

    setSaving(true);
    updateMaintenance(record.id, {
      serviceType: valid.map(r => r.name).join(", ") || record.serviceType,
      cost: newTotal,
      notes: lines.join("\n"),
    });

    if (extra > 0) {
      addExpense({
        category: "Maintenance",
        amount: extra,
        date: today(),
        vehicleId: record.vehicleId,
        notes: `Payment for ${record.id} — balance now ${fmtMoney(newBalance)}`,
      });
    }

    toast.success("Ticket costs updated");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit costs</DialogTitle>
          <DialogDescription>
            {v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : record.vehicleId}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
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
              <div className="mb-2 grid gap-1">
                <Label className="text-xs">Part name</Label>
                <RepairTypeCombobox value={r.name} onChange={(val) => updateRow(r.key, { name: val })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Part price ($)</Label>
                  <Input type="number" min={0} step="0.01" value={r.partPrice}
                    onChange={e => updateRow(r.key, { partPrice: e.target.value })} placeholder="Optional" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Labor price ($)</Label>
                  <Input type="number" min={0} step="0.01" value={r.laborPrice}
                    onChange={e => updateRow(r.key, { laborPrice: e.target.value })} placeholder="Optional" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Subtotal</Label>
                  <Input value={fmtMoney(subtotal(r))} readOnly disabled />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit"
            onClick={() => setRows(rs => [...rs, emptyRow()])}>
            <Plus className="mr-1 h-4 w-4" /> Add another repair
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Down payment ($)</Label>
              <Input type="number" min={0} step="0.01" value={downPayment}
                onChange={e => setDownPayment(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Additional payment ($)</Label>
              <Input type="number" min={0} step="0.01" value={newPayment}
                onChange={e => setNewPayment(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">New total</span>
              <span className="font-semibold">{fmtMoney(total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Paid so far</span>
              <span>{fmtMoney(paidSoFar + (newPayment.trim() === "" ? 0 : num(newPayment)))}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">New balance due</span>
              <span className="font-semibold">{fmtMoney(total - paidSoFar - (newPayment.trim() === "" ? 0 : num(newPayment)))}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Update"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}