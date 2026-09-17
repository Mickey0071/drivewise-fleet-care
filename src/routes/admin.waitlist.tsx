import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, CheckCircle2, AlertTriangle, Plus, Upload, ArrowRight, ShieldCheck, XCircle, RefreshCw, Car } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWaitlistEntries, markWaitlistSeen, markWaitlistConverted,
  createWaitlistEntryAdmin, updateWaitlistEntry, uploadWaitlistDoc,
  reviewWaitlistDocs,
} from "@/lib/waitlist.functions";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { sendRentalSms } from "@/lib/rental-sms.functions";
import { sendSigningLink } from "@/lib/sign.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { vehicles, drivers } from "@/lib/mock/data";
import { isVehicleBookable, addDriver, updateDriver, addRental, ensureRentalSynced, useStoreVersion } from "@/lib/mock/store";
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
  rideshare_checkbox: boolean | null;
  priority: string | null;
  vehicle_preference: string | null;
  rental_cadence: string | null;
  rental_length: string | null;
  status: string;
  converted_rental_id: string | null;
  created_at: string;
  source?: string | null;
  admin_notes?: string | null;
  docs_submitted_at?: string | null;
  docs_approved_at?: string | null;
  docs_rejected_at?: string | null;
  docs_rejection_reason?: string | null;
  license_number?: string | null;
  license_expiration?: string | null;
  link_sent_at?: string | null;
};

