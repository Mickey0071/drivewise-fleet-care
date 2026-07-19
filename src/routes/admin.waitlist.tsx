import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, CheckCircle2, AlertTriangle, Plus, Upload, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWaitlistEntries, markWaitlistSeen, markWaitlistConverted,
  createWaitlistEntryAdmin, updateWaitlistEntry, uploadWaitlistDoc,
} from "@/lib/waitlist.functions";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { sendRentalSms } from "@/lib/rental-sms.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { vehicles } from "@/lib/mock/data";
import { isVehicleBookable, addDriver, addRental, ensureRentalSynced, useStoreVersion } from "@/lib/mock/store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/waitlist")({
  head: () => ({ meta: [{ title: "Waitlist — Camauto Rentals" }] }),
  component: WaitlistAdminPage,
});

type Entry = {
  id: string;
  name: string;
  phone: string;
  email: string;
  license_url: string | null;
  selfie_url: string | null;
  license_front_url: string | null;
  license_back_url: string | null;
  rideshare_proof_url: string | null;
  vehicle_preference: string | null;
  rental_cadence: string | null;
  status: string;
  converted_rental_id: string | null;
  created_at: string;
  source?: string | null;
  admin_notes?: string | null;
};

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleString("en-US") : "—";
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Could not read image"));
    r.readAsDataURL(file);
  });
}

function WaitlistAdminPage() {
  useStoreVersion();
  const list = useServerFn(listWaitlistEntries);
  const seen = useServerFn(markWaitlistSeen);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["waitlist-entries"],
    queryFn: () => list(),
    refetchInterval: 60_000,
  });
  const entries: Entry[] = (data?.entries ?? []) as any;

  // Clear the badge whenever the admin opens this tab.
  useEffect(() => {
    seen().then(() => qc.invalidateQueries({ queryKey: ["waitlist-new-count"] })).catch(() => {});
  }, [seen, qc]);

  const [tab, setTab] = useState<"active" | "converted">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [cardTarget, setCardTarget] = useState<Entry | null>(null);
  const [assignTarget, setAssignTarget] = useState<Entry | null>(null);

  const filtered = entries.filter((e) =>
    tab === "converted" ? e.status === "Converted" : e.status !== "Converted",
  );

  return (
    <div>
      <PageHeader
        title="Waitlist"
        subtitle="Prospective renters waiting for the next available vehicle"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Create Waiter
          </Button>
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant={tab === "active" ? "default" : "outline"} onClick={() => setTab("active")}>
          Active ({entries.filter((e) => e.status !== "Converted").length})
        </Button>
        <Button size="sm" variant={tab === "converted" ? "default" : "outline"} onClick={() => setTab("converted")}>
          Converted ({entries.filter((e) => e.status === "Converted").length})
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Preference</th>
                  <th className="px-3 py-2">Cadence</th>
                  <th className="px-3 py-2">Docs</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {tab === "converted" ? "No converted waiters yet." : "No waitlist entries yet."}
                    </td>
                  </tr>
                )}
                {filtered.map((e) => {
                  const front = e.license_front_url ?? e.license_url;
                  const back = e.license_back_url;
                  const rideshare = e.rideshare_proof_url;
                  const docsComplete = !!front && !!back && !!rideshare;
                  return (
                  <tr key={e.id} className="cursor-pointer border-b hover:bg-muted/20" onClick={() => setCardTarget(e)}>
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2">{e.phone}</td>
                    <td className="px-3 py-2">{e.email}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(e.created_at)}</td>
                    <td className="px-3 py-2 text-xs">
                      <Badge variant="outline" className={e.source === "Admin" ? "bg-blue-500/10 text-blue-700 dark:text-blue-400" : ""}>
                        {e.source ?? "Form"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.vehicle_preference ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{e.rental_cadence ?? "—"}</td>
                    <td className="px-3 py-2">
                      {docsComplete ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Docs complete
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Docs missing
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.status === "Converted" ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Converted
                        </Badge>
                      ) : (
                        <Badge variant="outline">{e.status}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                      {e.status === "Converted" ? (
                        <span className="text-xs text-muted-foreground">{e.converted_rental_id ?? ""}</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setAssignTarget(e)}>
                          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Convert
                        </Button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateWaiterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["waitlist-entries"] });
        }}
      />

      <AssignVehicleDialog
        entry={assignTarget}
        onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
        onDone={() => {
          setAssignTarget(null);
          qc.invalidateQueries({ queryKey: ["waitlist-entries"] });
        }}
      />

      <WaiterCardDialog
        entry={cardTarget}
        onOpenChange={(o) => { if (!o) setCardTarget(null); }}
        onConvert={(e) => { setCardTarget(null); setAssignTarget(e); }}
        onChanged={() => qc.invalidateQueries({ queryKey: ["waitlist-entries"] })}
      />
    </div>
  );
}

