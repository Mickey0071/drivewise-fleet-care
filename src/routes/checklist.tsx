import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Camera, X, CheckCircle2, Wrench, AlertTriangle, ClipboardList } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { CHECKLIST_SECTIONS, JOB_TYPE_LABELS, FUEL_LEVEL_LABELS } from "@/lib/checklist-items";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { completeTaskFromInspection } from "@/lib/tasks.functions";
import { closeoutRental } from "@/lib/return.functions";
import { z } from "zod";

export const Route = createFileRoute("/checklist")({
  head: () => ({ meta: [{ title: "New Inspection — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) =>
    z.object({
      task_id: z.string().optional(),
      rental_id: z.string().optional(),
      mode: z.enum(["return"]).optional(),
    }).parse(s),
  component: ChecklistPage,
});

type StatusValue = "pass" | "fail" | "na";
type JobType = keyof typeof JOB_TYPE_LABELS;
type FuelKey = keyof typeof FUEL_LEVEL_LABELS;
type ReadyState = "ready" | "needs_mechanic" | null;

type VehicleRow = {
  id: string;
  year: number;
  make: string;
  model: string;
  plate: string;
  status: string;
  mileage: number;
};

const INSPECTOR_KEY = "inspector_name";
const JOB_TYPES: JobType[] = ["vehicle_return", "repossession", "new_acquisition", "mechanic_run", "dmv_reg", "inspection"];
const FUEL_KEYS: FuelKey[] = ["full", "three_quarter", "half", "quarter", "empty"];

function vehicleLabel(v: VehicleRow) {
  return `${v.year} ${v.make} ${v.model} — ${v.plate} [${v.status}]`;
}

// Flat key->label lookup for building the runner_notes summary
const ITEM_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const s of CHECKLIST_SECTIONS) for (const it of s.items) m[it.key] = it.label;
  return m;
})();

function ChecklistPage() {
  const navigate = useNavigate();
  const { task_id, rental_id, mode } = Route.useSearch();
  const isReturnMode = mode === "return" && !!rental_id;
  const completeTask = useServerFn(completeTaskFromInspection);
  const closeout = useServerFn(closeoutRental);
  const [taskBanner, setTaskBanner] = useState<string | null>(null);
  const [taskLockedVehicle, setTaskLockedVehicle] = useState<string | null>(null);
  const [maintenanceLinked, setMaintenanceLinked] = useState<string | null>(null);

  const [inspectorName, setInspectorName] = useState("");
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [jobType, setJobType] = useState<JobType | "">("");
  const [items, setItems] = useState<Record<string, StatusValue>>({});
  const [ready, setReady] = useState<ReadyState>(null);
  const [hasDamage, setHasDamage] = useState<boolean>(false);
  const [damageFiles, setDamageFiles] = useState<File[]>([]);
  const [fuel, setFuel] = useState<FuelKey | "">("");
  const [notes, setNotes] = useState("");
  const [openSection, setOpenSection] = useState<string>(CHECKLIST_SECTIONS[0].title);
  const [submitting, setSubmitting] = useState(false);
  const [todayCount, setTodayCount] = useState<number>(0);
  const [returnMileage, setReturnMileage] = useState<string>("");
  const [returnBanner, setReturnBanner] = useState<string | null>(null);
  const [returnRental, setReturnRental] = useState<{
    id: string;
    vehicle_id: string;
    driver_id: string;
    start_date: string | null;
    end_date: string | null;
    mileage_out: number | null;
    latest_expected_end: string | null;
  } | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    vehicle: VehicleRow | null;
    inspector: string;
    jobType: JobType;
    pass: number; fail: number; na: number;
    fuel: FuelKey;
    ready: ReadyState;
    ticketCreated: boolean;
    taskCompleted: boolean;
    maintenanceSynced: boolean;
    returnResult?: {
      final_charge: number | null;
      days_used: number;
      miles_driven: number | null;
      sms_status: "sent" | "skipped_no_phone" | "skipped_no_charge";
    };
  }>(null);

  // Load inspector name: prefer authenticated profile (first + last name), fall back to localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (uid) {
        const { data } = await supabase
          .from("profiles")
          .select("first_name, last_name, full_name")
          .eq("id", uid)
          .maybeSingle();
        const fromProfile = data
          ? ([data.first_name, data.last_name].filter(Boolean).join(" ") || data.full_name || "")
          : "";
        if (!cancelled && fromProfile) { setInspectorName(fromProfile); return; }
      }
      if (cancelled) return;
      if (typeof window !== "undefined") {
        const saved = window.localStorage.getItem(INSPECTOR_KEY);
        if (saved) setInspectorName(saved);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // If route was opened from My Tasks, load task + lock vehicle
  useEffect(() => {
    if (!task_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tasks")
        .select("description, linked_vehicle_id")
        .eq("id", task_id)
        .maybeSingle();
      if (cancelled || !data) return;
      setTaskBanner(data.description ?? `Task ${task_id}`);
      if (data.linked_vehicle_id) {
        setTaskLockedVehicle(data.linked_vehicle_id);
        setVehicleId(data.linked_vehicle_id);
      }
    })();
    return () => { cancelled = true; };
  }, [task_id]);

  // Return-mode bootstrap: fetch rental + driver + extensions to build banner
  useEffect(() => {
    if (!isReturnMode || !rental_id) return;
    let cancelled = false;
    (async () => {
      const { data: rental, error } = await supabase
        .from("rentals")
        .select("id, vehicle_id, driver_id, start_date, end_date, mileage_out, returned_at")
        .eq("id", rental_id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !rental) {
        setReturnError("Rental not found.");
        return;
      }
      if (rental.returned_at) {
        toast.error("This rental has already been returned.");
        navigate({ to: "/rentals" });
        return;
      }

      const [{ data: driver }, { data: vehicle }, { data: exts }] = await Promise.all([
        supabase.from("drivers").select("first_name, last_name, full_name").eq("id", rental.driver_id).maybeSingle(),
        supabase.from("vehicles").select("id, year, make, model, plate, status, mileage").eq("id", rental.vehicle_id).maybeSingle(),
        supabase.from("rental_extensions").select("new_end_date").eq("rental_id", rental.id),
      ]);
      if (cancelled) return;

      // Lock vehicle dropdown and job type.
      setVehicleId(rental.vehicle_id);
      setJobType("vehicle_return");
      if (vehicle) {
        setVehicles((prev) => (prev.some((v) => v.id === vehicle.id) ? prev : [...prev, vehicle as VehicleRow]));
      }

      let latestExpectedEnd: string | null = rental.end_date ?? null;
      for (const e of exts ?? []) {
        if (!latestExpectedEnd || (e.new_end_date && e.new_end_date > latestExpectedEnd)) {
          latestExpectedEnd = e.new_end_date;
        }
      }

      setReturnRental({
        id: rental.id,
        vehicle_id: rental.vehicle_id,
        driver_id: rental.driver_id,
        start_date: rental.start_date ?? null,
        end_date: rental.end_date ?? null,
        mileage_out: rental.mileage_out ?? null,
        latest_expected_end: latestExpectedEnd,
      });

      const customerName =
        [driver?.first_name, driver?.last_name].filter(Boolean).join(" ") ||
        driver?.full_name ||
        "Customer";
      const vLabel = vehicle
        ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""} ${vehicle.plate ?? ""}`.trim()
        : rental.vehicle_id;
      const fmt = (d: string | null) =>
        d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
      setReturnBanner(
        `🔄 Returning ${vLabel}. Customer: ${customerName}. Rental started ${fmt(rental.start_date)}. Expected return: ${fmt(latestExpectedEnd)}.`
      );
    })();
    return () => { cancelled = true; };
  }, [isReturnMode, rental_id, navigate]);

  // Load vehicles
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, plate, status, mileage")
        .order("make", { ascending: true });
      if (cancelled) return;
      if (error) { toast.error("Failed to load vehicles"); return; }
      setVehicles((data ?? []) as VehicleRow[]);
    })();
    return () => { cancelled = true; };
  }, []);

  // Today's job count for this inspector
  useEffect(() => {
    if (!inspectorName.trim()) { setTodayCount(0); return; }
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      const { count } = await supabase
        .from("inspections")
        .select("id", { count: "exact", head: true })
        .eq("inspector_name", inspectorName.trim())
        .gte("submitted_at", `${today}T00:00:00Z`)
        .lt("submitted_at", `${today}T23:59:59Z`);
      if (!cancelled) setTodayCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [inspectorName, done]);

  const persistInspector = () => {
    if (typeof window === "undefined") return;
    const v = inspectorName.trim();
    if (v) window.localStorage.setItem(INSPECTOR_KEY, v);
  };

  const setItem = (key: string, value: StatusValue) => setItems(p => ({ ...p, [key]: value }));

  const counts = useMemo(() => {
    let pass = 0, fail = 0, na = 0;
    for (const v of Object.values(items)) {
      if (v === "pass") pass++;
      else if (v === "fail") fail++;
      else if (v === "na") na++;
    }
    return { pass, fail, na };
  }, [items]);

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!inspectorName.trim()) m.push("inspector name");
    if (!vehicleId) m.push("vehicle");
    if (!jobType) m.push("job type");
    if (ready === null) m.push("ready to rent status");
    if (!fuel) m.push("fuel level");
    if (isReturnMode) {
      const n = Number(returnMileage);
      if (!returnMileage.trim() || !Number.isInteger(n) || n < 0) {
        m.push("return mileage");
      } else if (returnRental?.mileage_out != null && n < returnRental.mileage_out) {
        m.push(`mileage ≥ ${returnRental.mileage_out}`);
      }
    }
    return m;
  }, [inspectorName, vehicleId, jobType, ready, fuel, isReturnMode, returnMileage, returnRental]);

  const canSubmit = missing.length === 0 && !submitting;

  const addDamageFiles = (files: FileList | null) => {
    if (!files) return;
    const next: File[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is over 10MB`); continue; }
      next.push(f);
    }
    setDamageFiles(p => [...p, ...next]);
  };
  const removeDamageFile = (idx: number) =>
    setDamageFiles(p => p.filter((_, i) => i !== idx));

  const reset = (keepInspector: boolean) => {
    setVehicleId("");
    setJobType("");
    setItems({});
    setReady(null);
    setHasDamage(false);
    setDamageFiles([]);
    setFuel("");
    setNotes("");
    setOpenSection(CHECKLIST_SECTIONS[0].title);
    setDone(null);
    if (!keepInspector) setInspectorName("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const vehicle = vehicles.find(v => v.id === vehicleId) ?? null;
      const inspectionId = `IN-${Date.now().toString(36).toUpperCase()}`;
      const inspector = inspectorName.trim();

      // Upload damage photos (best-effort, before DB insert so trigger can fire fresh)
      if (hasDamage && damageFiles.length) {
        for (let i = 0; i < damageFiles.length; i++) {
          const file = damageFiles[i];
          const ext = file.name.split(".").pop() || "jpg";
          const path = `inspections/${inspectionId}/${Date.now()}-${i}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("vehicle-photos")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) toast.error(`Photo upload failed: ${upErr.message}`);
        }
      }

      const { error } = await supabase.from("inspections").insert({
        id: inspectionId,
        vehicle_id: vehicleId,
        rental_id: isReturnMode && returnRental ? returnRental.id : null,
        type: "check-in",
        date: new Date().toISOString().slice(0, 10),
        mileage: isReturnMode ? Number(returnMileage) : (vehicle?.mileage ?? 0),
        fuel_level: fuel,
        damage_noted: hasDamage,
        completed_by: inspector,
        inspector_name: inspector,
        job_type: jobType,
        checklist_items: items,
        ready_to_rent: ready === "ready",
        submitted_at: new Date().toISOString(),
        notes: notes.trim() || null,
      } as any);

      if (error) throw new Error(error.message);
      persistInspector();

      const ticketCreated = counts.fail > 0 || hasDamage || ready === "needs_mechanic";

      // Return-mode closeout: server fn handles rental update + SMS receipt.
      let returnResult: {
        final_charge: number | null;
        days_used: number;
        miles_driven: number | null;
        sms_status: "sent" | "skipped_no_phone" | "skipped_no_charge";
      } | undefined;
      if (isReturnMode && returnRental) {
        try {
          const res = await closeout({
            data: {
              rental_id: returnRental.id,
              inspection_id: inspectionId,
              mileage_in: Number(returnMileage),
            },
          });
          if (!res.alreadyReturned) {
            returnResult = {
              final_charge: res.final_charge ?? null,
              days_used: res.days_used,
              miles_driven: res.miles_driven ?? null,
              sms_status: res.sms_status,
            };
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to close out rental");
        }
      }

      // If completing a dispatched task, mark it done + push summary to maintenance.
      let taskCompleted = false;
      let maintenanceSynced = false;
      if (task_id) {
        const failedLabels = Object.entries(items)
          .filter(([, v]) => v === "fail")
          .map(([k]) => ITEM_LABELS[k] ?? k);
        const summary =
          `Inspection submitted at ${new Date().toISOString()}. ` +
          `Job type: ${JOB_TYPE_LABELS[jobType as JobType]}. ` +
          `Results: ${counts.pass} Pass, ${counts.fail} Fail, ${counts.na} N/A. ` +
          `Ready to rent: ${ready === "ready" ? "yes" : "no"}. ` +
          `Fuel: ${FUEL_LEVEL_LABELS[fuel as FuelKey]}. ` +
          `Notes: ${notes.trim() || "(none)"}. ` +
          `Failed items: ${failedLabels.length ? failedLabels.join(", ") : "(none)"}. ` +
          `Photos: ${damageFiles.length}.`;
        try {
          const res = await completeTask({ data: {
            task_id,
            inspection_id: inspectionId,
            runner_notes: summary,
          }});
          taskCompleted = true;
          maintenanceSynced = !!res.maintenance_id;
          if (res.maintenance_id) setMaintenanceLinked(res.maintenance_id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to mark task complete");
        }
      }

      setDone({
        vehicle,
        inspector,
        jobType: jobType as JobType,
        pass: counts.pass, fail: counts.fail, na: counts.na,
        fuel: fuel as FuelKey,
        ready,
        ticketCreated,
        taskCompleted,
        maintenanceSynced,
        returnResult,
      });
      toast.success("Checklist submitted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <PageHeader title="✅ Inspection Submitted" subtitle="Inspection recorded successfully" />
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Row label="Vehicle">{done.vehicle ? `${done.vehicle.year} ${done.vehicle.make} ${done.vehicle.model} — ${done.vehicle.plate}` : done.vehicle ?? "—"}</Row>
            <Row label="Inspector">{done.inspector}</Row>
            <Row label="Job type">{JOB_TYPE_LABELS[done.jobType]}</Row>
            <Row label="Checklist results">
              <span className="text-emerald-600 font-medium">✅ {done.pass} Pass</span>{" · "}
              <span className="text-destructive font-medium">❌ {done.fail} Fail</span>{" · "}
              <span className="text-muted-foreground">➖ {done.na} N/A</span>
            </Row>
            <Row label="Fuel level">{FUEL_LEVEL_LABELS[done.fuel]}</Row>
            <Row label="Ready to rent">
              {done.ready === "ready"
                ? <span className="text-emerald-600 font-medium">✅ Ready for next renter</span>
                : <span className="text-amber-600 font-medium">🔧 Needs mechanic</span>}
            </Row>
          </CardContent>
        </Card>
        {done.ticketCreated && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Wrench className="h-4 w-4 text-amber-600" />
              🛠️ Maintenance ticket auto-created for this vehicle
            </div>
          </div>
        )}
        {done.taskCompleted && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {done.maintenanceSynced
                ? "✅ Task marked complete. Notes synced to maintenance ticket."
                : "✅ Task marked complete."}
            </div>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-12" onClick={() => reset(true)}>
            New Inspection
          </Button>
          <Button className="h-12" onClick={() => navigate({ to: "/" })}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-32">
      <PageHeader title="New Inspection" subtitle="Submit a full condition check after a runner job" />

      {taskBanner && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <div>
              <div className="font-medium text-blue-700 dark:text-blue-300">Completing task</div>
              <div className="text-blue-800/90 dark:text-blue-200/90">{taskBanner}</div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1 — Job Info */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inspector">Inspector Name *</Label>
              <Input
                id="inspector"
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                onBlur={persistInspector}
                placeholder="Your name"
                className="h-11"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle">Vehicle *</Label>
              {taskLockedVehicle ? (
                <div className="flex h-11 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                  {(() => {
                    const v = vehicles.find(x => x.id === taskLockedVehicle);
                    return v
                      ? `${v.year} ${v.make} ${v.model} — ${v.plate}`
                      : `Vehicle: ${taskLockedVehicle}`;
                  })()}
                </div>
              ) : (
                <select
                  id="vehicle"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a vehicle…</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Jobs completed today</span>
            <Badge variant="secondary" className="text-sm">{todayCount}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2 — Job Type */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label>Job type *</Label>
          <div className="grid grid-cols-2 gap-2">
            {JOB_TYPES.map(jt => (
              <button
                key={jt}
                type="button"
                onClick={() => setJobType(jt)}
                className={cn(
                  "min-h-14 rounded-md border px-3 py-3 text-left text-sm transition-colors",
                  jobType === jt
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border bg-background hover:bg-accent"
                )}
              >
                {JOB_TYPE_LABELS[jt]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SECTION 3 — Checklist */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label>Checklist</Label>
          {CHECKLIST_SECTIONS.map((section) => {
            const completed = section.items.filter(it => items[it.key]).length;
            const isOpen = openSection === section.title;
            return (
              <Collapsible
                key={section.title}
                open={isOpen}
                onOpenChange={(v) => setOpenSection(v ? section.title : "")}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3 text-left">
                  <span className="font-medium">
                    {section.title} <span className="text-muted-foreground">({completed}/{section.items.length})</span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {section.items.map(it => {
                    const value = items[it.key];
                    return (
                      <div
                        key={it.key}
                        className={cn(
                          "rounded-md border px-3 py-2",
                          value === "fail" ? "border-destructive/40 bg-destructive/5" : "border-border"
                        )}
                      >
                        <div className="text-sm font-medium mb-2">{it.label}</div>
                        <div className="grid grid-cols-3 gap-2">
                          <StatusButton
                            label="✅ Pass" active={value === "pass"} variant="pass"
                            onClick={() => setItem(it.key, "pass")}
                          />
                          <StatusButton
                            label="❌ Fail" active={value === "fail"} variant="fail"
                            onClick={() => setItem(it.key, "fail")}
                          />
                          <StatusButton
                            label="➖ N/A" active={value === "na"} variant="na"
                            onClick={() => setItem(it.key, "na")}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>

      {/* SECTION 4 — Ready to Rent */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label>Ready to rent? *</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setReady("ready")}
              className={cn(
                "min-h-14 rounded-md border px-3 py-3 text-sm text-left transition-colors",
                ready === "ready"
                  ? "border-emerald-500 bg-emerald-500/10 font-semibold"
                  : "border-border bg-background hover:bg-accent"
              )}
            >
              ✅ Vehicle PASSES — ready for next renter
            </button>
            <button
              type="button"
              onClick={() => setReady("needs_mechanic")}
              className={cn(
                "min-h-14 rounded-md border px-3 py-3 text-sm text-left transition-colors",
                ready === "needs_mechanic"
                  ? "border-amber-500 bg-amber-500/10 font-semibold"
                  : "border-border bg-background hover:bg-accent"
              )}
            >
              🔧 Vehicle needs mechanic before renting (see notes)
            </button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 5 — Visible Damage */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label>Visible damage?</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setHasDamage(false); setDamageFiles([]); }}
              className={cn(
                "min-h-12 rounded-md border px-3 py-2 text-sm",
                !hasDamage ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background"
              )}
            >
              No
            </button>
            <button
              type="button"
              onClick={() => setHasDamage(true)}
              className={cn(
                "min-h-12 rounded-md border px-3 py-2 text-sm",
                hasDamage ? "border-destructive bg-destructive/10 font-semibold" : "border-border bg-background"
              )}
            >
              Yes
            </button>
          </div>
          {hasDamage && (
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-border px-3 py-6 text-sm text-muted-foreground hover:bg-accent">
                <Camera className="h-5 w-5" />
                <span>Tap to add damage photos</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  className="hidden"
                  onChange={(e) => addDamageFiles(e.target.files)}
                />
              </label>
              {damageFiles.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {damageFiles.map((f, idx) => (
                    <div key={idx} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                      <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeDamageFile(idx)}
                        className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow"
                        aria-label="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 6 — Fuel Level */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label>Fuel level *</Label>
          <div className="grid grid-cols-5 gap-2">
            {FUEL_KEYS.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setFuel(k)}
                className={cn(
                  "min-h-12 rounded-md border px-2 py-2 text-xs sm:text-sm",
                  fuel === k ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background"
                )}
              >
                {FUEL_LEVEL_LABELS[k]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SECTION 7 — Notes */}
      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="notes">Notes (include any failures or mechanic concerns)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={ready === "needs_mechanic" || counts.fail > 0 ? "Recommended: describe what needs attention" : "Optional notes"}
          />
        </CardContent>
      </Card>

      {/* Sticky submit */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl space-y-2">
          {missing.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Cannot submit yet — missing: {missing.join(", ")}.</span>
            </div>
          )}
          <Button
            className="h-12 w-full text-base font-semibold"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? "Submitting…" : "Submit Checklist to Michael"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusButton({
  label, active, variant, onClick,
}: { label: string; active: boolean; variant: "pass" | "fail" | "na"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-md border px-2 py-1.5 text-sm transition-colors",
        !active && "border-border bg-background hover:bg-accent",
        active && variant === "pass" && "border-emerald-500 bg-emerald-500/10 font-semibold",
        active && variant === "fail" && "border-destructive bg-destructive/10 font-semibold",
        active && variant === "na" && "border-muted-foreground/40 bg-muted font-semibold",
      )}
    >
      {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{children}</div>
    </div>
  );
}

// re-export to avoid unused import warning
void CheckCircle2; void ClipboardList;
