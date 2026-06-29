import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vehicles, drivers } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { createRunnerTask } from "@/lib/runner-tasks.functions";
import { createRmCardLink } from "@/lib/rm-cards.functions";
import { computeScheduledItems } from "@/lib/maintenance-utils";
import { SendLinkPreview } from "@/components/app/SendLinkPreview";

export const Route = createFileRoute("/admin/create-task")({
  head: () => ({ meta: [{ title: "Create Runner Task — Camauto Rentals" }] }),
  component: CreateTaskPage,
});

const TEMPLATES: Record<string, { type: string; items: string[] }> = {
  "Vehicle Pickup": { type: "transport", items: ["Confirm pickup location & contact", "Inspect exterior for damage", "Photograph all four sides", "Check fuel level & mileage", "Collect keys & documents", "Lock vehicle"] },
  "Vehicle Drop-off": { type: "transport", items: ["Confirm drop-off location & contact", "Inspect vehicle condition", "Photograph all four sides", "Record fuel level & mileage", "Hand over keys & documents", "Get recipient confirmation"] },
  "Routine Inspection": { type: "inspection", items: [
    "Vehicle cleanliness (interior)",
    "Vehicle cleanliness (exterior)",
    "Inspection sticker up to date (not expired)",
    "Registration present & current",
    "All lights working (headlights, taillights, brake lights)",
    "Blinkers/turn signals working",
    "AC working (cold air)",
    "Heat working (warm air)",
    "All 4 tires - proper pressure + tread",
    "Mirrors (side + rearview) - working/clean",
    "Windows (all functional)",
    "Dashboard - no warning codes/lights",
    "Keys present (main + spare if available)",
    "Road test completed (drives properly)",
    "Fuel level documented",
    "Mileage documented",
  ] },
  "Vehicle Transport": { type: "transport", items: ["Confirm origin & destination", "Inspect before transport", "Photograph condition", "Record mileage", "Confirm safe delivery"] },
  "Repair Pickup": { type: "parts", items: ["Confirm shop & contact", "Verify completed work order", "Inspect repaired item", "Collect invoice/receipt", "Record mileage", "Return vehicle"] },
  "Routine Maintenance Check": { type: "routine_maintenance", items: [] },
  Custom: { type: "custom", items: [] },
};
const TEMPLATE_KEYS = Object.keys(TEMPLATES);

let counter = 0;
const newItem = (label = "") => ({ id: `i${Date.now()}_${counter++}`, label });

