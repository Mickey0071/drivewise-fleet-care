import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ReportActions } from "@/components/app/ReportActions";
import { vehicles, activeVehicles, vehicleById, insuranceEntries, fmtDate, fmtMoney, type InsuranceEntry, type InsuranceClaimType } from "@/lib/mock/data";
import {
  addInsuranceEntry, updateInsuranceEntry, deleteInsuranceEntry,
  getChecklistFor, updateChecklistItem, addChecklistItem, deleteChecklistItem,
  uploadClaimDocument,
  useStoreVersion,
} from "@/lib/mock/store";
import { Shield, Trash2, ClipboardCheck, Plus, X, Loader2, Pencil, Upload, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/insurance")({
  head: () => ({ meta: [{ title: "Insurance — Camauto Rentals" }] }),
  component: InsurancePage,
});

const CLAIM_TYPES: InsuranceClaimType[] = ["Collision", "Comprehensive", "Liability", "Total Loss", "Other"];

function InsurancePage() {
  useStoreVersion();
  const [type, setType] = useState<"premium" | "claim">("premium");
  const [vehicleId, setVehicleId] = useState("");
  const [claimType, setClaimType] = useState<InsuranceClaimType>("Collision");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [company, setCompany] = useState("");
  const [renterName, setRenterName] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterType, setFilterType] = useState<"all" | "premium" | "claim">("all");

  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...insuranceEntries]
      .filter(e => !filterVehicle || e.vehicleId === filterVehicle)
      .filter(e => filterType === "all" || e.type === filterType)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [insuranceEntries, filterVehicle, filterType]);

  const totals = useMemo(() => {
    const year = new Date().getFullYear();
    let premiums = 0, payouts = 0, openClaims = 0;
    for (const e of insuranceEntries) {
      const yr = parseInt(e.date.slice(0, 4));
      if (yr === year) {
        if (e.type === "premium") premiums += e.amount;
        else payouts += e.amount;
      }
      if (e.type === "claim" && e.status === "open") openClaims++;
    }
    return { premiums, payouts, net: payouts - premiums, openClaims };
  }, [insuranceEntries]);

  function reset() {
    setVehicleId(""); setAmount(""); setDescription("");
    setPolicyNumber(""); setClaimNumber(""); setNotes("");
    setCompany(""); setRenterName(""); setRenterPhone("");
    setDate(new Date().toISOString().slice(0, 10));
    setEditingId(null);
  }

  function loadForEdit(e: InsuranceEntry) {
    setEditingId(e.id);
    setType(e.type);
    setVehicleId(e.vehicleId ?? "");
    setClaimType(e.claimType ?? "Collision");
    setDate(e.date);
    setAmount(String(e.amount));
    setDescription(e.description);
    setPolicyNumber(e.policyNumber ?? "");
    setClaimNumber(e.claimNumber ?? "");
    setNotes(e.notes ?? "");
    setCompany(e.company ?? "");
    setRenterName(e.renterName ?? "");
    setRenterPhone(e.renterPhone ?? "");
  }

  async function handleSave() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!description.trim()) return toast.error("Add a short description");
    setSaving(true);
    try {
      if (editingId) {
        updateInsuranceEntry(editingId, {
          type, vehicleId: vehicleId || undefined,
          claimType: type === "claim" ? claimType : undefined,
          date, amount: amt, description,
          policyNumber: policyNumber || undefined,
          claimNumber: claimNumber || undefined,
          notes: notes || undefined,
          company: company || undefined,
          renterName: renterName || undefined,
          renterPhone: renterPhone || undefined,
        });
        toast.success("Entry updated");
      } else {
        const ent = addInsuranceEntry({
          type, vehicleId: vehicleId || undefined,
          claimType: type === "claim" ? claimType : undefined,
          date, amount: amt, description,
          policyNumber: policyNumber || undefined,
          claimNumber: claimNumber || undefined,
          notes: notes || undefined,
          company: company || undefined,
          renterName: renterName || undefined,
          renterPhone: renterPhone || undefined,
        });
        await (ent as { cloudReady?: Promise<unknown> }).cloudReady;
        toast.success(type === "claim" ? "Claim opened" : "Premium logged");
      }
      reset();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Insurance"
        subtitle="Track premiums, claims, and walk through every claim step by step"
        action={
          <ReportActions csv={{
            filename: "insurance.csv",
            headers: ["ID", "Date", "Type", "Claim Type", "Vehicle", "Amount", "Status", "Policy #", "Claim #", "Description", "Notes"],
            rows: sorted.map(e => [
              e.id, e.date, e.type, e.claimType ?? "",
              e.vehicleId ? vehicleById(e.vehicleId)?.plate ?? e.vehicleId : "",
              e.amount, e.status, e.policyNumber ?? "", e.claimNumber ?? "",
              e.description, e.notes ?? "",
            ]),
          }} />
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <SummaryCard label="Premiums (YTD)" value={fmtMoney(totals.premiums)} />
        <SummaryCard label="Claim payouts (YTD)" value={fmtMoney(totals.payouts)} />
        <SummaryCard label="Net (YTD)" value={fmtMoney(totals.net)} accent={totals.net >= 0 ? "text-emerald-600" : "text-destructive"} />
        <SummaryCard label="Open claims" value={String(totals.openClaims)} icon={<Shield className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">{editingId ? "Edit entry" : "New entry"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Entry type</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={type === "premium" ? "default" : "outline"} onClick={() => setType("premium")}>Premium</Button>
                <Button type="button" variant={type === "claim" ? "default" : "outline"} onClick={() => setType("claim")}>Claim</Button>
              </div>
            </div>
            {type === "claim" && (
              <div>
                <Label className="mb-1.5 block text-xs">Claim type</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={claimType} onChange={(e) => setClaimType(e.target.value as InsuranceClaimType)}>
                  {CLAIM_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label className="mb-1.5 block text-xs">Vehicle (optional)</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">— Policy-wide / overhead —</option>
                {activeVehicles().map(v => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-xs">Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">{type === "claim" ? "Payout amount" : "Premium amount"}</Label>
                <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                  value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Description</Label>
              <Input placeholder={type === "claim" ? "e.g. Rear-end at I-285" : "e.g. Q2 fleet premium"}
                value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-xs">Policy #</Label>
                <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Claim #</Label>
                <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} disabled={type !== "claim"} />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {type === "claim" && (
              <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Claim header</div>
                <div>
                  <Label className="mb-1.5 block text-xs">Insurance company</Label>
                  <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Progressive" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs">Renter name</Label>
                    <Input value={renterName} onChange={(e) => setRenterName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs">Renter phone</Label>
                    <Input value={renterPhone} onChange={(e) => setRenterPhone(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : editingId ? "Save changes" : "Add entry"}
              </Button>
              {editingId && <Button type="button" variant="outline" onClick={reset}>Cancel</Button>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Entries ({sorted.length})</CardTitle>
            <div className="flex gap-2">
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
                <option value="all">All types</option>
                <option value="premium">Premiums</option>
                <option value="claim">Claims</option>
              </select>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)}>
                <option value="">All vehicles</option>
                {activeVehicles().map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {sorted.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">No entries yet. Log a premium or open a claim to get started.</p>
            )}
            {sorted.map(e => {
              const v = e.vehicleId ? vehicleById(e.vehicleId) : null;
              const checklist = e.type === "claim" ? getChecklistFor(e.id) : [];
              const done = checklist.filter(c => c.done).length;
              const claimTotal = checklist.reduce((s, c) => s + (c.amount ?? 0), 0);
              return (
                <div key={e.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={e.type === "claim" ? "destructive" : "secondary"} className="capitalize">{e.type}</Badge>
                      {e.claimType && <Badge variant="outline">{e.claimType}</Badge>}
                      {e.type === "claim" && (
                        <Badge variant={e.status === "open" ? "default" : "outline"} className="capitalize">{e.status}</Badge>
                      )}
                      <span className="font-medium">{e.description}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(e.date)}
                      {v && ` · ${v.plate}`}
                      {e.policyNumber && ` · Policy ${e.policyNumber}`}
                      {e.claimNumber && ` · Claim ${e.claimNumber}`}
                      {e.company && ` · ${e.company}`}
                      {e.renterName && ` · Renter ${e.renterName}`}
                      {e.type === "claim" && claimTotal > 0 && ` · Claim total ${fmtMoney(claimTotal)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.type === "claim" && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setActiveChecklistId(e.id)}>
                        <ClipboardCheck className="mr-1 h-4 w-4" />
                        {done}/{checklist.length}
                      </Button>
                    )}
                    {e.type === "claim" && (
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => updateInsuranceEntry(e.id, { status: e.status === "open" ? "closed" : "open" })}>
                        {e.status === "open" ? "Close" : "Reopen"}
                      </Button>
                    )}
                    <span className={`min-w-[5rem] text-right font-semibold ${e.type === "claim" ? "text-emerald-600" : ""}`}>
                      {e.type === "claim" ? "+" : "−"}{fmtMoney(e.amount)}
                    </span>
                    <button onClick={() => loadForEdit(e)} className="text-muted-foreground hover:text-foreground" title="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm("Delete this entry?")) deleteInsuranceEntry(e.id); }}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <ChecklistDialog entryId={activeChecklistId} onClose={() => setActiveChecklistId(null)} />
    </div>
  );
}

function SummaryCard({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardContent>
    </Card>
  );
}

function ChecklistDialog({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  useStoreVersion();
  const [newLabel, setNewLabel] = useState("");
  const entry = entryId ? insuranceEntries.find(e => e.id === entryId) : null;
  const items = entryId ? getChecklistFor(entryId) : [];

  const isComplete = (c: typeof items[number]) =>
    c.done && (!c.requiresDocument || !!c.documentUrl) && (!c.requiresAmount || (c.amount != null && c.amount >= 0));

  const completeCount = items.filter(isComplete).length;
  const totalAmount = items.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <Dialog open={!!entryId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Accident claim checklist</DialogTitle>
          {entry && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{entry.description} · {fmtDate(entry.date)}</p>
              <p className="text-xs">
                {entry.company && `${entry.company} · `}
                {entry.claimNumber && `Claim ${entry.claimNumber} · `}
                {entry.renterName && `${entry.renterName}`}
                {entry.renterPhone && ` · ${entry.renterPhone}`}
              </p>
            </div>
          )}
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span><span className="font-semibold">{completeCount}</span> of {items.length} complete</span>
          <span>Demand total: <span className="font-semibold">{fmtMoney(totalAmount)}</span></span>
        </div>

        <div className="space-y-3 py-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No checklist items yet.</p>}
          {items.map(c => (
            <ChecklistRow key={c.id} item={c} complete={isComplete(c)} />
          ))}
        </div>

        <div className="flex gap-2 border-t border-border pt-3">
          <Input placeholder="Add a custom step…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLabel.trim() && entryId) {
                e.preventDefault();
                addChecklistItem(entryId, newLabel.trim()); setNewLabel("");
              }
            }} />
          <Button type="button" onClick={() => { if (newLabel.trim() && entryId) { addChecklistItem(entryId, newLabel.trim()); setNewLabel(""); } }}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistRow({ item, complete }: { item: import("@/lib/mock/data").InsuranceChecklistItem; complete: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [amountStr, setAmountStr] = useState(item.amount != null ? String(item.amount) : "");
  const [notes, setNotes] = useState(item.notes ?? "");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadClaimDocument(item.id, file);
      toast.success("Document uploaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const status = complete
    ? { label: "Complete", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }
    : item.done
      ? { label: item.requiresDocument && !item.documentUrl ? "Missing document" : "Missing amount",
          className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
      : { label: "Pending", className: "bg-muted text-muted-foreground" };

  return (
    <div className={`rounded-md border p-3 ${complete ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <Checkbox checked={item.done} onCheckedChange={(v) => updateChecklistItem(item.id, { done: !!v })} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${complete ? "" : ""}`}>{item.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${status.className}`}>{status.label}</span>
          </div>

          {item.requiresAmount && (
            <div className="mt-2">
              <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Amount</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                onBlur={() => {
                  const n = amountStr === "" ? undefined : parseFloat(amountStr);
                  updateChecklistItem(item.id, { amount: Number.isFinite(n as number) ? n : undefined });
                }}
                className="h-8" />
            </div>
          )}

          {item.requiresDocument && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.documentUrl ? (
                <>
                  <a href={item.documentUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="max-w-[180px] truncate">{item.documentName ?? "View document"}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <button type="button"
                    onClick={() => updateChecklistItem(item.id, { documentUrl: undefined, documentName: undefined })}
                    className="text-xs text-muted-foreground hover:text-destructive">
                    Remove
                  </button>
                </>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs hover:bg-accent">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload proof
                  <input type="file" className="hidden" onChange={onFile} disabled={uploading}
                    accept="image/*,application/pdf" />
                </label>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                {item.documentUrl ? "Replace" : ""}
                {item.documentUrl && (
                  <input type="file" className="hidden" onChange={onFile} disabled={uploading}
                    accept="image/*,application/pdf" />
                )}
              </label>
            </div>
          )}

          <Textarea rows={1} placeholder="Notes" value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => updateChecklistItem(item.id, { notes: notes || undefined })}
            className="mt-2 min-h-[32px] text-xs" />
        </div>
        <button onClick={() => deleteChecklistItem(item.id)} className="text-muted-foreground hover:text-destructive" title="Remove task">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}