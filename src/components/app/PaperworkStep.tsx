import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_STATES } from "@/lib/us-states";
import {
  type PaperworkForm, type DraftPaperworkTask, type PaperworkIssue, type PaperworkTaskType,
  ISSUE_LABEL, TASK_TYPE_LABEL, DEFAULT_TASK_FOR_ISSUE, paperworkIssues,
} from "@/lib/vehicle-paperwork";

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 sm:col-span-2">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant={value === true ? "default" : "outline"} onClick={() => onChange(true)}>Yes</Button>
        <Button type="button" size="sm" variant={value === false ? "destructive" : "outline"} onClick={() => onChange(false)}>No</Button>
      </div>
    </div>
  );
}

function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
      <SelectContent>
        {US_STATES.map((s: any) => {
          const code = typeof s === "string" ? s : s.code ?? s.value ?? s.abbr;
          const name = typeof s === "string" ? s : s.name ?? s.label ?? code;
          return <SelectItem key={code} value={code}>{name}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

export function PaperworkStep({
  form, setForm, tasks, setTasks,
}: {
  form: PaperworkForm;
  setForm: (f: PaperworkForm) => void;
  tasks: DraftPaperworkTask[];
  setTasks: (t: DraftPaperworkTask[]) => void;
}) {
  const set = <K extends keyof PaperworkForm>(k: K, v: PaperworkForm[K]) => setForm({ ...form, [k]: v });
  const issues = paperworkIssues(form);
  const [editing, setEditing] = useState<PaperworkIssue | null>(null);
  const [draft, setDraft] = useState<DraftPaperworkTask | null>(null);

  function openTask(issue: PaperworkIssue) {
    setEditing(issue);
    setDraft(tasks.find((t) => t.issue === issue) ?? { issue, taskType: DEFAULT_TASK_FOR_ISSUE[issue], assignee: "", dueDate: "", notes: "" });
  }
  function saveTask() {
    if (!draft || !draft.assignee.trim()) return;
    setTasks([...tasks.filter((t) => t.issue !== draft.issue), draft]);
    setEditing(null); setDraft(null);
  }

  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <YesNo label="Was the vehicle titled?" value={form.titled} onChange={(v) => set("titled", v)} />
      {form.titled && (
        <>
          <div><Label>Title state</Label><StateSelect value={form.titleState} onChange={(v) => set("titleState", v)} /></div>
          <div><Label>Title number</Label><Input value={form.titleNumber} onChange={(e) => set("titleNumber", e.target.value)} /></div>
          <div>
            <Label>Title status</Label>
            <Select value={form.titleStatus} onValueChange={(v) => set("titleStatus", v as PaperworkForm["titleStatus"])}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["Clean", "Salvage", "Rebuilt", "Other"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Title photo</Label><Input type="file" accept="image/*" onChange={(e) => set("titlePhoto", e.target.files?.[0] ?? null)} /></div>
        </>
      )}

      <YesNo label="Registration on file?" value={form.registrationOnFile} onChange={(v) => set("registrationOnFile", v)} />
      {form.registrationOnFile && (
        <>
          <div><Label>Registration card photo</Label><Input type="file" accept="image/*" onChange={(e) => set("registrationPhoto", e.target.files?.[0] ?? null)} /></div>
          <div><Label>Registration expiration</Label><Input type="date" value={form.registrationExpiry} onChange={(e) => set("registrationExpiry", e.target.value)} /></div>
        </>
      )}

      <YesNo label="Tags on the vehicle?" value={form.tagsOnVehicle} onChange={(v) => set("tagsOnVehicle", v)} />
      {form.tagsOnVehicle && (
        <>
          <div><Label>Plate number</Label><Input value={form.plate} onChange={(e) => set("plate", e.target.value.toUpperCase())} /></div>
          <div><Label>Plate state</Label><StateSelect value={form.tagState} onChange={(v) => set("tagState", v)} /></div>
          <div><Label>Tag expiration</Label><Input type="date" value={form.tagExpiry} onChange={(e) => set("tagExpiry", e.target.value)} /></div>
        </>
      )}

      <YesNo label="Insurance card in the vehicle?" value={form.insuranceCard} onChange={(v) => set("insuranceCard", v)} />

      <div className="sm:col-span-2">
        <Label>Notes{issues.length > 0 ? " *" : ""}</Label>
        <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
          placeholder={issues.length ? "Required — explain the missing paperwork" : "Optional"} />
      </div>

      {issues.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 sm:col-span-2">
          <div className="mb-1 text-xs font-semibold uppercase text-destructive">Issues</div>
          <ul className="space-y-1.5">
            {issues.map((i) => {
              const t = tasks.find((x) => x.issue === i);
              const blocks = i !== "title";
              return (
                <li key={i} className="rounded border bg-background p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{ISSUE_LABEL[i]}</div>
                      <div className="text-xs text-muted-foreground">
                        {blocks ? "Blocks listing as Available until resolved" : "Warning only — does not block listing"}
                      </div>
                      {t && <div className="text-xs">Task: {TASK_TYPE_LABEL[t.taskType]} · {t.assignee}{t.dueDate ? ` · due ${t.dueDate}` : ""}</div>}
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => openTask(i)}>
                      {t ? "Edit paperwork task" : "Create paperwork task"}
                    </Button>
                  </div>
                  {editing === i && draft && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label>Task type</Label>
                        <Select value={draft.taskType} onValueChange={(v) => setDraft({ ...draft, taskType: v as PaperworkTaskType })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TASK_TYPE_LABEL) as PaperworkTaskType[]).map((k) => <SelectItem key={k} value={k}>{TASK_TYPE_LABEL[k]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Assignee *</Label><Input value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} /></div>
                      <div><Label>Due date</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
                      <div><Label>Task notes</Label><Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
                      <div className="flex gap-2 sm:col-span-2">
                        <Button type="button" size="sm" onClick={saveTask} disabled={!draft.assignee.trim()}>Save task</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button>
                        {t && <Button type="button" size="sm" variant="ghost" onClick={() => { setTasks(tasks.filter((x) => x.issue !== i)); setEditing(null); }}>Remove task</Button>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