/** Waitlisted → Link sent → Docs submitted → Docs approved → Converted */
function statusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case "Converted":
      return { label: "Converted", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
    case "Docs approved":
      return { label: "Docs approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
    case "Docs submitted":
      return { label: "Docs submitted — needs review", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
    case "Docs rejected":
      return { label: "Docs rejected", className: "bg-red-500/15 text-red-700 dark:text-red-400" };
    case "Link sent":
      return { label: "Link sent", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" };
    default:
      return { label: status || "Waitlisted", className: "bg-muted text-muted-foreground" };
  }
}

const STATUS_RANK: Record<string, number> = {
  "Docs approved": 0,
  "Docs submitted": 1,
  "Docs rejected": 2,
  "Link sent": 3,
  Waitlisted: 4,
};

function hasDocs(e: Entry) {
  return !!(e.license_front_url || e.license_url) || !!e.selfie_url;
}

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
  const [reviewTarget, setReviewTarget] = useState<Entry | null>(null);

  const filtered = useMemo(() => {
    const rows = entries.filter((e) =>
      tab === "converted" ? e.status === "Converted" : e.status !== "Converted",
    );
    if (tab === "converted") return rows;
    // Docs approved first, then docs submitted, then everyone else by
    // priority (rideshare first) and join date.
    return [...rows].sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 5;
      const rb = STATUS_RANK[b.status] ?? 5;
      if (ra !== rb) return ra - rb;
      const pa = a.priority === "high" ? 0 : 1;
      const pb = b.priority === "high" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [entries, tab]);

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
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Preference</th>
                  <th className="px-3 py-2">Length</th>
                  <th className="px-3 py-2">Docs</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {tab === "converted" ? "No converted waiters yet." : "No waitlist entries yet."}
                    </td>
                  </tr>
                )}
                {filtered.map((e) => {
                  const front = e.license_front_url ?? e.license_url;
                  const docsComplete = !!front && !!e.selfie_url;
                  const isHigh = e.priority === "high";
                  const approved = e.status === "Docs approved";
                  const meta = statusMeta(e.status);
                  return (
                  <tr key={e.id} className="cursor-pointer border-b hover:bg-muted/20" onClick={() => setCardTarget(e)}>
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2">
                      {isHigh ? (
                        <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">🔥 Rideshare</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Normal</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{e.phone}</td>
                    <td className="px-3 py-2">{e.email}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(e.created_at)}</td>
                    <td className="px-3 py-2 text-xs">
                      <Badge variant="outline" className={e.source === "Admin" ? "bg-blue-500/10 text-blue-700 dark:text-blue-400" : ""}>
                        {e.source ?? "Form"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.vehicle_preference ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{e.rental_length ?? e.rental_cadence ?? "—"}</td>
                    <td className="px-3 py-2">
                      {docsComplete ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> ID + selfie
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mr-1 h-3 w-3" /> {front ? "Selfie missing" : "Docs missing"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                      {e.status === "Converted" ? (
                        <span className="text-xs text-muted-foreground">{e.converted_rental_id ?? ""}</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {hasDocs(e) && !approved && (
                            <Button size="sm" variant="outline" onClick={() => setReviewTarget(e)}>
                              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Review docs
                            </Button>
                          )}
                          {approved ? (
                            <Button size="sm" onClick={() => setAssignTarget(e)}>
                              <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Convert to reservation
                            </Button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                  <Button size="sm" variant="outline" disabled className="pointer-events-none opacity-50">
                                    <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Convert
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Approve docs first</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
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

      <ReviewDocsDialog
        entry={reviewTarget}
        onOpenChange={(o) => { if (!o) setReviewTarget(null); }}
        onChanged={() => qc.invalidateQueries({ queryKey: ["waitlist-entries"] })}
      />

      <WaiterCardDialog
        entry={cardTarget}
        onOpenChange={(o) => { if (!o) setCardTarget(null); }}
        onConvert={(e) => { setCardTarget(null); setAssignTarget(e); }}
        onReview={(e) => { setCardTarget(null); setReviewTarget(e); }}
        onChanged={() => qc.invalidateQueries({ queryKey: ["waitlist-entries"] })}
      />

    </div>
  );
}

function WaiterCardDialog({
  entry, onOpenChange, onConvert, onReview, onChanged,
}: {
  entry: Entry | null;
  onOpenChange: (o: boolean) => void;
  onConvert: (e: Entry) => void;
  onReview: (e: Entry) => void;
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
  const [zoom, setZoom] = useState<{ url: string; label: string } | null>(null);
  // Locally track newly-uploaded doc URLs so the UI updates immediately.
  const [localDocs, setLocalDocs] = useState<Partial<Record<"license-front" | "license-back" | "selfie" | "rideshare-proof", string>>>({});

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

  async function handleUpload(kind: "license-front" | "license-back" | "selfie" | "rideshare-proof", file: File) {
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

  const docs: Array<{ label: string; kind: "license-front" | "license-back" | "selfie" | "rideshare-proof"; url: string | null }> = entry ? [
    { label: "License — front", kind: "license-front", url: localDocs["license-front"] ?? entry.license_front_url ?? entry.license_url },
    { label: "License — back", kind: "license-back", url: localDocs["license-back"] ?? entry.license_back_url },
    { label: "Selfie", kind: "selfie", url: localDocs["selfie"] ?? entry.selfie_url },
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Added {fmtDate(entry?.created_at ?? null)}</span>
            {entry?.priority === "high" && <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">🔥 Rideshare priority</Badge>}
            {(entry?.rental_length || entry?.rental_cadence) && (
              <Badge variant="outline">{entry.rental_length ?? entry.rental_cadence}</Badge>
            )}
          </div>
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
            <div className="grid grid-cols-4 gap-3">
              {docs.map((it) => (
                <div key={it.kind} className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
                  {it.url ? (
                    <button type="button" className="block w-full" onClick={() => setZoom({ url: it.url!, label: it.label })}>
                      <img src={it.url} alt={it.label} className="h-32 w-full cursor-zoom-in rounded border bg-muted/30 object-contain hover:opacity-90" />
                    </button>
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
            <div className="flex gap-2">
              {hasDocs(entry) && entry.status !== "Docs approved" && (
                <Button variant="outline" onClick={() => onReview(entry)}>
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Review docs
                </Button>
              )}
              {entry.status === "Docs approved" ? (
                <Button onClick={() => onConvert(entry)}>
                  <ArrowRight className="mr-1.5 h-4 w-4" /> Convert to Reservation
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button disabled className="pointer-events-none opacity-50">
                        <ArrowRight className="mr-1.5 h-4 w-4" /> Convert to Reservation
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Approve docs first</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </DialogFooter>


        <Dialog open={!!zoom} onOpenChange={(o) => { if (!o) setZoom(null); }}>
          <DialogContent className="max-h-[95vh] max-w-4xl overflow-auto">
            <DialogHeader>
              <DialogTitle>{zoom?.label}</DialogTitle>
            </DialogHeader>
            {zoom && <img src={zoom.url} alt={zoom.label} className="max-h-[75vh] w-full object-contain" />}
            <DialogFooter>
              <a href={zoom?.url} target="_blank" rel="noreferrer" className="text-xs underline">Open in new tab</a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  const [docs, setDocs] = useState<{ front?: string; back?: string; rideshare?: string }>({});
  const [smsBody, setSmsBody] = useState(
    "Hi{{name}}, you're on the Camauto Rentals waitlist. Upload your info here so we're ready to roll when a vehicle opens up: {{link}}",
  );
  const sendSmsFn = useServerFn(sendRentalSms);

  useEffect(() => {
    if (open) {
      setName(""); setPhone(""); setEmail(""); setPref(""); setCadence(""); setNotes("");
      setSendText(true);
      setDocs({});
      setSmsBody("Hi{{name}}, you're on the Camauto Rentals waitlist. Upload your info here so we're ready to roll when a vehicle opens up: {{link}}");
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    try {
      const result = await create({ data: {
        name, phone,
        email: email || undefined,
        vehiclePreference: pref || undefined,
        rentalCadence: cadence || undefined,
        adminNotes: notes || undefined,
        licenseFrontDataUrl: docs.front,
        licenseBackDataUrl: docs.back,
        rideshareProofDataUrl: docs.rideshare,
      } });
      toast.success("Waiter added");
      if (sendText && phone.trim() && smsBody.trim()) {
        const firstName = name.trim().split(/\s+/)[0] || "";
        const uploadLink = result?.uploadToken
          ? `${window.location.origin}/waitlist/upload/${result.uploadToken}`
          : "";
        const message = smsBody
          .replace(/\{\{\s*name\s*\}\}/gi, firstName ? ` ${firstName}` : "")
          .replace(/\{\{\s*link\s*\}\}/gi, uploadLink);
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
          <div className="space-y-1.5">
            <Label>Documents (optional)</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "front" as const, label: "License front" },
                { key: "back" as const, label: "License back" },
                { key: "rideshare" as const, label: "Rideshare proof" },
              ]).map((d) => (
                <label
                  key={d.key}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded border border-dashed p-2 text-center text-[11px] hover:bg-muted/40"
                >
                  {docs[d.key] ? (
                    <img src={docs[d.key]} alt={d.label} className="h-16 w-full rounded object-contain" />
                  ) : (
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>{docs[d.key] ? `${d.label} ✓` : d.label}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      try {
                        const url = await fileToDataUrl(f);
                        setDocs((p) => ({ ...p, [d.key]: url }));
                      } catch {
                        toast.error("Could not read image");
                      }
                    }}
                  />
                </label>
              ))}
            </div>
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

/** PART 1 — review the submitted ID + selfie before anything converts. */
function ReviewDocsDialog({
  entry, onOpenChange, onChanged,
}: {
  entry: Entry | null;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const review = useServerFn(reviewWaitlistDocs);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExp, setLicenseExp] = useState("");
  const [reason, setReason] = useState("");
  const [resendOnReject, setResendOnReject] = useState(true);
  const [busy, setBusy] = useState<null | "approve" | "reject" | "request">(null);
  const [zoom, setZoom] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (entry) {
      setLicenseNumber(entry.license_number ?? "");
      setLicenseExp(entry.license_expiration ?? "");
      setReason("");
      setResendOnReject(true);
    }
  }, [entry?.id]);

  const licenseUrl = entry ? (entry.license_front_url ?? entry.license_url) : null;
  const selfieUrl = entry?.selfie_url ?? null;

  async function act(action: "approve" | "reject" | "request") {
    if (!entry) return;
    if (action === "reject" && reason.trim().length < 3) {
      toast.error("Enter a reason for the rejection");
      return;
    }
    setBusy(action);
    try {
      const res = await review({ data: {
        id: entry.id,
        action,
        reason: reason.trim() || undefined,
        resendLink: action === "request" ? true : action === "reject" ? resendOnReject : false,
        licenseNumber: licenseNumber || null,
        licenseExpiration: licenseExp || null,
        origin: window.location.origin,
      } });
      toast.success(
        action === "approve"
          ? "Docs approved — ready to convert"
          : action === "reject"
            ? res.smsSent ? "Docs rejected and new upload link texted" : "Docs rejected"
            : "New photo request texted",
      );
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the review");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Review documents — {entry?.name}
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-3">
              <div><div className="text-xs text-muted-foreground">Name</div>{entry.name}</div>
              <div><div className="text-xs text-muted-foreground">Phone</div>{entry.phone || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Email</div>{entry.email || "—"}</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Driver's license — front", url: licenseUrl },
                { label: "Selfie", url: selfieUrl },
              ].map((it) => (
                <div key={it.label} className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
                  {it.url ? (
                    <button type="button" className="block w-full" onClick={() => setZoom({ url: it.url!, label: it.label })}>
                      <img src={it.url} alt={it.label} className="max-h-72 w-full cursor-zoom-in rounded border bg-muted/30 object-contain hover:opacity-90" />
                    </button>
                  ) : (
                    <div className="flex h-72 items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground">
                      Not uploaded
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wl-dl">License number</Label>
                <Input id="wl-dl" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="As shown on the license" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wl-dl-exp">License expiration</Label>
                <Input id="wl-dl-exp" value={licenseExp} onChange={(e) => setLicenseExp(e.target.value)} placeholder="MM/DD/YYYY" />
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="wl-reason">Reason (required to reject)</Label>
              <Textarea id="wl-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Blurry photo, expired license, name mismatch…" />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="h-4 w-4" checked={resendOnReject} onChange={(e) => setResendOnReject(e.target.checked)} />
                Also text a new upload link when rejecting
              </label>
            </div>

            {entry.status === "Docs rejected" && entry.docs_rejection_reason && (
              <p className="text-xs text-red-600">Previously rejected: {entry.docs_rejection_reason}</p>
            )}
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" disabled={!!busy} onClick={() => act("request")}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> {busy === "request" ? "Sending…" : "Request new photos"}
          </Button>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={!!busy} onClick={() => act("reject")}>
              <XCircle className="mr-1.5 h-4 w-4" /> {busy === "reject" ? "Saving…" : "Reject docs"}
            </Button>
            <Button disabled={!!busy || !licenseUrl || !selfieUrl} onClick={() => act("approve")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> {busy === "approve" ? "Saving…" : "Approve docs"}
            </Button>
          </div>
        </DialogFooter>

        <Dialog open={!!zoom} onOpenChange={(o) => { if (!o) setZoom(null); }}>
          <DialogContent className="max-h-[95vh] max-w-5xl overflow-auto">
            <DialogHeader><DialogTitle>{zoom?.label}</DialogTitle></DialogHeader>
            {zoom && <img src={zoom.url} alt={zoom.label} className="max-h-[78vh] w-full object-contain" />}
            <DialogFooter>
              <a href={zoom?.url} target="_blank" rel="noreferrer" className="text-xs underline">Open in new tab</a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

const RATE_MODES = {
  Daily: { days: 1, label: "day" },
  Weekly: { days: 7, label: "week" },
  Monthly: { days: 28, label: "month" },
} as const;
type RateMode = keyof typeof RATE_MODES;

function digitsOnly(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

/** Loose match of a stated preference (Sedan/SUV/Minivan) against a vehicle. */
function matchesPreference(pref: string | null | undefined, v: any): boolean {
  const p = (pref ?? "").trim().toLowerCase();
  if (!p) return false;
  const text = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.notes ?? ""}`.toLowerCase();
  if (text.includes(p)) return true;
  const seats = Number(v.seats ?? 0);
  if (p === "suv") return seats >= 5 && seats <= 7 && /suv|explorer|equinox|rogue|rav4|cr-?v|highlander|pilot|tahoe|traverse/.test(text);
  if (p === "minivan") return seats >= 7 || /odyssey|sienna|pacifica|carnival|caravan/.test(text);
  if (p === "sedan") return /accord|camry|altima|malibu|civic|corolla|sonata|elantra|impala|jetta|sentra|fusion/.test(text);
  return false;
}

/**
 * PART 2 + 3 — creates a brand new reservation from the waitlist entry.
 * Nothing here loads an existing reservation: the driver and rental rows are
 * created, verified in the database, then the waiter is flagged Converted.
 */
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
  const sendAgreement = useServerFn(sendSigningLink);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<RateMode>("Weekly");
  const [units, setUnits] = useState<string>("1");
  const [rate, setRate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const unitCount = Math.max(1, Math.floor(Number(units) || 1));
  const endDate = useMemo(() => {
    const d = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return startDate;
    d.setDate(d.getDate() + RATE_MODES[mode].days * unitCount);
    return d.toISOString().slice(0, 10);
  }, [startDate, mode, unitCount]);

  // Only genuinely available vehicles: not archived, not rented/off-road/in
  // repair/impound/awaiting inspection, and free for the whole chosen window.
  const available = useMemo(() => {
    const list = vehicles.filter((v) => isVehicleBookable(v.id, startDate, endDate));
    return list
      .map((v) => ({ v, match: matchesPreference(entry?.vehicle_preference, v) }))
      .sort((a, b) =>
        a.match === b.match
          ? `${a.v.year} ${a.v.make} ${a.v.model}`.localeCompare(`${b.v.year} ${b.v.make} ${b.v.model}`)
          : a.match ? -1 : 1,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.vehicle_preference, startDate, endDate, vehicles.length]);

  useEffect(() => {
    if (entry) {
      setVehicleId("");
      setStartDate(new Date().toISOString().slice(0, 10));
      const stated = `${entry.rental_length ?? ""} ${entry.rental_cadence ?? ""}`.toLowerCase();
      setMode(stated.includes("daily") ? "Daily" : stated.includes("2+") ? "Monthly" : "Weekly");
      setUnits(stated.includes("2+") ? "1" : "1");
      setRate("");
    }
  }, [entry?.id]);

  const chosen = available.find((o) => o.v.id === vehicleId)?.v as any;

  // Default the rate from the vehicle's own pricing whenever the vehicle or
  // billing period changes, unless the admin has typed their own number.
  useEffect(() => {
    if (!chosen) return;
    const weekly = Number(chosen.weeklyRate ?? 0);
    const daily = Number(chosen.dailyRate ?? 0);
    const suggested = mode === "Daily" ? daily : mode === "Weekly" ? weekly : weekly * 4;
    setRate(suggested ? String(Math.round(suggested)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, mode]);

  const ratePerPeriod = Number(rate) || 0;
  const total = ratePerPeriod * unitCount;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No waitlist entry selected");
      if (entry.status !== "Docs approved") throw new Error("Approve the documents before converting");
      if (!vehicleId) throw new Error("Pick an available vehicle");
      if (!startDate) throw new Error("Pick a start date");
      if (ratePerPeriod <= 0) throw new Error("Enter a valid rate");

      const licenseImageUrl = (entry.license_front_url ?? entry.license_url) ?? undefined;
      // Monthly is billed as 4-week blocks so the existing weekly billing
      // cycle keeps working; daily stays daily.
      const cadence: "daily" | "weekly" = mode === "Daily" ? "daily" : "weekly";
      const perCycleRate = mode === "Monthly" ? Math.round(ratePerPeriod / 4) : ratePerPeriod;

      // 1) Driver — dedupe on phone digits, otherwise create.
      const phoneKey = digitsOnly(entry.phone);
      const existing = phoneKey
        ? drivers.find((d) => digitsOnly(d.phone ?? "") === phoneKey)
        : undefined;
      let driverId: string;
      if (existing) {
        driverId = existing.id;
        await updateDriver(existing.id, {
          fullName: existing.fullName || entry.name,
          email: existing.email || entry.email,
          ...(licenseImageUrl ? { licenseImageUrl } : {}),
          ...(entry.license_number ? { licenseNumber: entry.license_number } : {}),
          ...(entry.license_expiration ? { licenseExpiry: entry.license_expiration } : {}),
        } as any).catch(() => {});
      } else {
        const driver = addDriver({
          fullName: entry.name,
          phone: entry.phone,
          email: entry.email,
          licenseImageUrl,
          licenseNumber: entry.license_number ?? undefined,
          licenseExpiry: entry.license_expiration ?? undefined,
        } as any);
        try {
          await (driver as any).cloudReady;
        } catch (err) {
          throw new Error(`Renter record could not be saved: ${err instanceof Error ? err.message : "unknown error"}`);
        }
        driverId = driver.id;
      }

      // 2) Carry the remaining photos onto the driver record.
      const driverExtras: Record<string, unknown> = {};
      if (entry.selfie_url) driverExtras.selfie_image_url = entry.selfie_url;
      if (entry.license_back_url) driverExtras.license_back_image_url = entry.license_back_url;
      if (entry.rideshare_proof_url) driverExtras.rideshare_proof_url = entry.rideshare_proof_url;
      if (Object.keys(driverExtras).length) {
        await (supabase.from("drivers") as any).update(driverExtras).eq("id", driverId).then(() => {}, () => {});
      }

      // 3) Create the reservation.
      const rental = addRental({
        driverId,
        vehicleId,
        startDate,
        endDate,
        billingPeriod: cadence,
        billingCadence: cadence,
        rate: perCycleRate,
        weeklyRate: perCycleRate,
        rateAmount: perCycleRate,
        baseAmount: total,
        deposit: 0,
        reservationStatus: "active",
        createdFromWaitlist: true,
        licenseImageUrl,
        selfieImageUrl: entry.selfie_url ?? undefined,
      } as any);
      try {
        await (rental as any).cloudReady;
      } catch (err) {
        throw new Error(`Reservation could not be saved: ${err instanceof Error ? err.message : "unknown error"}`);
      }

      // The row MUST exist before the waiter is marked converted.
      await ensureRentalSynced(rental.id);
      const { data: savedRow, error: verifyErr } = await (supabase
        .from("rentals") as any)
        .select("id")
        .eq("id", rental.id)
        .maybeSingle();
      if (verifyErr) throw new Error(verifyErr.message);
      if (!savedRow) throw new Error("Reservation could not be saved — waiter left on the list");
      await (supabase.from("rentals") as any)
        .update({ created_from_waitlist: true, end_date: endDate, reservation_status: "active" })
        .eq("id", rental.id)
        .then(() => {}, () => {});

      // 4) Agreement signing link to the renter.
      let agreementSent = false;
      try {
        await sendAgreement({ data: { rentalId: rental.id, origin: window.location.origin } });
        agreementSent = true;
      } catch (e) {
        console.error("[waitlist convert] agreement link failed", e);
        toast.warning("Reservation created, but the agreement link could not be sent");
      }

      // 5) Payment link (best effort — the reservation already exists).
      let paymentLinkSentAt: string | null = null;
      try {
        await sendLink({ data: {
          phone: entry.phone,
          name: entry.name,
          email: entry.email || null,
          amountCents: Math.round(perCycleRate * 100),
          description: `First payment — ${chosen?.year ?? ""} ${chosen?.make ?? ""} ${chosen?.model ?? ""}`.trim().slice(0, 200),
          environment: getStripeEnvironment(),
          rentalId: rental.id,
          sendSms: true,
        } });
        paymentLinkSentAt = new Date().toISOString();
      } catch (e) {
        console.error("[waitlist convert] payment link failed", e);
        toast.warning("Reservation created, but the SMS payment link could not be sent");
      }

      // 6) Flag the waiter converted and link the reservation.
      await convert({ data: { id: entry.id, rentalId: rental.id, paymentLinkSentAt } });
      return { id: rental.id, agreementSent };
    },
    onSuccess: ({ id, agreementSent }) => {
      toast.success(`✅ Converted — reservation ${id} created${agreementSent ? " and agreement link sent" : ""}`);
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not create the reservation");
    },
    onSettled: () => setSaving(false),
  });

  const noneAvailable = available.length === 0;

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create reservation — {entry?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
            <div><div className="text-xs text-muted-foreground">Name</div>{entry?.name}</div>
            <div><div className="text-xs text-muted-foreground">Phone</div>{entry?.phone || "—"}</div>
            <div><div className="text-xs text-muted-foreground">Email</div>{entry?.email || "—"}</div>
            <div><div className="text-xs text-muted-foreground">Stated length</div>{entry?.rental_length ?? entry?.rental_cadence ?? "—"}</div>
            <div><div className="text-xs text-muted-foreground">Vehicle preference</div>{entry?.vehicle_preference ?? "No preference"}</div>
            <div className="flex items-end gap-2 text-xs text-muted-foreground">
              {(entry?.license_front_url ?? entry?.license_url) && <span>License ✓</span>}
              {entry?.selfie_url && <span>Selfie ✓</span>}
            </div>
          </div>

          {noneAvailable ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" /> No vehicles available — keep on waitlist
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Every vehicle is on rent, off road, or already booked for these dates. Try different dates or free up a vehicle.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Available vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Choose a vehicle" /></SelectTrigger>
                <SelectContent>
                  {available.map(({ v, match }) => (
                    <SelectItem key={v.id} value={v.id}>
                      <span className="flex items-center gap-2">
                        <Car className="h-3.5 w-3.5" />
                        {v.year} {v.make} {v.model} · {v.plate} · ${Math.round(Number((v as any).dailyRate ?? 0))}/day · ${Math.round(Number((v as any).weeklyRate ?? 0))}/wk
                        {match && <Badge className="ml-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Matches preference</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-start">Start date</Label>
              <Input id="wl-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Rate period</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as RateMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Daily">Daily</SelectItem>
                  <SelectItem value="Weekly">Weekly</SelectItem>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-units">{RATE_MODES[mode].label === "day" ? "Days" : RATE_MODES[mode].label === "week" ? "Weeks" : "Months"}</Label>
              <Input id="wl-units" type="number" min="1" step="1" value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-rate">Rate per {RATE_MODES[mode].label}</Label>
              <Input id="wl-rate" type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="500" />
            </div>
            <div className="space-y-1.5">
              <Label>Total</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold">
                ${total.toLocaleString("en-US")}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {unitCount} × {RATE_MODES[mode].label} · ends {endDate}
                </span>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={noneAvailable || !vehicleId || !startDate || ratePerPeriod <= 0 || saving}
            onClick={() => { setSaving(true); mutation.mutate(); }}
          >
            {saving ? "Creating…" : "Create reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
