import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { updateVehicle } from "@/lib/mock/store";
import type { Vehicle, MaintenanceSettings, CustomMaintenanceAlert, ScheduledTask, ScheduledTaskKey } from "@/lib/mock/data";

type TaskDef = {
  key: ScheduledTaskKey;
  label: string;
  showMiles: boolean;
  showMonths: boolean;
  defMiles?: number;
  defMonths?: number;
  required?: boolean;
};
const TASK_DEFS: TaskDef[] = [
  { key: "oil", label: "Oil Change", showMiles: true, showMonths: true, defMiles: 3000, defMonths: 3, required: true },
  { key: "battery", label: "Battery Test", showMiles: false, showMonths: true, defMonths: 12, required: true },
  { key: "alternator", label: "Alternator Test", showMiles: false, showMonths: true, defMonths: 12, required: true },
  { key: "transmission", label: "Transmission Road Test", showMiles: true, showMonths: true, defMiles: 5000, defMonths: 6 },
  { key: "safety", label: "Safety Inspection", showMiles: true, showMonths: true, defMiles: 3000, defMonths: 6 },
  { key: "overall", label: "Overall Checklist", showMiles: true, showMonths: true, defMiles: 5000, defMonths: 12 },
];

export function MaintenanceSettingsDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: Vehicle | null;
}) {
  const [oilMode, setOilMode] = useState<"miles" | "months">("miles");
  const [oilInterval, setOilInterval] = useState("");
  const [oilLastMileage, setOilLastMileage] = useState("");
  const [oilLastDate, setOilLastDate] = useState("");
  const [inspectionExpiry, setInspectionExpiry] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [batteryLastDone, setBatteryLastDone] = useState("");
  const [alternatorLastDone, setAlternatorLastDone] = useState("");
  const [customAlerts, setCustomAlerts] = useState<CustomMaintenanceAlert[]>([]);
  const [tasks, setTasks] = useState<Partial<Record<ScheduledTaskKey, ScheduledTask>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !vehicle) return;
    const s = vehicle.maintenanceSettings ?? {};
    setOilMode(s.oilChange?.mode ?? "miles");
    setOilInterval(s.oilChange?.interval ? String(s.oilChange.interval) : "");
    setOilLastMileage(s.oilChange?.lastMileage != null ? String(s.oilChange.lastMileage) : String(vehicle.mileage ?? ""));
    setOilLastDate(s.oilChange?.lastDate ?? "");
    setInspectionExpiry(s.inspectionExpiry ?? "");
    setRegistrationExpiry(vehicle.registrationExpiry ?? "");
    setBatteryLastDone(s.batteryLastDone ?? "");
    setAlternatorLastDone(s.alternatorLastDone ?? "");
    setCustomAlerts(s.customAlerts ?? []);
    setTasks(s.scheduledTasks ?? {});
  }, [open, vehicle]);

  if (!vehicle) return null;

  function getTask(key: ScheduledTaskKey): ScheduledTask {
    return tasks[key] ?? { enabled: false };
  }
  function updateTask(key: ScheduledTaskKey, patch: Partial<ScheduledTask>) {
    setTasks(prev => ({ ...prev, [key]: { ...(prev[key] ?? { enabled: false }), ...patch } }));
  }

  function addCustom() {
    setCustomAlerts(prev => [
      ...prev,
      { id: `ca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, label: "", lastDate: "", intervalDays: 365 },
    ]);
  }
  function updateCustom(id: string, patch: Partial<CustomMaintenanceAlert>) {
    setCustomAlerts(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeCustom(id: string) {
    setCustomAlerts(prev => prev.filter(c => c.id !== id));
  }

  async function save() {
    if (!vehicle) return;
    setSaving(true);
    const settings: MaintenanceSettings = {};
    const interval = Number(oilInterval);
    if (interval > 0) {
      settings.oilChange = {
        mode: oilMode,
        interval,
        lastMileage: oilMode === "miles" ? (Number(oilLastMileage) || 0) : undefined,
        lastDate: oilMode === "months" ? (oilLastDate || undefined) : undefined,
      };
    }
    if (inspectionExpiry) settings.inspectionExpiry = inspectionExpiry;
    if (batteryLastDone) settings.batteryLastDone = batteryLastDone;
    if (alternatorLastDone) settings.alternatorLastDone = alternatorLastDone;
    const cleanCustom = customAlerts
      .filter(c => c.label.trim() && c.intervalDays > 0)
      .map(c => ({ ...c, label: c.label.trim() }));
    if (cleanCustom.length) settings.customAlerts = cleanCustom;

    // Scheduled tasks
    const cleanTasks: Partial<Record<ScheduledTaskKey, ScheduledTask>> = {};
    for (const def of TASK_DEFS) {
      const t = tasks[def.key];
      if (t && t.enabled) {
        cleanTasks[def.key] = {
          enabled: true,
          miles: def.showMiles ? (Number(t.miles) || undefined) : undefined,
          months: def.showMonths ? (Number(t.months) || undefined) : undefined,
          lastDone: t.lastDone || undefined,
        };
      }
    }
    settings.scheduledTasks = cleanTasks;

    // Keep the alert engine fields in sync with the scheduled tasks.
    const oilTask = cleanTasks.oil;
    if (oilTask) {
      if (oilTask.miles) {
        settings.oilChange = { mode: "miles", interval: oilTask.miles, lastMileage: Number(oilLastMileage) || vehicle.mileage || 0 };
      } else if (oilTask.months && oilTask.lastDone) {
        settings.oilChange = { mode: "months", interval: oilTask.months, lastDate: oilTask.lastDone };
      }
    }
    if (cleanTasks.battery?.lastDone) settings.batteryLastDone = cleanTasks.battery.lastDone;
    if (cleanTasks.alternator?.lastDone) settings.alternatorLastDone = cleanTasks.alternator.lastDone;

    try {
      await updateVehicle(vehicle.id, {
        maintenanceSettings: settings,
        registrationExpiry: registrationExpiry || undefined,
      });
      toast.success("Maintenance settings saved");
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Could not save settings", { description: e?.message ?? "Try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!bottom-2 !top-2 flex h-auto max-h-none max-w-lg !translate-y-0 flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-2">
          <DialogTitle className="text-sm">Maintenance settings · {vehicle.year} {vehicle.make} {vehicle.model}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
          {/* Scheduled maintenance tasks */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scheduled Maintenance Tasks</Label>
            {TASK_DEFS.map(def => {
              const t = getTask(def.key);
              return (
                <div key={def.key} className="rounded-md border border-border p-2">
                  <label className="flex items-center gap-2 font-medium">
                    <Checkbox
                      checked={!!t.enabled}
                      onCheckedChange={(c) =>
                        updateTask(def.key, {
                          enabled: !!c,
                          miles: t.miles ?? def.defMiles,
                          months: t.months ?? def.defMonths,
                        })
                      }
                    />
                    <span>{def.label}{def.required ? <span className="text-destructive"> *</span> : null}</span>
                  </label>
                  {t.enabled && (
                    <div className="mt-2 space-y-2 pl-6">
                      {(def.showMiles || def.showMonths) && (
                        <div className="grid grid-cols-2 gap-2">
                          {def.showMiles && (
                            <div>
                              <Label className="text-xs">Every (miles)</Label>
                              <Input
                                type="number"
                                inputMode="numeric"
                                placeholder={def.defMiles ? String(def.defMiles) : ""}
                                value={t.miles ?? ""}
                                onChange={e => updateTask(def.key, { miles: Number(e.target.value) || undefined })}
                              />
                            </div>
                          )}
                          {def.showMonths && (
                            <div>
                              <Label className="text-xs">{def.showMiles ? "OR (months)" : "Every (months)"}</Label>
                              <Input
                                type="number"
                                inputMode="numeric"
                                placeholder={def.defMonths ? String(def.defMonths) : ""}
                                value={t.months ?? ""}
                                onChange={e => updateTask(def.key, { months: Number(e.target.value) || undefined })}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div>
                        <Label className="text-xs">Last done</Label>
                        <Input type="date" value={t.lastDone ?? ""} onChange={e => updateTask(def.key, { lastDone: e.target.value })} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">* Required for the schedule to count as fully configured.</p>
          </div>

          <Separator />

          {/* Oil change */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Oil Change Frequency</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={oilMode} onValueChange={(v) => setOilMode(v as "miles" | "months")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="miles">Every X miles</SelectItem>
                  <SelectItem value="months">Every X months</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                inputMode="numeric"
                placeholder={oilMode === "miles" ? "5000" : "3"}
                value={oilInterval}
                onChange={e => setOilInterval(e.target.value)}
              />
            </div>
            {oilMode === "miles" ? (
              <div>
                <Label>Mileage at last oil change</Label>
                <Input type="number" inputMode="numeric" value={oilLastMileage} onChange={e => setOilLastMileage(e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>Last oil change date</Label>
                <Input type="date" value={oilLastDate} onChange={e => setOilLastDate(e.target.value)} />
              </div>
            )}
          </div>

          <Separator />

          <div><Label>Inspection expiration</Label><Input type="date" value={inspectionExpiry} onChange={e => setInspectionExpiry(e.target.value)} /></div>
          <div><Label>Registration expiration</Label><Input type="date" value={registrationExpiry} onChange={e => setRegistrationExpiry(e.target.value)} /></div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Annual Services</Label>
            <div><Label>Battery check — last done</Label><Input type="date" value={batteryLastDone} onChange={e => setBatteryLastDone(e.target.value)} /></div>
            <div><Label>Alternator check — last done</Label><Input type="date" value={alternatorLastDone} onChange={e => setAlternatorLastDone(e.target.value)} /></div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom Alerts</Label>
              <Button type="button" size="sm" variant="outline" onClick={addCustom}><Plus className="mr-1 h-3 w-3" />Add</Button>
            </div>
            {customAlerts.length === 0 && <p className="text-xs text-muted-foreground">No custom alerts.</p>}
            {customAlerts.map(c => (
              <div key={c.id} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input placeholder="Alert name (e.g. Timing Belt)" value={c.label} onChange={e => updateCustom(c.id, { label: e.target.value })} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeCustom(c.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Last done</Label>
                    <Input type="date" value={c.lastDate ?? ""} onChange={e => updateCustom(c.id, { lastDate: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Every X days</Label>
                    <Input type="number" inputMode="numeric" value={c.intervalDays || ""} onChange={e => updateCustom(c.id, { intervalDays: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-4 py-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}