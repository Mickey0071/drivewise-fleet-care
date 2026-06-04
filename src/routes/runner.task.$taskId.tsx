import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, X, CheckCircle2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { submitTask, createRunnerRepairRequest } from "@/lib/tasks.functions";
import { taskTypeLabel } from "@/lib/task-types";
import { compressImage } from "@/lib/image-compress";

export const Route = createFileRoute("/runner/task/$taskId")({
  head: () => ({ meta: [{ title: "Task — Camauto Rentals" }] }),
  component: TaskPage,
});

type TaskRow = {
  id: string;
  type: string;
  vehicle_id: string;
  status: string;
  details: any;
  mileage: number | null;
  vehicleLabel: string;
};

const INSPECTION_ITEMS = [
  { key: "lights", label: "Lights working?" },
  { key: "blinkers", label: "Blinkers working?" },
  { key: "road_test", label: "Road test (runs good?)" },
  { key: "cleanliness", label: "Cleanliness (clean?)" },
  { key: "ac", label: "AC working?" },
  { key: "heat", label: "Heat working?" },
  { key: "keys", label: "Keys present?" },
  { key: "tires", label: "Check tires (good condition?)" },
  { key: "mirrors", label: "Side view mirrors (working?)" },
  { key: "windows", label: "Windows (clean/intact?)" },
];

const DASHBOARD_CODE_OPTIONS = [
  "Engine light",
  "Service light",
  "ABS light",
  "Check transmission",
  "Other (specify)",
];

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant={value === true ? "default" : "outline"} className="h-12" onClick={() => onChange(true)}>Yes</Button>
      <Button type="button" variant={value === false ? "default" : "outline"} className="h-12" onClick={() => onChange(false)}>No</Button>
    </div>
  );
}

