import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createMechanicJob } from "@/lib/mechanic-jobs.functions";
import { addMaintenance } from "@/lib/mock/store";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Copy, ExternalLink, Wrench } from "lucide-react";
import { toast } from "sonner";
import { getPublicAppOrigin } from "@/lib/public-origin";

/**
 * The 11 canonical Basic Mechanic Inspection items.
 * OBD codes are captured in the item's notes field on the mechanic checklist form.
 */
export const BASIC_MECHANIC_INSPECTION: { id: string; label: string }[] = [
  { id: "engine_oil", label: "Engine oil — level & condition" },
  { id: "oil_leaks", label: "Oil leaks" },
  { id: "struts_shocks", label: "Struts / shocks" },
  { id: "obd_scan", label: "OBD scan — list any stored or pending codes in notes" },
  { id: "belt_tensioner", label: "Belt tensioner" },
  { id: "pulleys", label: "Pulleys" },
  { id: "serpentine_belt", label: "Serpentine belt condition" },
  { id: "brakes", label: "Brakes — pads & rotors" },
  { id: "tires", label: "Tires" },
  { id: "battery_charging", label: "Battery / charging system" },
  { id: "fluid_levels", label: "Fluid levels — coolant, brake, transmission" },
];

const CUSTOM = "__custom__";

interface VendorOption { id: string; name: string; phone: string; service_type: string | null }

export function SendVehicleToMechanicDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleLabel,
  plate,
  mileage,
  adminName,
  contextLabel,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicleId: string;
  vehicleLabel: string;
  plate?: string;
  mileage: number;
  adminName?: string;
  /** e.g. "Returned rental RES-123" or "Available fleet" — added to ticket notes. */
  contextLabel?: string;
  onSent?: () => void;
}) {
  const createFn = useServerFn(createMechanicJob);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selected, setSelected] = useState<string>(CUSTOM);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [shop, setShop] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sentLink, setSentLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSentLink(null);
    setNotes("");
    supabase
      .from("vendors")
      .select("id, name, phone, service_type")
      .order("name", { ascending: true })
      .then(({ data }) => setVendors((data ?? []) as VendorOption[]));
  }, [open]);

  function pick(value: string) {
    setSelected(value);
    if (value === CUSTOM) { setName(""); setPhone(""); setShop(""); return; }
    const v = vendors.find((x) => x.id === value);
    if (v) { setName(v.name ?? ""); setPhone(v.phone ?? ""); setShop(v.service_type ?? ""); }
  }

  async function submit() {
    if (!name.trim()) { toast.error("Mechanic name required"); return; }
    if (!phone.trim()) { toast.error("Mechanic phone required"); return; }
    setSending(true);
    try {
      // 1) Auto-create the maintenance ticket for this vehicle.
      const today = new Date().toISOString().slice(0, 10);
      const ticket = addMaintenance({
        vehicleId,
        serviceType: "Basic Mechanic Inspection",
        vendor: name.trim(),
        cost: 0,
        dateCompleted: "",
        mileageAtService: mileage || 0,
        nextServiceDue: today,
        notes: [
          contextLabel ? `Source: ${contextLabel}` : "",
          `Sent to ${name.trim()}${shop.trim() ? ` (${shop.trim()})` : ""} for basic mechanic inspection.`,
          notes.trim() ? `Admin notes: ${notes.trim()}` : "",
        ].filter(Boolean).join("\n"),
        issueDescription: "Basic Mechanic Inspection",
        status: "diagnosing",
        isRentalBlocking: true,
        mechanicName: name.trim(),
        source: "mechanic_inspection",
      });

      // 2) Fire the mechanic job (SMS + token link) with the canonical 11-item checklist.
      const res = await createFn({
        data: {
          maintenanceId: ticket.id,
          vehicleId,
          mechanicName: name.trim(),
          mechanicPhone: phone.trim(),
          mechanicShop: shop.trim() || undefined,
          issueDescription: "Basic Mechanic Inspection",
          additionalContext: notes.trim() || undefined,
          checklistItems: BASIC_MECHANIC_INSPECTION,
          vehicleLabel,
          plate,
          createdByAdmin: adminName,
        },
      });

      const link = `${getPublicAppOrigin()}/mechanic-job/${res.token}`;
      setSentLink(link);
      toast.success(`✓ Basic inspection sent to ${name.trim()}`);
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Send to Mechanic — Basic Inspection
          </DialogTitle>
        </DialogHeader>
        {sentLink ? (
          <div className="space-y-3">
            <p className="text-sm">
              A maintenance ticket was opened for <span className="font-medium">{vehicleLabel}</span> and the checklist link
              was texted to <span className="font-medium">{name}</span>.
            </p>
            <div className="rounded-md border bg-muted/40 p-2 text-xs break-all font-mono">{sentLink}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(sentLink); toast.success("Link copied"); }}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.open(sentLink, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open link (complete in-app)
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)} className="ml-auto">Done</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Admin can complete or edit the checklist on behalf of the mechanic by opening the same link.
              Parts totals feed the existing repair-approval flow — nothing is auto-approved.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                <span className="font-medium">Vehicle:</span> {vehicleLabel}{plate ? ` · Plate ${plate}` : ""}
                {contextLabel ? <div className="mt-0.5 text-muted-foreground">{contextLabel}</div> : null}
              </div>
              <div>
                <Label className="text-xs">Mechanic (from Vendors)</Label>
                <Select value={selected} onValueChange={pick}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Select a mechanic" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CUSTOM}>Custom number</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}{v.phone ? ` · ${v.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Mechanic name</Label>
                  <Input className="mt-1 h-8" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Mechanic phone</Label>
                  <Input className="mt-1 h-8" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Shop (optional)</Label>
                <Input className="mt-1 h-8" value={shop} onChange={(e) => setShop(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Additional notes for the mechanic (optional)</Label>
                <Textarea className="mt-1 min-h-[56px] text-xs"
                  placeholder="Anything you noticed, symptoms to focus on, etc."
                  value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="rounded-md border p-3 text-xs">
                <div className="mb-1 font-medium">Checklist that will be sent:</div>
                <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                  {BASIC_MECHANIC_INSPECTION.map((i) => <li key={i.id}>{i.label}</li>)}
                </ul>
                <p className="mt-2 text-[11px]">
                  Each item captures Pass / Fail / N/A with a notes field. The link also includes the parts &
                  pricing line-items and a Mechanic Recommendations box. Results save back to the maintenance ticket.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button disabled={sending} onClick={submit}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1 h-4 w-4" /> Send to Mechanic</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}