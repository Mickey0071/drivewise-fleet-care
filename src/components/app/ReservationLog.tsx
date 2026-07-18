import { useEffect, useState } from "react";
import { AlertTriangle, MessageSquare, Plus, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { reportIssue } from "@/lib/mock/store";
import type { Rental } from "@/lib/mock/data";

interface LogRow {
  id: string;
  reservation_id: string;
  entry_type: "note" | "incident";
  description: string;
  problem_category: string | null;
  created_by: string | null;
  maintenance_id: string | null;
  created_at: string;
}

/** Append-only Incidents & Notes log for a reservation. */
export function ReservationLog({ rental }: { rental: Rental }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [incOpen, setIncOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("reservation_log")
      .select("*")
      .eq("reservation_id", rental.id)
      .order("created_at", { ascending: false });
    if (!error) setRows((data ?? []) as LogRow[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [rental.id]);

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Incidents & Notes</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
            <MessageSquare className="mr-1 h-3.5 w-3.5" /> Add Note
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIncOpen(true)}>
            <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Report Incident
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No entries yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {r.entry_type === "incident" ? (
                    <Badge className="bg-red-600 text-white hover:bg-red-600">Incident</Badge>
                  ) : (
                    <Badge variant="secondary">Note</Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {r.maintenance_id && (
                  <Button asChild size="sm" variant="link" className="h-auto p-0 text-[11px]">
                    <Link to="/repairs">
                      <ExternalLink className="mr-1 h-3 w-3" /> View ticket
                    </Link>
                  </Button>
                )}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm">{r.description}</div>
              {r.problem_category && (
                <div className="mt-1 text-[11px] text-muted-foreground">Category: {r.problem_category}</div>
              )}
              {r.created_by && (
                <div className="text-[11px] text-muted-foreground">By {r.created_by}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        rentalId={rental.id}
        onSaved={refresh}
      />
      <ReportIncidentDialog
        open={incOpen}
        onOpenChange={setIncOpen}
        rental={rental}
        onSaved={refresh}
      />
    </div>
  );
}

async function currentUserLabel(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = (meta.full_name || meta.name || meta.first_name) as string | undefined;
  return name || u.email || u.id;
}

function AddNoteDialog({
  open, onOpenChange, rentalId, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) { toast.error("Enter a note"); return; }
    setSaving(true);
    const by = await currentUserLabel();
    const { error } = await (supabase as any).from("reservation_log").insert({
      reservation_id: rentalId,
      entry_type: "note",
      description: text.trim(),
      created_by: by,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Note added");
    setText("");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setText(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>
            Free-text note. Timestamped automatically. Notes are informational only — they don't affect balances.
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"e.g. Paid $150 cash on pickup, renter extending Friday…"} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <Plus className="mr-1 h-4 w-4" /> Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportIncidentDialog({
  open, onOpenChange, rental, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; rental: Rental; onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [createTicket, setCreateTicket] = useState(true);
  const [saving, setSaving] = useState(false);

  function reset() { setText(""); setCategory(""); setCreateTicket(true); }

  async function save() {
    if (!text.trim()) { toast.error("Describe the incident"); return; }
    if (!category) { toast.error("Select a problem category"); return; }
    setSaving(true);
    let maintenanceId: string | null = null;
    if (createTicket) {
      if (!rental.vehicleId) {
        setSaving(false);
        toast.error("Reservation has no vehicle assigned — uncheck ticket or assign a vehicle.");
        return;
      }
      const rec = reportIssue({
        vehicleId: rental.vehicleId,
        issueDescription: text.trim(),
        customerNotes: `Reported from reservation ${rental.id}`,
      });
      // Tag the maintenance row with the category via a follow-up update (reportIssue doesn't take it).
      try {
        await (supabase as any).from("maintenance").update({ problem_category: category }).eq("id", rec.id);
      } catch { /* non-fatal */ }
      maintenanceId = rec.id;
    }
    const by = await currentUserLabel();
    const { error } = await (supabase as any).from("reservation_log").insert({
      reservation_id: rental.id,
      entry_type: "incident",
      description: text.trim(),
      problem_category: category,
      maintenance_id: maintenanceId,
      created_by: by,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(maintenanceId ? `Incident logged · ticket ${maintenanceId} created` : "Incident logged");
    reset();
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report incident</DialogTitle>
          <DialogDescription>
            Log an incident on this reservation. Optionally opens a maintenance ticket linked back to this entry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="What happened?" />
          </div>
          <div className="grid gap-1.5">
            <Label>Problem category</Label>
            <ProblemCategorySelect value={category} onChange={setCategory} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={createTicket}
              onCheckedChange={(c) => setCreateTicket(!!c)} />
            Create maintenance ticket on the kanban
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <AlertTriangle className="mr-1 h-4 w-4" /> Log incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}