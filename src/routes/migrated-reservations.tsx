import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Database, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  listMigratedReservations,
  createMigratedReservation,
  deleteMigratedReservation,
  updateMigratedReservation,
  parseReservationText,
  bulkImportReservations,
  type MigratedReservation,
} from "@/lib/migrated-reservations.functions";

export const Route = createFileRoute("/migrated-reservations")({
  head: () => ({ meta: [{ title: "Migrated Reservations — Camauto Rentals" }] }),
  component: MigratedReservationsPage,
});

type Form = {
  renter_name: string; plate: string; vehicle: string; year: string; color: string;
  order_number: string; pickup_location: string; start_datetime: string; end_datetime: string;
  address: string; dl_number: string; notes: string;
};
const EMPTY: Form = {
  renter_name: "", plate: "", vehicle: "", year: "", color: "",
  order_number: "", pickup_location: "", start_datetime: "", end_datetime: "",
  address: "", dl_number: "", notes: "",
};

function MigratedReservationsPage() {
  const list = useServerFn(listMigratedReservations);
  const create = useServerFn(createMigratedReservation);
  const remove = useServerFn(deleteMigratedReservation);
  const update = useServerFn(updateMigratedReservation);
  const parse = useServerFn(parseReservationText);
  const bulk = useServerFn(bulkImportReservations);

  const [rows, setRows] = useState<MigratedReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<Form>(EMPTY);
  const [savingEdit, setSavingEdit] = useState(false);

  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setE = (k: keyof Form, v: string) => setEf((p) => ({ ...p, [k]: v }));

  const toLocal = (s: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const openEdit = (r: MigratedReservation) => {
    setEditId(r.id);
    setEf({
      renter_name: r.renter_name ?? "", plate: r.plate ?? "", vehicle: r.vehicle ?? "",
      year: r.year ?? "", color: r.color ?? "", order_number: r.order_number ?? "",
      pickup_location: r.pickup_location ?? "", start_datetime: toLocal(r.start_datetime),
      end_datetime: toLocal(r.end_datetime), address: r.address ?? "",
      dl_number: r.dl_number ?? "", notes: r.notes ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSavingEdit(true);
    try {
      const updated = await update({ data: { id: editId, ...ef } });
      setRows((p) => p.map((r) => (r.id === editId ? updated : r)));
      toast.success("Updated — regenerate the violation packet to use the new info");
      setEditId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSavingEdit(false);
    }
  };

  const bulkImport = async () => {
    if (!bulkText.trim()) { toast.error("Paste your reservations first"); return; }
    setBulkBusy(true);
    try {
      const r = await bulk({ data: { text: bulkText } });
      if (r.saved === 0) {
        toast.error("No reservations found in that text");
      } else {
        toast.success(
          `Imported ${r.saved} reservation${r.saved === 1 ? "" : "s"}` +
            (r.withoutPlate ? ` — ${r.withoutPlate} missing a plate (add it so violations match)` : ""),
        );
        setBulkText("");
        await refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import");
    } finally {
      setBulkBusy(false);
    }
  };

  const parsePaste = async () => {
    if (!pasteText.trim()) { toast.error("Paste a reservation first"); return; }
    setParsing(true);
    try {
      const p = await parse({ data: { text: pasteText } });
      setF((prev) => ({
        renter_name: p.renter_name || prev.renter_name,
        plate: p.plate || prev.plate,
        vehicle: p.vehicle || prev.vehicle,
        year: p.year || prev.year,
        color: p.color || prev.color,
        order_number: p.order_number || prev.order_number,
        pickup_location: p.pickup_location || prev.pickup_location,
        start_datetime: p.start_datetime || prev.start_datetime,
        end_datetime: p.end_datetime || prev.end_datetime,
        address: p.address || prev.address,
        dl_number: p.dl_number || prev.dl_number,
        notes: p.notes || prev.notes,
      }));
      toast.success(p.plate ? "Filled — review and save" : "Filled — add the plate/tag, then save");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not parse");
    } finally {
      setParsing(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await list());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const add = async () => {
    if (!f.renter_name.trim()) { toast.error("Renter name is required"); return; }
    setSaving(true);
    try {
      await create({ data: {
        renter_name: f.renter_name, plate: f.plate, vehicle: f.vehicle, year: f.year, color: f.color,
        order_number: f.order_number, pickup_location: f.pickup_location,
        start_datetime: f.start_datetime || null, end_datetime: f.end_datetime || null,
        address: f.address, dl_number: f.dl_number, notes: f.notes,
      } });
      toast.success("Migrated reservation saved");
      setF(EMPTY);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm("Delete this migrated reservation?")) return;
    try {
      await remove({ data: { id } });
      setRows((p) => p.filter((r) => r.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div>
      <PageHeader
        title="Migrated Reservations"
        subtitle="Records migrated from the old system. Used only for looking up violations — never counted in P&L, reservations, or any live reports."
      />

      <Card className="mb-6 border-primary/40">
        <CardHeader>
          <CardTitle className="text-base">Bulk paste reservations (Fleet Finesse)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste <strong>all</strong> your old reservations here — one after another, the same way
            Nicole's looked. Each gets saved automatically. Violations are matched by{" "}
            <strong>plate (tag) + date</strong>, so make sure each reservation includes the license
            plate. Anything missing a plate is still saved and flagged so you can add it later.
          </p>
          <Textarea
            rows={10}
            placeholder={
              "Paste many reservations here, e.g.\n\nHyundai Elantra\n2013\nNicole Campbell\nABC1234\n416 Sicklerville Road\n05/24/2026 9:00 AM\n05/31/2026 9:00 AM\nReturned\n\nToyota Camry\n2018\nJohn Smith\nXYZ7890\n...\n"
            }
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <Button onClick={bulkImport} disabled={bulkBusy}>
            {bulkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Import all reservations
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Or add one reservation manually</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 sm:col-span-2 lg:col-span-3 rounded-lg border border-dashed p-3">
            <Label className="text-xs font-medium">Paste reservation (Fleet Finesse) — auto-fills the fields below</Label>
            <Textarea
              rows={4}
              placeholder={"Paste the whole reservation here, e.g.\nHyundai Elantra\n2013\nNicole Campbell\n416 Sicklerville Road\n05/24/2026 9:00 AM\n05/31/2026 9:00 AM\n\nTip: include the license plate/tag so violations can be matched."}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <Button type="button" variant="secondary" size="sm" onClick={parsePaste} disabled={parsing}>
              {parsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Parse &amp; fill
            </Button>
          </div>
          <F label="Renter name *" v={f.renter_name} on={(v) => set("renter_name", v)} />
          <F label="License plate" v={f.plate} on={(v) => set("plate", v.toUpperCase())} />
          <F label="Vehicle (make/model)" v={f.vehicle} on={(v) => set("vehicle", v)} />
          <F label="Year" v={f.year} on={(v) => set("year", v)} />
          <F label="Color" v={f.color} on={(v) => set("color", v)} />
          <F label="Order # (old system)" v={f.order_number} on={(v) => set("order_number", v)} />
          <F label="Pickup location" v={f.pickup_location} on={(v) => set("pickup_location", v)} />
          <F label="DL / License number" v={f.dl_number} on={(v) => set("dl_number", v)} />
          <F label="Start" type="datetime-local" v={f.start_datetime} on={(v) => set("start_datetime", v)} />
          <F label="End" type="datetime-local" v={f.end_datetime} on={(v) => set("end_datetime", v)} />
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Address</Label>
            <Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button onClick={add} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Save migrated reservation
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> Migrated reservations ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No migrated reservations yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Renter</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.renter_name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.plate ?? "—"}</TableCell>
                      <TableCell className="text-sm">{[r.year, r.color, r.vehicle].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell className="text-xs">{fmt(r.start_datetime)}</TableCell>
                      <TableCell className="text-xs">{fmt(r.end_datetime)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.source ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => void del(r.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editId} onOpenChange={(o) => { if (!o) setEditId(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit migrated reservation</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Fill in any missing renter details (address, DL number, etc.) so the violation
            liability packet is complete. After saving, regenerate the packet on the violation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Renter name *" v={ef.renter_name} on={(v) => setE("renter_name", v)} />
            <F label="License plate" v={ef.plate} on={(v) => setE("plate", v.toUpperCase())} />
            <F label="Vehicle (make/model)" v={ef.vehicle} on={(v) => setE("vehicle", v)} />
            <F label="Year" v={ef.year} on={(v) => setE("year", v)} />
            <F label="Color" v={ef.color} on={(v) => setE("color", v)} />
            <F label="Order # (old system)" v={ef.order_number} on={(v) => setE("order_number", v)} />
            <F label="Pickup location" v={ef.pickup_location} on={(v) => setE("pickup_location", v)} />
            <F label="DL / License number" v={ef.dl_number} on={(v) => setE("dl_number", v)} />
            <F label="Start" type="datetime-local" v={ef.start_datetime} on={(v) => setE("start_datetime", v)} />
            <F label="End" type="datetime-local" v={ef.end_datetime} on={(v) => setE("end_datetime", v)} />
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Address</Label>
              <Textarea rows={2} value={ef.address} onChange={(e) => setE("address", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={ef.notes} onChange={(e) => setE("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmt(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function F({
  label, v, on, type = "text",
}: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}