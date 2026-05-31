import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminCreateTask, listAssignableRunners } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type TaskTypeKey =
  | "pickup" | "dropoff" | "dmv" | "repo" | "parts" | "inspection" | "mechanic_run" | "other";

export const TASK_TYPE_OPTIONS: { value: TaskTypeKey; label: string }[] = [
  { value: "pickup", label: "🔑 Pickup" },
  { value: "dropoff", label: "🚗 Dropoff" },
  { value: "dmv", label: "📋 DMV" },
  { value: "repo", label: "🚨 Repo" },
  { value: "mechanic_run", label: "🔧 Mechanic Run" },
  { value: "parts", label: "🏷️ Parts" },
  { value: "inspection", label: "✅ Inspection" },
  { value: "other", label: "📌 Other" },
];

type Vehicle = { id: string; year: number; make: string; model: string; plate: string };
type Rental = { id: string; vehicle_id: string; driver_id: string; start_date: string };
type Driver = { id: string; full_name: string | null; phone: string | null; address: string | null };
type Runner = { id: string; first_name: string | null; last_name: string | null; username: string | null; phone: string | null };
type Vendor = { id: string; name: string; phone: string | null; address: string | null; service_type: string | null };

export type NewTaskPrefill = {
  task_type?: TaskTypeKey;
  linked_vehicle_id?: string;
  linked_rental_id?: string;
  description?: string;
  address?: string;
  mode?: "return";
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: NewTaskPrefill;
  onCreated?: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);

export const DMV_SERVICES = [
  "Registration renewal",
  "Title transfer",
  "Inspection sticker",
  "Emissions test",
  "License plate",
  "Other",
] as const;

export const DMV_DOCS_NEEDED = [
  "Title",
  "Insurance proof",
  "ID",
  "Previous registration",
  "Inspection sticker (if needed)",
  "Emissions test (if needed)",
] as const;