/** Build the RM checklist + metadata for a vehicle from its scheduled items. */
function rmMetaForVehicle(vehicleId: string) {
  const v = vehicles.find((x) => x.id === vehicleId);
  if (!v) return { items: [] as { id: string; label: string }[], rm: [] as any[], mileage: 0 };
  const scheduled = computeScheduledItems(v as any);
  const rm = scheduled.map((s) => ({
    type: s.type,
    customId: s.customId ?? null,
    label: s.label,
    due: s.dueDate ?? (s.dueMileage != null ? `${s.dueMileage} mi` : null),
  }));
  return {
    items: scheduled.map((s) => newItem(s.label)),
    rm,
    mileage: (v as any).mileage ?? 0,
  };
}

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function CreateTaskPage() {
  useStoreVersion();
  const sendFn = useServerFn(createRunnerTask);
  const sendRmFn = useServerFn(createRmCardLink);

  const [runnerName, setRunnerName] = useState("");
  const [runnerPhone, setRunnerPhone] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [runnerPay, setRunnerPay] = useState("");
  const [vehicleId, setVehicleId] = useState<string>("none");
  const [customerId, setCustomerId] = useState<string>("none");
  const [location, setLocation] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [template, setTemplate] = useState<string>("");
  const [items, setItems] = useState([newItem()]);
  const [rmItems, setRmItems] = useState<any[]>([]);
  const [requiresPhotos, setRequiresPhotos] = useState(false);
  const [photosCount, setPhotosCount] = useState("2");
  const [sending, setSending] = useState(false);

  const isRm = template ? TEMPLATES[template]?.type === "routine_maintenance" : false;

  const vehicleOptions = useMemo(
    () => vehicles.map((v) => ({ id: v.id, label: `${v.year} ${v.make} ${v.model} · ${v.plate}` })),
    [],
  );
  const customerOptions = useMemo(
    () => drivers.map((d) => ({ id: d.id, label: d.fullName, phone: d.phone })),
    [],
  );

  function applyTemplate(key: string) {
    setTemplate(key);
    const t = TEMPLATES[key];
    if (t?.type === "routine_maintenance") {
      if (vehicleId !== "none") {
        const meta = rmMetaForVehicle(vehicleId);
        setItems(meta.items.length ? meta.items : [newItem()]);
        setRmItems(meta.rm);
      } else {
        setItems([]);
        setRmItems([]);
      }
    } else if (t && t.items.length) {
      setItems(t.items.map((l) => newItem(l)));
      setRmItems([]);
    } else {
      setItems([newItem()]);
      setRmItems([]);
    }
  }

  function handleVehicleChange(id: string) {
    setVehicleId(id);
    if (isRm && id !== "none") {
      const meta = rmMetaForVehicle(id);
      setItems(meta.items.length ? meta.items : [newItem()]);
      setRmItems(meta.rm);
      const v = vehicles.find((x) => x.id === id);
      if (v && !title.trim()) setTitle(`Routine Maintenance — ${v.year} ${v.make} ${v.model}`);
    }
  }

  async function submit() {
    if (!runnerName.trim()) { toast.error("Runner name is required"); return; }
    if (runnerPhone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid runner phone"); return; }
    if (!title.trim()) { toast.error("Task title is required"); return; }
    if (isRm && vehicleId === "none") { toast.error("Select a vehicle for routine maintenance"); return; }
    const checklist = items.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() }));
    if (isRm && checklist.length === 0) { toast.error("This vehicle has no scheduled maintenance items"); return; }
    setSending(true);
    try {
      const vehicleLabel = vehicleId !== "none"
        ? vehicleOptions.find((v) => v.id === vehicleId)?.label
        : undefined;
      // Routine Maintenance Check → send an RM Card link (Pass/Fail), gated by admin approval.
      if (isRm) {
        const rmMeta = rmMetaForVehicle(vehicleId);
        await sendRmFn({
          data: {
            vehicleId,
            items: rmMeta.rm.map((r) => ({
              type: r.type,
              customId: r.customId ?? undefined,
              label: r.label,
              due: r.due ?? undefined,
            })),
            inspectorName: runnerName.trim(),
            inspectorPhone: runnerPhone.trim(),
            inspectorType: "runner",
            mileage: rmMeta.mileage,
            vehicleLabel,
          },
        });
        toast.success(`✓ RM Card link sent to ${runnerName.trim()}`);
        setRunnerName(""); setRunnerPhone(""); setTitle(""); setPriority("medium");
        setVehicleId("none"); setCustomerId("none"); setLocation(""); setScheduledAt("");
        setInstructions(""); setTemplate(""); setItems([newItem()]);
        setRequiresPhotos(false); setPhotosCount("2"); setRmItems([]);
        return;
      }
      const customer = customerId !== "none"
        ? customerOptions.find((c) => c.id === customerId)
        : undefined;
      const res = await sendFn({
        data: {
          runnerName: runnerName.trim(),
          runnerPhone: runnerPhone.trim(),
          title: title.trim(),
          priority,
          type: template ? TEMPLATES[template].type : "custom",
          vehicleId: vehicleId !== "none" ? vehicleId : null,
          customerId: customerId !== "none" ? customerId : null,
          location: location.trim() || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          instructions: instructions.trim() || undefined,
          checklist,
          vehicleLabel,
          customerName: customer?.label,
          customerPhone: customer?.phone,
          requiresPhotos,
          photosCountRequired: requiresPhotos ? Math.max(1, Number(photosCount) || 1) : 0,
          rmVehicleId: null,
          rmMileage: null,
          rmItems: [],
          runnerPay: runnerPay.trim() === "" ? null : Number(runnerPay),
        },
      });
      if (res.smsStatus === "sent") toast.success(`✓ Task sent to ${runnerName.trim()}`);
      else toast.warning("Task created, but the SMS could not be delivered");
      setRunnerName(""); setRunnerPhone(""); setTitle(""); setPriority("medium");
      setVehicleId("none"); setCustomerId("none"); setLocation(""); setScheduledAt("");
      setInstructions(""); setTemplate(""); setItems([newItem()]);
      setRequiresPhotos(false); setPhotosCount("2"); setRmItems([]); setRunnerPay("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to create task");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Create Runner Task" subtitle="Send a task link to a runner by SMS — no login required" />

      <Card>
        <CardHeader><CardTitle className="text-base">Basic info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Runner name *</Label>
              <Input className="mt-1" value={runnerName} onChange={(e) => setRunnerName(e.target.value)} placeholder="John Doe" />
            </div>
            <div>
              <Label>Runner phone *</Label>
              <Input className="mt-1" type="tel" inputMode="tel" value={runnerPhone}
                onChange={(e) => setRunnerPhone(formatPhone(e.target.value))} placeholder="(267) 555-1234" />
            </div>
          </div>
          <div>
            <Label>Task title *</Label>
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pick up vehicle from customer" />
          </div>
          <div>
            <Label>Priority</Label>
            <RadioGroup value={priority} onValueChange={setPriority} className="mt-2 flex gap-6">
              {["low", "medium", "high"].map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                  <RadioGroupItem value={p} /> {p}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="max-w-[220px]">
            <Label>Runner Pay ($)</Label>
            <Input className="mt-1" type="number" min={0} step="0.01" inputMode="decimal"
              value={runnerPay} onChange={(e) => setRunnerPay(e.target.value)} placeholder="75.00" />
            <p className="mt-1 text-xs text-muted-foreground">Amount offered to the runner for this mission.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Links & schedule</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Vehicle (optional)</Label>
              <Select value={vehicleId} onValueChange={handleVehicleChange}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {vehicleOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Customer (optional)</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {customerOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Location address</Label>
            <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="123 Main St, Philadelphia, PA" />
          </div>
          <div>
            <Label>Date/time scheduled</Label>
            <Input className="mt-1" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Instructions</CardTitle></CardHeader>
        <CardContent>
          <Textarea className="min-h-[90px]" value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="What the runner needs to do…" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Checklist items</CardTitle>
          <Select value={template} onValueChange={applyTemplate}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Use template" /></SelectTrigger>
            <SelectContent>
              {TEMPLATE_KEYS.map((k) => <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        {isRm ? (
        <CardContent className="space-y-2">
          {vehicleId === "none" ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Select a vehicle — its scheduled maintenance items load here automatically.
            </p>
          ) : rmItems.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              This vehicle has no scheduled maintenance due.
            </p>
          ) : (
            <ul className="space-y-2">
              {rmItems.map((it, i) => (
                <li key={`${it.type}-${it.customId ?? i}`} className="rounded-md border border-border p-2">
                  <div className="text-sm font-medium">{it.label}</div>
                  {it.due && <div className="text-xs text-muted-foreground">Due: {it.due}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            The runner gets a Pass/Fail RM Card link. Results wait for your approval before the vehicle updates.
          </p>
        </CardContent>
        ) : (
        <CardContent className="space-y-2">
          {items.map((it, i) => (
            <div key={it.id} className="flex gap-2">
              <Input className="flex-1" placeholder={`Item ${i + 1}`} value={it.label}
                onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} />
              <Button type="button" size="icon" variant="ghost" onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setItems((p) => [...p, newItem()])}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
        </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Photos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={requiresPhotos}
              onChange={(e) => setRequiresPhotos(e.target.checked)} className="h-4 w-4" />
            Require the runner to upload photos
          </label>
          {requiresPhotos && (
            <div className="max-w-[200px]">
              <Label>Photos required</Label>
              <Input className="mt-1" type="number" min={1} max={20} value={photosCount}
                onChange={(e) => setPhotosCount(e.target.value)} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end pb-10">
        <div className="w-full max-w-md space-y-2">
          <SendLinkPreview route={isRm ? "/rm-card/[token]" : "/runner/task/[id]"} />
          <Button disabled={sending} onClick={submit} size="lg" className="w-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> {isRm ? "Create & Send RM Card" : "Create & Send Task"}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
