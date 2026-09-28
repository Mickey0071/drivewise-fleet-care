import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateVehicle } from "@/lib/mock/store";
import type { Vehicle } from "@/lib/mock/data";
import {
  loadVehiclePaperwork, setPaperworkTaskStatus, signedDocUrl, createPaperworkTasks,
  ISSUE_LABEL, TASK_TYPE_LABEL, DEFAULT_TASK_FOR_ISSUE,
  type OnboardingRow, type PaperworkTaskRow, type PaperworkIssue,
} from "@/lib/vehicle-paperwork";

const fmt = (d?: string | null) => (d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const yn = (b: boolean) => (b ? "Yes" : "No");
const FLAG: Record<PaperworkIssue, "titleMissing" | "registrationMissing" | "tagsMissing"> = {
  title: "titleMissing", registration: "registrationMissing", tags: "tagsMissing",
};

export function VehiclePaperworkCard({ vehicle }: { vehicle: Vehicle }) {
  const [onboarding, setOnboarding] = useState<OnboardingRow[]>([]);
  const [tasks, setTasks] = useState<PaperworkTaskRow[]>([]);
  const [newFor, setNewFor] = useState<PaperworkIssue | null>(null);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");

  const reload = useCallback(() => {
    loadVehiclePaperwork(vehicle.id).then((r) => { setOnboarding(r.onboarding); setTasks(r.tasks); });
  }, [vehicle.id]);
  useEffect(reload, [reload]);

  async function resolve(issue: PaperworkIssue) {
    try {
      await updateVehicle(vehicle.id, { [FLAG[issue]]: false } as Partial<Vehicle>);
      toast.success(`${ISSUE_LABEL[issue]} marked resolved`);
    } catch (e: any) { toast.error(e?.message ?? "Could not update"); }
  }
  async function toggleTask(t: PaperworkTaskRow) {
    const next = t.status === "open" ? "done" : "open";
    try {
      await setPaperworkTaskStatus(t.id, next);
      if (next === "done") {
        const others = tasks.filter((x) => x.issue === t.issue && x.id !== t.id && x.status === "open");
        if (others.length === 0 && vehicle[FLAG[t.issue]]) await resolve(t.issue);
      }
      reload();
    } catch (e: any) { toast.error(e?.message ?? "Could not update task"); }
  }
  async function addTask() {
    if (!newFor || !assignee.trim()) return;
    try {
      await createPaperworkTasks(vehicle.id, [{ issue: newFor, taskType: DEFAULT_TASK_FOR_ISSUE[newFor], assignee, dueDate: due, notes: "" }]);
      setNewFor(null); setAssignee(""); setDue(""); reload();
    } catch (e: any) { toast.error(e?.message ?? "Could not create task"); }
  }
  async function openDoc(path: string | null) {
    const url = await signedDocUrl(path);
    if (url) window.open(url, "_blank"); else toast.error("Photo not available");
  }

  const openIssues = (["title", "registration", "tags"] as PaperworkIssue[]).filter((i) => vehicle[FLAG[i]]);
  const latest = onboarding[0];

  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Title & Registration</h3>
        {openIssues.some((i) => i !== "title")
          ? <Badge variant="destructive">Cannot list as Available</Badge>
          : openIssues.length ? <Badge variant="secondary">Title warning</Badge> : <Badge variant="outline">OK</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><div className="text-xs text-muted-foreground">Plate</div><div className="font-medium">{vehicle.plate || "—"}{vehicle.tagState ? ` (${vehicle.tagState})` : ""}</div></div>
        <div><div className="text-xs text-muted-foreground">Tag expiration</div><div className="font-medium">{fmt(vehicle.tagExpiry)}</div></div>
        <div><div className="text-xs text-muted-foreground">Registration expiration</div><div className="font-medium">{fmt(vehicle.registrationExpiry)}</div></div>
        <div><div className="text-xs text-muted-foreground">Title</div><div className="font-medium">{latest ? (latest.titled ? `${latest.title_status ?? ""} · ${latest.title_state ?? ""}` : "Not titled") : "—"}</div></div>
      </div>

      {openIssues.length > 0 && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <div className="mb-1 text-xs font-semibold uppercase text-destructive">Issues</div>
          {openIssues.map((i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span>{ISSUE_LABEL[i]}{i === "title" ? " (warning only)" : " — blocks Available"}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setNewFor(i)}>Create paperwork task</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(i)}>Mark resolved</Button>
              </div>
            </div>
          ))}
          {newFor && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div><Label>Assignee *</Label><Input value={assignee} onChange={(e) => setAssignee(e.target.value)} /></div>
              <div><Label>Due date</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              <div className="flex items-end gap-1">
                <Button size="sm" onClick={addTask} disabled={!assignee.trim()}>Save {TASK_TYPE_LABEL[DEFAULT_TASK_FOR_ISSUE[newFor]]} task</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewFor(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Paperwork tasks</div>
          {tasks.map((t) => (
            <label key={t.id} className="flex items-center gap-2 border-b py-1.5 last:border-0">
              <input type="checkbox" checked={t.status === "done"} onChange={() => toggleTask(t)} />
              <span className={t.status === "done" ? "line-through text-muted-foreground" : ""}>
                {TASK_TYPE_LABEL[t.task_type]} — {t.assignee}{t.due_date ? ` · due ${fmt(t.due_date)}` : ""}
              </span>
            </label>
          ))}
        </div>
      )}

      {latest && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">Onboarding record ({fmt(latest.created_at.slice(0, 10))})</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <div>Titled: {yn(latest.titled)}{latest.titled && ` · ${latest.title_state} · #${latest.title_number} · ${latest.title_status}`}</div>
            <div>Registration on file: {yn(latest.registration_on_file)}{latest.registration_expiry && ` · exp ${fmt(latest.registration_expiry)}`}</div>
            <div>Tags on vehicle: {yn(latest.tags_on_vehicle)}{latest.tags_on_vehicle && ` · ${latest.plate} ${latest.tag_state} · exp ${fmt(latest.tag_expiry)}`}</div>
            <div>Insurance card in vehicle: {yn(latest.insurance_card)}</div>
            {latest.notes && <div className="sm:col-span-2">Notes: {latest.notes}</div>}
            <div className="flex gap-2 sm:col-span-2">
              {latest.title_photo_path && <Button size="sm" variant="outline" onClick={() => openDoc(latest.title_photo_path)}>View title</Button>}
              {latest.registration_photo_path && <Button size="sm" variant="outline" onClick={() => openDoc(latest.registration_photo_path)}>View registration</Button>}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