export function NewTaskDialog({ open, onOpenChange, prefill, onCreated }: Props) {
  const createTask = useServerFn(adminCreateTask);
  const loadRunners = useServerFn(listAssignableRunners);

  const [runners, setRunners] = useState<Runner[]>([]);
  const [runnersError, setRunnersError] = useState<string | null>(null);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [assignedTo, setAssignedTo] = useState<string>("");
  const [runnerSearch, setRunnerSearch] = useState("");
  const [taskType, setTaskType] = useState<TaskTypeKey>(prefill?.task_type ?? "other");
  const [vehicleId, setVehicleId] = useState<string>(prefill?.linked_vehicle_id ?? "");
  const [rentalId, setRentalId] = useState<string>(prefill?.linked_rental_id ?? "");
  const [description, setDescription] = useState<string>(prefill?.description ?? "");
  const [address, setAddress] = useState<string>(prefill?.address ?? "");
  const [dueDate, setDueDate] = useState<string>(today());
  const [priority, setPriority] = useState<"urgent" | "normal" | "flexible">("normal");
  const [notifySms, setNotifySms] = useState(true);
  const [busy, setBusy] = useState(false);
  // Mechanic-run specific fields
  const [vendorId, setVendorId] = useState<string>("");
  const [vendorName, setVendorName] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [workOrder, setWorkOrder] = useState<string>("");
  // Parts-run specific fields
  const [prPartsNeeded, setPrPartsNeeded] = useState<string>("");
  const [prDestination, setPrDestination] = useState<string>("");
  // Repo specific fields
  const [rpReason, setRpReason] = useState<string>("");
  const [rpCustomerName, setRpCustomerName] = useState<string>("");
  const [rpCustomerPhone, setRpCustomerPhone] = useState<string>("");
  const [rpTowAuthorized, setRpTowAuthorized] = useState<boolean>(false);
  // DMV-run specific fields
  const [drService, setDrService] = useState<string>("");
  const [drDocs, setDrDocs] = useState<Record<string, boolean>>({});
  const [drOtherDoc, setDrOtherDoc] = useState<string>("");
  const [drLocation, setDrLocation] = useState<string>("");
  const [drExpectedCost, setDrExpectedCost] = useState<string>("");

  // Reset state when dialog opens (so prefill from a different context is honored)
  useEffect(() => {
    if (!open) return;
    setTaskType(prefill?.task_type ?? "other");
    setVehicleId(prefill?.linked_vehicle_id ?? "");
    setRentalId(prefill?.linked_rental_id ?? "");
    setDescription(prefill?.description ?? "");
    setAddress(prefill?.address ?? "");
    setDueDate(today());
    setPriority("normal");
    setNotifySms(true);
    setBusy(false);
    setVendorId("");
    setVendorName("");
    setContactPhone("");
    setWorkOrder("");
    setPrPartsNeeded("");
    setPrDestination("");
    setRpReason("");
    setRpCustomerName("");
    setRpCustomerPhone("");
    setRpTowAuthorized(false);
    setDrService("");
    setDrDocs({});
    setDrOtherDoc("");
    setDrLocation("");
    setDrExpectedCost("");
  }, [open, prefill]);

  // Load data on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRunnersError(null);
    setRunnersLoading(true);
    (async () => {
      const [{ runners: r }, vRes, rRes, venRes, drRes] = await Promise.all([
        loadRunners({}).catch((e) => {
          console.error("[NewTaskDialog] loadRunners failed:", e);
          if (!cancelled) setRunnersError(e instanceof Error ? e.message : String(e));
          return { runners: [] as Runner[] };
        }),
        supabase.from("vehicles").select("id, year, make, model, plate").order("make"),
        supabase.from("rentals").select("id, vehicle_id, driver_id, start_date").order("start_date", { ascending: false }).limit(200),
        supabase.from("vendors").select("id, name, phone, address, service_type").order("name"),
        supabase.from("drivers").select("id, full_name, phone, address").order("full_name"),
      ]);
      if (cancelled) return;
      setRunners(r);
      setRunnersLoading(false);
      setVehicles((vRes.data ?? []) as Vehicle[]);
      setRentals((rRes.data ?? []) as Rental[]);
      setVendors((venRes.data ?? []) as Vendor[]);
      setDrivers((drRes.data ?? []) as Driver[]);
    })();
    return () => { cancelled = true; };
  }, [open, loadRunners]);

  const selectedRunner = useMemo(() => runners.find((r) => r.id === assignedTo), [runners, assignedTo]);
  const filteredRunners = useMemo(() => {
    const q = runnerSearch.trim().toLowerCase();
    if (!q) return runners;
    return runners.filter((r) => {
      const hay = [r.first_name, r.last_name, r.username, r.phone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [runners, runnerSearch]);
  const selectedIsStaffOnly = assignedTo.startsWith("staff:");
  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId), [vehicles, vehicleId]);
  const isMechanicRun = taskType === "mechanic_run";
  const isPartsRun = taskType === "parts";
  const isRepo = taskType === "repo";
  const isDmv = taskType === "dmv";

  // Auto-fill customer name/phone/address from the linked rental's driver (repo).
  useEffect(() => {
    if (!isRepo || !rentalId) return;
    const rental = rentals.find((r) => r.id === rentalId);
    if (!rental) return;
    const driver = drivers.find((d) => d.id === rental.driver_id);
    if (!driver) return;
    setRpCustomerName((prev) => prev || driver.full_name || "");
    setRpCustomerPhone((prev) => prev || driver.phone || "");
    setAddress((prev) => prev || driver.address || "");
  }, [isRepo, rentalId, rentals, drivers]);

  function onVendorChange(id: string) {
    setVendorId(id);
    setVendorId(id);
    if (id === "__custom" || id === "") {
      return;
    }
    const v = vendors.find((x) => x.id === id);
    if (v) {
      setVendorName(v.name);
      setContactPhone(v.phone ?? "");
      if (v.address) setAddress(v.address);
    }
  }

  const suggestedDescription = useMemo(() => {
    if (description) return description;
    const v = selectedVehicle ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}` : "";
    const label = TASK_TYPE_OPTIONS.find((t) => t.value === taskType)?.label.replace(/^[^\s]+\s/, "") ?? "Task";
    return v ? `${label} ${v}` : label;
  }, [description, selectedVehicle, taskType]);

  function runnerLabel(r: Runner) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || "Runner";
    const base = r.username ? `${name} (${r.username})` : name;
    return `${r.phone ? "📱" : "🚫📱"} ${base}`;
  }

  async function submit() {
    try {
      if (!assignedTo) {
        toast.error("Pick a runner");
        return;
      }
      if (selectedIsStaffOnly) {
        toast.error("This runner has no login yet. Go to Admin → Users to create their account first.");
        return;
      }
      setBusy(true);
      console.log(`About to create task with notify_sms: ${notifySms}`);
      const res = await createTask({ data: {
        assigned_to_user_id: assignedTo,
        task_type: taskType,
        linked_vehicle_id: vehicleId || null,
        linked_rental_id: rentalId || null,
        description: (description || suggestedDescription) || null,
        address: address || null,
        due_date: dueDate || null,
        priority,
        notify_sms: notifySms,
        task_mode: prefill?.mode ?? null,
        mr_vendor_name: isMechanicRun ? (vendorName.trim() || null) : null,
        mr_contact_phone: isMechanicRun ? (contactPhone.trim() || null) : null,
        mr_work_order: isMechanicRun ? (workOrder.trim() || null) : null,
        pr_vendor_name: isPartsRun ? (vendorName.trim() || null) : null,
        pr_contact_phone: isPartsRun ? (contactPhone.trim() || null) : null,
        pr_parts_needed: isPartsRun ? (prPartsNeeded.trim() || null) : null,
        pr_destination: isPartsRun ? (prDestination.trim() || null) : null,
        rp_reason: isRepo ? (rpReason.trim() || null) : null,
        rp_customer_name: isRepo ? (rpCustomerName.trim() || null) : null,
        rp_customer_phone: isRepo ? (rpCustomerPhone.trim() || null) : null,
        rp_tow_authorized: isRepo ? rpTowAuthorized : false,
        dr_service: isDmv ? (drService.trim() || null) : null,
        dr_documents_needed: isDmv ? dmvDocsNeeded : {},
        dr_location: isDmv ? (drLocation.trim() || null) : null,
        dr_expected_cost: isDmv && drExpectedCost.trim() ? Number(drExpectedCost) : null,
      }});
      console.log("Task created successfully");
      console.log(`[NewTaskDialog] Task created. notify_sms was: ${notifySms}, runner_phone: ${selectedRunner?.phone ?? "(none)"}, sms_status: ${res.sms_status}${res.sms_error ? ` (${res.sms_error})` : ""}`);
      if (res.sms_status === "sent") {
        toast.success(`Task created and SMS sent to ${res.runner_name}`);
      } else if (res.sms_status === "failed") {
        toast.error(`Task created but SMS failed — check runner phone number`);
      } else {
        toast.warning(`Task created for ${res.runner_name} — SMS skipped (no phone on file)`);
      }
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[NewTaskDialog] Submit failed:", e);
      toast.error(`Failed to create task: ${errorMsg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Send Task to Runner</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Assigned Runner</Label>
            <Input
              value={runnerSearch}
              onChange={(e) => setRunnerSearch(e.target.value)}
              placeholder="Search runners by name or phone…"
              className="mb-2"
            />
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger><SelectValue placeholder="Pick a runner…" /></SelectTrigger>
              <SelectContent>
                {runnersLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading runners…</div>}
                {!runnersLoading && filteredRunners.length === 0 && runners.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {runnersError ? `Couldn't load runners: ${runnersError}` : "No users with the Runner role yet. Add one in Admin → Users."}
                  </div>
                )}
                {!runnersLoading && filteredRunners.length === 0 && runners.length > 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No matches for "{runnerSearch}".</div>
                )}
                {filteredRunners.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {runnerLabel(r)}{r.phone ? "" : " — no phone"}{r.id.startsWith("staff:") ? " · needs login" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedIsStaffOnly && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠️ This staff runner has no login account. Create one in <a href="/admin/users" className="underline">Admin → Users</a> before assigning tasks.
              </p>
            )}
            {!runnersLoading && runners.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {runnersError
                  ? "If you're not an admin, ask an admin to assign tasks — or sign in with an admin account."
                  : <>Go to <a href="/admin/users" className="underline">Admin → Users</a> and give a user the <strong>Runner</strong> role.</>}
              </p>
            )}
            {selectedRunner && !selectedRunner.phone && (
              <p className="mt-1 text-xs text-amber-600">No phone on file — SMS will be skipped.</p>
            )}
          </div>

          <div>
            <Label>Task Type</Label>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskTypeKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TASK_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Linked Vehicle</Label>
            <Select value={vehicleId || "__none"} onValueChange={(v) => setVehicleId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} — {v.plate}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isMechanicRun && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground">🔧 Mechanic Run Details</p>
              <div>
                <Label>Mechanic / Vendor</Label>
                <Select value={vendorId} onValueChange={onVendorChange}>
                  <SelectTrigger><SelectValue placeholder="Pick a vendor or enter manually…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom">✏️ Enter manually</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}{v.service_type ? ` · ${v.service_type}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="mt-2"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Vendor name"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="mr-phone">Contact Phone</Label>
                <Input id="mr-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="e.g. 215-555-0999" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="mr-wo">Work Order #</Label>
                <Input id="mr-wo" value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} placeholder="e.g. WO-2026-0045" maxLength={120} />
              </div>
            </div>
          )}

          {isPartsRun && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground">🏷️ Parts Run Details</p>
              <div>
                <Label>Vendor</Label>
                <Select value={vendorId} onValueChange={onVendorChange}>
                  <SelectTrigger><SelectValue placeholder="Pick a vendor or enter manually…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom">✏️ Enter manually</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}{v.service_type ? ` · ${v.service_type}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="mt-2"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Vendor name"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="pr-phone">Contact Phone</Label>
                <Input id="pr-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="e.g. 215-555-1234" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="pr-parts">Parts Needed</Label>
                <Textarea id="pr-parts" value={prPartsNeeded} onChange={(e) => setPrPartsNeeded(e.target.value)} rows={2}
                  maxLength={2000} placeholder='e.g. "Transmission fluid (2 quarts), oil filter, air filter"' />
              </div>
              <div>
                <Label htmlFor="pr-dest">Destination</Label>
                <Input id="pr-dest" value={prDestination} onChange={(e) => setPrDestination(e.target.value)}
                  placeholder="e.g. Deliver to ABC Repairs (123 Main St)" maxLength={500} />
              </div>
            </div>
          )}

          {isRepo && (
            <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive">🚨 Repo Details</p>
              <div>
                <Label>Reason</Label>
                <Select value={rpReason || "__none"} onValueChange={(v) => setRpReason(v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select reason…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Non-payment">Non-payment</SelectItem>
                    <SelectItem value="Abandonment">Abandonment</SelectItem>
                    <SelectItem value="Safety Hold">Safety Hold</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rp-name">Customer Name</Label>
                <Input id="rp-name" value={rpCustomerName} onChange={(e) => setRpCustomerName(e.target.value)} placeholder="Auto-filled from rental" maxLength={200} />
              </div>
              <div>
                <Label htmlFor="rp-phone">Customer Phone</Label>
                <Input id="rp-phone" value={rpCustomerPhone} onChange={(e) => setRpCustomerPhone(e.target.value)} placeholder="Auto-filled from rental" maxLength={40} />
              </div>
              <p className="text-xs text-muted-foreground">Set the pickup location in the Address field below and instructions in Description.</p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={rpTowAuthorized} onCheckedChange={(v) => setRpTowAuthorized(v === true)} />
                Tow authorized
              </label>
            </div>
          )}

          <div>
            <Label>Linked Rental (optional)</Label>
            {isRepo && <p className="mb-1 text-xs text-muted-foreground">Link the rental to auto-fill the customer.</p>}
            <Select value={rentalId || "__none"} onValueChange={(v) => setRentalId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {rentals.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.id} · {r.driver_id} · {r.start_date}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              placeholder={suggestedDescription}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="task-addr">Address</Label>
            <Input id="task-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="task-due">Due Date</Label>
            <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div>
            <Label>Priority</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "urgent", l: "🚨 Urgent" },
                { v: "normal", l: "✅ Normal" },
                { v: "flexible", l: "🕐 Flexible" },
              ] as const).map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setPriority(p.v)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    priority === p.v ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background"
                  )}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={notifySms} onCheckedChange={(v) => setNotifySms(v === true)} />
              Notify via SMS
            </label>
            {notifySms && selectedRunner && !selectedRunner.phone && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠️ This runner has no phone on file — SMS will be skipped. They'll only see the task on their My Tasks page when they log in.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !assignedTo}>{busy ? "Sending…" : "Send Task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}