function PassFail({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        variant={value === true ? "default" : "outline"}
        className={`h-10 ${value === true ? "bg-emerald-600 hover:bg-emerald-600 text-white" : ""}`}
        onClick={() => onChange(true)}
      >
        Pass
      </Button>
      <Button
        type="button"
        variant={value === false ? "destructive" : "outline"}
        className="h-10"
        onClick={() => onChange(false)}
      >
        Fail
      </Button>
    </div>
  );
}

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Lock className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function PhotoBlock({
  required,
  photos,
  addPhotos,
  removePhoto,
}: {
  required: boolean;
  photos: File[];
  addPhotos: (files: FileList | null) => void;
  removePhoto: (i: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Label>Photos {required && <span className="text-destructive">(required)</span>}</Label>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          addPhotos(e.target.files);
          // Reset so re-selecting the same file still fires onChange.
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" className="mt-1 h-12 w-full" onClick={() => fileRef.current?.click()}>
        <Camera className="mr-2 h-4 w-4" /> Take / add photos
      </Button>
      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              <img src={URL.createObjectURL(p)} alt="" className="h-20 w-full rounded object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskPage() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();
  const submit = useServerFn(submitTask);
  const createRepairReq = useServerFn(createRunnerRepairRequest);

  const [task, setTask] = useState<TaskRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // shared
  const [mileage, setMileage] = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // inspection
  const [items, setItems] = useState<Record<string, boolean>>({});
  // per-item repair request panels (keyed by checklist item key)
  const [repairPanels, setRepairPanels] = useState<Record<string, { notes: string; partsCost: string; laborCost: string }>>({});
  const [ticketed, setTicketed] = useState<Record<string, boolean>>({});
  const [creatingTicket, setCreatingTicket] = useState<string | null>(null);
  const [repairsNeeded, setRepairsNeeded] = useState<boolean | null>(null);
  const [repairText, setRepairText] = useState("");
  // dashboard codes
  const [dashCodes, setDashCodes] = useState<boolean | null>(null);
  const [dashCode, setDashCode] = useState("");
  const [dashCodeOther, setDashCodeOther] = useState("");
  // mechanic / generic
  const [workCompleted, setWorkCompleted] = useState<boolean | null>(null);
  const [allDone, setAllDone] = useState<boolean | null>(null);
  const [issuesFound, setIssuesFound] = useState<boolean | null>(null);
  const [issueText, setIssueText] = useState("");
  // transport
  const [pickupMileage, setPickupMileage] = useState("");
  const [dropoffMileage, setDropoffMileage] = useState("");
  const [damage, setDamage] = useState<boolean | null>(null);
  // generic completion
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [received, setReceived] = useState<boolean | null>(null);
  const [foundFlag, setFoundFlag] = useState<boolean | null>(null);
  const [freeText, setFreeText] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: row, error } = await supabase
        .from("runner_tasks")
        .select("id, type, vehicle_id, status, details, mileage")
        .eq("id", taskId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !row) { setLoadError("Task not found or not assigned to you."); return; }
      const { data: v } = await supabase
        .from("vehicles")
        .select("year, make, model, plate, mileage")
        .eq("id", (row as any).vehicle_id)
        .maybeSingle();
      const label = v ? `${(v as any).year} ${(v as any).make} ${(v as any).model} — ${(v as any).plate}` : (row as any).vehicle_id;
      setTask({ ...(row as any), vehicleLabel: label });
      if ((row as any).status === "completed" || (row as any).status === "approved") setDone(true);
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const out: File[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      try { out.push(await compressImage(f)); } catch { out.push(f); }
    }
    setPhotos((p) => [...p, ...out]);
  };
  const removePhoto = (i: number) => setPhotos((p) => p.filter((_, idx) => idx !== i));

  const handleCreateTicket = async (key: string, label: string) => {
    if (!task) return;
    const panel = repairPanels[key] || { notes: "", partsCost: "", laborCost: "" };
    const issue = label.replace(/\?$/, "").trim();
    const parts = panel.partsCost.trim() ? Number(panel.partsCost) : undefined;
    const labor = panel.laborCost.trim() ? Number(panel.laborCost) : undefined;
    for (const c of [parts, labor]) {
      if (c != null && (!Number.isFinite(c) || c < 0)) { toast.error("Enter a valid cost"); return; }
    }
    setCreatingTicket(key);
    try {
      await createRepairReq({
        data: {
          vehicleId: task.vehicle_id,
          issue,
          notes: panel.notes.trim() || undefined,
          partsCost: parts,
          laborCost: labor,
          mileage: mileage.trim() ? Number(mileage) : undefined,
        },
      });
      setTicketed((t) => ({ ...t, [key]: true }));
      toast.success("Repair ticket created — awaiting admin approval");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setCreatingTicket(null);
    }
  };

  const uploadPhotos = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const f = photos[i];
      const path = `tasks/${taskId}/${Date.now()}-${i}.jpg`;
      const { error } = await supabase.storage.from("vehicle-photos").upload(path, f, { contentType: f.type, upsert: false });
      if (error) { toast.error(`Photo upload failed: ${error.message}`); continue; }
      urls.push(supabase.storage.from("vehicle-photos").getPublicUrl(path).data.publicUrl);
    }
    return urls;
  };

  const requirePhotos = (cond: boolean) => cond && photos.length === 0;

  const handleSubmit = async () => {
    if (!task) return;
    const m = Number(mileage);
    if (!mileage.trim() || !Number.isInteger(m) || m < 0) { toast.error("Current mileage is required"); return; }

    let completion: Record<string, unknown> = { completed_at_local: completedAt };
    let photosRequired = false;

    if (task.type === "inspection") {
      if (Object.keys(items).length < INSPECTION_ITEMS.length) { toast.error("Check every item"); return; }
      if (repairsNeeded === null) { toast.error("Answer: any repairs needed?"); return; }
      if (repairsNeeded && !repairText.trim()) { toast.error("Describe the repairs"); return; }
      if (dashCodes === null) { toast.error("Answer: any dashboard codes?"); return; }
      if (dashCodes && !dashCode) { toast.error("Select which dashboard code"); return; }
      if (dashCodes && dashCode === "Other (specify)" && !dashCodeOther.trim()) { toast.error("Specify the dashboard code"); return; }

      const dashboardCodeValue = dashCodes
        ? dashCode === "Other (specify)" ? dashCodeOther.trim() : dashCode
        : null;

      // Build issue list: failed checklist items + repairs + dashboard codes.
      const issues: string[] = [];
      for (const it of INSPECTION_ITEMS) {
        if (items[it.key] !== true && !ticketed[it.key]) issues.push(it.label.replace(/\?$/, "").trim());
      }
      if (repairsNeeded) issues.push(repairText.trim() || "Repairs needed");
      if (dashCodes && dashboardCodeValue) issues.push(`Dashboard code - ${dashboardCodeValue}`);

      photosRequired = !!repairsNeeded || !!dashCodes;
      completion = {
        ...completion,
        checklist: items,
        repairs_needed: repairsNeeded,
        repairs: repairText.trim(),
        dashboard_codes: dashCodes,
        dashboard_code: dashboardCodeValue,
        issues,
      };
    } else if (task.type === "mechanic") {
      if (workCompleted === null) { toast.error("Answer: work completed?"); return; }
      if (workCompleted && allDone === null) { toast.error("Answer: all services done?"); return; }
      if (workCompleted && issuesFound === null) { toast.error("Answer: any issues found?"); return; }
      if (issuesFound && !issueText.trim()) { toast.error("Describe the issues"); return; }
      photosRequired = !!issuesFound;
      completion = { ...completion, work_completed: workCompleted, all_services_done: allDone, issues_found: issuesFound, issues: issueText.trim() };
    } else if (task.type === "transport") {
      if (!pickupMileage.trim() || !dropoffMileage.trim()) { toast.error("Pickup and dropoff mileage required"); return; }
      if (damage === null) { toast.error("Answer: any damage?"); return; }
      photosRequired = !!damage;
      completion = { ...completion, pickup_mileage: Number(pickupMileage), dropoff_mileage: Number(dropoffMileage), damage };
    } else if (task.type === "parts") {
      if (received === null) { toast.error("Answer: parts received?"); return; }
      if (damage === null) { toast.error("Answer: damage to parts?"); return; }
      photosRequired = !!damage;
      completion = { ...completion, received, parts_damage: damage };
    } else if (task.type === "dmv") {
      if (completed === null) { toast.error("Answer: completed?"); return; }
      if (received === null) { toast.error("Answer: documents received?"); return; }
      photosRequired = !!received;
      completion = { ...completion, completed, documents_received: received };
    } else if (task.type === "repo") {
      if (foundFlag === null) { toast.error("Answer: vehicle found?"); return; }
      if (!freeText.trim()) { toast.error(foundFlag ? "Enter condition / location" : "Explain why not found"); return; }
      completion = { ...completion, vehicle_found: foundFlag, details_text: freeText.trim() };
    } else if (task.type === "custom") {
      if (completed === null) { toast.error("Answer: completed?"); return; }
      if (!freeText.trim()) { toast.error("Describe what was done"); return; }
      photosRequired = issuesFound === true;
      completion = { ...completion, completed, what_done: freeText.trim(), issues_found: !!issuesFound };
    }

    if (requirePhotos(photosRequired)) { toast.error("Photos are required"); return; }

    setSubmitting(true);
    try {
      const urls = photos.length ? await uploadPhotos() : [];
      await submit({ data: { taskId: task.id, mileage: m, completion, photoUrls: urls, notes: notes.trim() || undefined } });
      toast.success("Task submitted");
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/runner/dashboard" })}>Back to tasks</Button>
      </div>
    );
  }
  if (!task) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;

  if (done) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="text-xl font-bold">Task submitted</h1>
        <p className="text-sm text-muted-foreground">Thanks! Your work has been recorded.</p>
        <Button size="lg" className="h-12 w-full" onClick={() => navigate({ to: "/runner/dashboard" })}>Back to my tasks</Button>
      </div>
    );
  }

  const details = task.details || {};
  const instructions: string = details.instructions || "";
  const services: string[] = Array.isArray(details.services) ? details.services : [];

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-28">
      {/* Locked header */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Task</div>
        <h1 className="text-lg font-bold">{taskTypeLabel(task.type)}</h1>
        <div className="mt-1 text-sm text-muted-foreground">Vehicle: {task.vehicleLabel}</div>
        {instructions && <div className="mt-2 rounded bg-background/60 px-3 py-2 text-sm">{instructions}</div>}
      </div>

      <Card>
        <CardContent className="space-y-5 pt-5">
          {/* Mileage — every task */}
          <div>
            <Label htmlFor="mileage">Current mileage</Label>
            <Input id="mileage" inputMode="numeric" className="mt-1 h-12 text-base" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 145200" />
          </div>

          {/* INSPECTION */}
          {task.type === "inspection" && (
            <>
              <div className="space-y-2">
                <Label>Checklist</Label>
                {INSPECTION_ITEMS.map((it) => (
                  <div key={it.key} className="rounded-md border border-border px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex-1">{it.label}</span>
                      <div className="w-40 shrink-0">
                        <PassFail
                          value={items[it.key]}
                          onChange={(v) => {
                            setItems((p) => ({ ...p, [it.key]: v }));
                            if (v === false) {
                              setRepairPanels((p) => ({ ...p, [it.key]: p[it.key] || { notes: "", partsCost: "", laborCost: "" } }));
                            }
                          }}
                        />
                      </div>
                    </div>
                    {items[it.key] === false && (
                      <div className="mt-3 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-destructive">Repair request</div>
                        <div>
                          <Label className="text-xs">Issue</Label>
                          <Input className="mt-1 h-9 bg-background" value={it.label.replace(/\?$/, "").trim()} readOnly />
                        </div>
                        <div>
                          <Label htmlFor={`notes-${it.key}`} className="text-xs">Notes</Label>
                          <Textarea
                            id={`notes-${it.key}`}
                            className="mt-1 bg-background"
                            placeholder="Describe the problem…"
                            disabled={ticketed[it.key]}
                            value={repairPanels[it.key]?.notes ?? ""}
                            onChange={(e) => setRepairPanels((p) => ({ ...p, [it.key]: { notes: e.target.value, partsCost: p[it.key]?.partsCost ?? "", laborCost: p[it.key]?.laborCost ?? "" } }))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label htmlFor={`parts-${it.key}`} className="text-xs">Est. parts cost (optional)</Label>
                            <Input
                              id={`parts-${it.key}`}
                              inputMode="decimal"
                              className="mt-1 h-9 bg-background"
                              placeholder="e.g. 45"
                              disabled={ticketed[it.key]}
                              value={repairPanels[it.key]?.partsCost ?? ""}
                              onChange={(e) => setRepairPanels((p) => ({ ...p, [it.key]: { notes: p[it.key]?.notes ?? "", partsCost: e.target.value.replace(/[^0-9.]/g, ""), laborCost: p[it.key]?.laborCost ?? "" } }))}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`labor-${it.key}`} className="text-xs">Est. labour cost (optional)</Label>
                            <Input
                              id={`labor-${it.key}`}
                              inputMode="decimal"
                              className="mt-1 h-9 bg-background"
                              placeholder="e.g. 75"
                              disabled={ticketed[it.key]}
                              value={repairPanels[it.key]?.laborCost ?? ""}
                              onChange={(e) => setRepairPanels((p) => ({ ...p, [it.key]: { notes: p[it.key]?.notes ?? "", partsCost: p[it.key]?.partsCost ?? "", laborCost: e.target.value.replace(/[^0-9.]/g, "") } }))}
                            />
                          </div>
                        </div>
                        {ticketed[it.key] ? (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" /> Sent to Maintenance
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            className="w-full"
                            disabled={creatingTicket === it.key}
                            onClick={() => handleCreateTicket(it.key, it.label)}
                          >
                            {creatingTicket === it.key ? "Creating…" : "Create Repair Ticket"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <Label>Any repairs needed?</Label>
                <div className="mt-1"><YesNo value={repairsNeeded} onChange={setRepairsNeeded} /></div>
              </div>
              {repairsNeeded && (
                <>
                  <div>
                    <Label htmlFor="rep">What repairs?</Label>
                    <Textarea id="rep" className="mt-1" value={repairText} onChange={(e) => setRepairText(e.target.value)} />
                  </div>
                </>
              )}
              <div>
                <Label>Any dashboard codes?</Label>
                <div className="mt-1"><YesNo value={dashCodes} onChange={setDashCodes} /></div>
              </div>
              {dashCodes && (
                <>
                  <div>
                    <Label>Which code?</Label>
                    <Select value={dashCode} onValueChange={setDashCode}>
                      <SelectTrigger className="mt-1 h-12"><SelectValue placeholder="Select which code..." /></SelectTrigger>
                      <SelectContent>
                        {DASHBOARD_CODE_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {dashCode === "Other (specify)" && (
                    <div>
                      <Label htmlFor="dco">Specify code</Label>
                      <Input id="dco" className="mt-1 h-12" value={dashCodeOther} onChange={(e) => setDashCodeOther(e.target.value)} />
                    </div>
                  )}
                </>
              )}
              {(repairsNeeded || dashCodes) && <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* MECHANIC */}
          {task.type === "mechanic" && (
            <>
              {services.length > 0 && (
                <div className="grid gap-2">
                  {services.map((s) => <LockedField key={s} label="Service" value={s} />)}
                </div>
              )}
              <div>
                <Label>Work completed?</Label>
                <div className="mt-1"><YesNo value={workCompleted} onChange={setWorkCompleted} /></div>
              </div>
              {workCompleted && (
                <>
                  <div>
                    <Label>All services done?</Label>
                    <div className="mt-1"><YesNo value={allDone} onChange={setAllDone} /></div>
                  </div>
                  <div>
                    <Label>Any issues found?</Label>
                    <div className="mt-1"><YesNo value={issuesFound} onChange={setIssuesFound} /></div>
                  </div>
                  {issuesFound && (
                    <>
                      <div>
                        <Label htmlFor="iss">What issues?</Label>
                        <Textarea id="iss" className="mt-1" value={issueText} onChange={(e) => setIssueText(e.target.value)} />
                      </div>
                      <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* TRANSPORT */}
          {task.type === "transport" && (
            <>
              <div>
                <Label htmlFor="pm">Pickup mileage</Label>
                <Input id="pm" inputMode="numeric" className="mt-1 h-12" value={pickupMileage} onChange={(e) => setPickupMileage(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div>
                <Label htmlFor="dm">Dropoff mileage</Label>
                <Input id="dm" inputMode="numeric" className="mt-1 h-12" value={dropoffMileage} onChange={(e) => setDropoffMileage(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div>
                <Label>Any damage?</Label>
                <div className="mt-1"><YesNo value={damage} onChange={setDamage} /></div>
              </div>
              {damage && <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* PARTS */}
          {task.type === "parts" && (
            <>
              <div><Label>Parts received?</Label><div className="mt-1"><YesNo value={received} onChange={setReceived} /></div></div>
              <div><Label>Damage to parts?</Label><div className="mt-1"><YesNo value={damage} onChange={setDamage} /></div></div>
              {damage && <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* DMV */}
          {task.type === "dmv" && (
            <>
              <div><Label>Completed?</Label><div className="mt-1"><YesNo value={completed} onChange={setCompleted} /></div></div>
              <div><Label>Documents received?</Label><div className="mt-1"><YesNo value={received} onChange={setReceived} /></div></div>
              {received && <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* REPO */}
          {task.type === "repo" && (
            <>
              <div><Label>Vehicle found?</Label><div className="mt-1"><YesNo value={foundFlag} onChange={setFoundFlag} /></div></div>
              <div>
                <Label htmlFor="rt">{foundFlag ? "Condition, mileage, location" : "Notes — why not found"}</Label>
                <Textarea id="rt" className="mt-1" value={freeText} onChange={(e) => setFreeText(e.target.value)} />
              </div>
              {foundFlag && <PhotoBlock required={false} photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* CUSTOM */}
          {task.type === "custom" && (
            <>
              <div><Label>Completed?</Label><div className="mt-1"><YesNo value={completed} onChange={setCompleted} /></div></div>
              <div>
                <Label htmlFor="wd">What was done</Label>
                <Textarea id="wd" className="mt-1" value={freeText} onChange={(e) => setFreeText(e.target.value)} />
              </div>
              <div><Label>Any issues?</Label><div className="mt-1"><YesNo value={issuesFound} onChange={setIssuesFound} /></div></div>
              {issuesFound && <PhotoBlock required photos={photos} addPhotos={addPhotos} removePhoto={removePhoto} />}
            </>
          )}

          {/* Notes + completed date — every task */}
          <div>
            <Label htmlFor="cat">Date completed</Label>
            <Input id="cat" type="datetime-local" className="mt-1 h-12" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Button size="lg" className="h-14 w-full text-base" disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Submitting…" : "Mark Complete"}
      </Button>
    </div>
  );
}