function WaiterCardDialog({
  entry, onOpenChange, onConvert, onChanged,
}: {
  entry: Entry | null;
  onOpenChange: (o: boolean) => void;
  onConvert: (e: Entry) => void;
  onChanged: () => void;
}) {
  const update = useServerFn(updateWaitlistEntry);
  const uploadDoc = useServerFn(uploadWaitlistDoc);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pref, setPref] = useState<string>("");
  const [cadence, setCadence] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // Locally track newly-uploaded doc URLs so the UI updates immediately.
  const [localDocs, setLocalDocs] = useState<Partial<Record<"license-front" | "license-back" | "rideshare-proof", string>>>({});

  useEffect(() => {
    if (entry) {
      setName(entry.name ?? "");
      setPhone(entry.phone ?? "");
      setEmail(entry.email ?? "");
      setPref(entry.vehicle_preference ?? "");
      setCadence(entry.rental_cadence ?? "");
      setNotes(entry.admin_notes ?? "");
      setLocalDocs({});
    }
  }, [entry?.id]);

  async function handleUpload(kind: "license-front" | "license-back" | "rideshare-proof", file: File) {
    if (!entry) return;
    setUploading(kind);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await uploadDoc({ data: { id: entry.id, kind, dataUrl } });
      setLocalDocs((p) => ({ ...p, [kind]: res.url }));
      toast.success("Document uploaded");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function handleSave() {
    if (!entry) return;
    setSaving(true);
    try {
      await update({ data: {
        id: entry.id,
        name, phone, email,
        vehiclePreference: pref || null,
        rentalCadence: cadence || null,
        adminNotes: notes ?? null,
      } });
      toast.success("Card updated");
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const docs: Array<{ label: string; kind: "license-front" | "license-back" | "rideshare-proof"; url: string | null }> = entry ? [
    { label: "License — front", kind: "license-front", url: localDocs["license-front"] ?? entry.license_front_url ?? entry.license_url },
    { label: "License — back", kind: "license-back", url: localDocs["license-back"] ?? entry.license_back_url },
    { label: "Rideshare proof", kind: "rideshare-proof", url: localDocs["rideshare-proof"] ?? entry.rideshare_proof_url },
  ] : [];

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry?.name}
            {entry?.source && <Badge variant="outline" className="ml-2">{entry.source}</Badge>}
            {entry?.status === "Converted" && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Converted</Badge>}
          </DialogTitle>
          <div className="text-xs text-muted-foreground">Added {fmtDate(entry?.created_at ?? null)}</div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle preference</Label>
              <Select value={pref || "none"} onValueChange={(v) => setPref(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="No preference" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No preference</SelectItem>
                  <SelectItem value="Sedan">Sedan</SelectItem>
                  <SelectItem value="SUV">SUV</SelectItem>
                  <SelectItem value="Minivan">Minivan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cadence</Label>
              <Select value={cadence || "none"} onValueChange={(v) => setCadence(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="Daily">Daily</SelectItem>
                  <SelectItem value="Weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes about this waiter…" />
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium">Documents</div>
            <div className="grid grid-cols-3 gap-3">
              {docs.map((it) => (
                <div key={it.kind} className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noreferrer">
                      <img src={it.url} alt={it.label} className="h-32 w-full rounded border bg-muted/30 object-contain hover:opacity-90" />
                    </a>
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground">Not uploaded</div>
                  )}
                  <label className="flex cursor-pointer items-center justify-center gap-1 rounded border border-dashed px-2 py-1 text-xs hover:bg-muted/40">
                    <Upload className="h-3 w-3" />
                    {uploading === it.kind ? "Uploading…" : it.url ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(it.kind, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {entry && entry.status !== "Converted" && (
            <Button onClick={() => onConvert(entry)}>
              <ArrowRight className="mr-1.5 h-4 w-4" /> Convert to Reservation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateWaiterDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const create = useServerFn(createWaitlistEntryAdmin);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pref, setPref] = useState("");
  const [cadence, setCadence] = useState<"Daily" | "Weekly" | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendText, setSendText] = useState(true);
  const [smsBody, setSmsBody] = useState(
    "Hi{{name}}, you're on the Camauto Rentals waitlist. Upload your info here so we're ready to roll when a vehicle opens up: {{link}}",
  );
  const sendSmsFn = useServerFn(sendRentalSms);

  useEffect(() => {
    if (open) {
      setName(""); setPhone(""); setEmail(""); setPref(""); setCadence(""); setNotes("");
      setSendText(true);
      setSmsBody("Hi{{name}}, you're on the Camauto Rentals waitlist. Upload your info here so we're ready to roll when a vehicle opens up: {{link}}");
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    try {
      await create({ data: {
        name, phone,
        email: email || undefined,
        vehiclePreference: pref || undefined,
        rentalCadence: cadence || undefined,
        adminNotes: notes || undefined,
      } });
      toast.success("Waiter added");
      if (sendText && phone.trim() && smsBody.trim()) {
        const firstName = name.trim().split(/\s+/)[0] || "";
        const message = smsBody.replace(/\{\{\s*name\s*\}\}/gi, firstName ? ` ${firstName}` : "");
        try {
          await sendSmsFn({ data: { phone: phone.trim(), message, name: name.trim() || undefined } });
          toast.success("Text sent");
        } catch (err) {
          toast.error(err instanceof Error ? `Text failed: ${err.message}` : "Text failed");
        }
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create waiter");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Waiter</DialogTitle>
          <div className="text-xs text-muted-foreground">Only name and phone are required. Documents can be added to the card later.</div>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vehicle preference</Label>
              <Select value={pref || "none"} onValueChange={(v) => setPref(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="No preference" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No preference</SelectItem>
                  <SelectItem value="Sedan">Sedan</SelectItem>
                  <SelectItem value="SUV">SUV</SelectItem>
                  <SelectItem value="Minivan">Minivan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cadence</Label>
              <Select value={cadence || "none"} onValueChange={(v) => setCadence(v === "none" ? "" : (v as any))}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="Daily">Daily</SelectItem>
                  <SelectItem value="Weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={sendText}
                onChange={(e) => setSendText(e.target.checked)}
                className="h-4 w-4"
              />
              Send confirmation text to {phone.trim() || "phone entered"}
            </label>
            {sendText && (
              <>
                <Textarea rows={3} value={smsBody} onChange={(e) => setSmsBody(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">
                  {"{{name}}"} is replaced with the waiter's first name.
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || name.trim().length < 2 || phone.trim().length < 7} onClick={submit}>
            {saving ? "Saving…" : "Add Waiter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignVehicleDialog({
  entry, onOpenChange, onDone,
}: {
  entry: Entry | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  useStoreVersion();
  const convert = useServerFn(markWaitlistConverted);
  const sendLink = useServerFn(sendPaymentLink);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [weeklyRate, setWeeklyRate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const available = useMemo(
    () => vehicles.filter((v) => isVehicleBookable(v.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id, vehicles.length],
  );

  useEffect(() => {
    if (entry) {
      setVehicleId("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setWeeklyRate("");
    }
  }, [entry]);

  const chosen = available.find((v) => v.id === vehicleId);
  useEffect(() => {
    if (chosen && !weeklyRate) {
      setWeeklyRate(String((chosen as any).weeklyRate ?? (chosen as any).weekly_rate ?? ""));
    }
  }, [chosen, weeklyRate]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry || !vehicleId || !startDate) throw new Error("Pick a vehicle and start date");
      const rate = Number(weeklyRate);
      if (!rate || rate <= 0) throw new Error("Enter a valid weekly rate");

      // Create the driver from the waitlist info (license/selfie images carried in).
      const driver = addDriver({
        fullName: entry.name,
        phone: entry.phone,
        email: entry.email,
        licenseImageUrl: (entry.license_front_url ?? entry.license_url) ?? undefined,
      } as any);
      await (driver as any).cloudReady?.catch?.(() => {});

      // Carry over the license-back and rideshare-proof references onto the driver
      // record directly (mock store doesn't map these columns).
      const driverExtras: Record<string, unknown> = {};
      if (entry.license_back_url) driverExtras.license_back_image_url = entry.license_back_url;
      if (entry.rideshare_proof_url) driverExtras.rideshare_proof_url = entry.rideshare_proof_url;
      if (Object.keys(driverExtras).length) {
        await (supabase.from("drivers") as any).update(driverExtras).eq("id", driver.id).then(() => {}, () => {});
      }

      // Create the reservation (defaults to pending, weekly cadence).
      const rental = addRental({
        driverId: driver.id,
        vehicleId,
        startDate,
        billingPeriod: "weekly",
        billingCadence: "weekly",
        rate,
        weeklyRate: rate,
        rateAmount: rate,
        deposit: 0,
        licenseImageUrl: (entry.license_front_url ?? entry.license_url) ?? undefined,
        selfieImageUrl: entry.selfie_url ?? undefined,
      } as any);
      await (rental as any).cloudReady?.catch?.(() => {});

      await convert({ data: { id: entry.id, rentalId: rental.id } });

      // Immediately send the tokenized reservation/payment link via SMS.
      try {
        await ensureRentalSynced(rental.id);
      } catch { /* best-effort */ }
      try {
        await sendLink({ data: {
          phone: entry.phone,
          name: entry.name,
          email: entry.email || null,
          amountCents: Math.round(rate * 100),
          description: `First payment — ${chosen?.year ?? ""} ${chosen?.make ?? ""} ${chosen?.model ?? ""}`.trim().slice(0, 200),
          environment: getStripeEnvironment(),
          rentalId: rental.id,
          sendSms: true,
        } });
      } catch (e) {
        console.error("[waitlist convert] payment link failed", e);
        toast.warning("Reservation created, but SMS payment link could not be sent");
      }
      return rental.id;
    },
    onSuccess: (id) => {
      toast.success(`Reservation ${id} created and payment link sent`);
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not assign vehicle");
    },
    onSettled: () => setSaving(false),
  });

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Vehicle — {entry?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Available Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue placeholder={available.length ? "Choose a vehicle" : "No vehicles available"} /></SelectTrigger>
              <SelectContent>
                {available.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model} · {v.plate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-start">Start date</Label>
              <Input id="wl-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-rate">Weekly rate</Label>
              <Input id="wl-rate" type="number" min="0" step="1" value={weeklyRate} onChange={(e) => setWeeklyRate(e.target.value)} placeholder="500" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!vehicleId || !startDate || !weeklyRate || saving}
            onClick={() => { setSaving(true); mutation.mutate(); }}
          >
            {saving ? "Creating…" : "Create Reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}