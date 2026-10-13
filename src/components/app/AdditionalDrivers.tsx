import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Users, Loader2, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ensureRentalSynced } from "@/lib/mock/store";
import {
  inviteAdditionalDriver,
  listAdditionalDrivers,
  listApprovedDriverCounts,
  reviewAdditionalDriver,
} from "@/lib/additional-drivers.functions";

const COUNTS_KEY = ["additional-driver-counts"];

/* ───────── Badge: "+1 driver" ───────── */
export function AdditionalDriversBadge({ rentalId }: { rentalId: string }) {
  const fn = useServerFn(listApprovedDriverCounts);
  const { data } = useQuery({ queryKey: COUNTS_KEY, queryFn: () => fn(), staleTime: 60_000 });
  const names = data?.[rentalId] ?? [];
  if (names.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-lg bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/25">
          +{names.length} driver{names.length === 1 ? "" : "s"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 text-sm" align="end">
        <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Approved additional drivers</div>
        <ul className="space-y-0.5">{names.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </PopoverContent>
    </Popover>
  );
}

/* ───────── Invite button + dialog ───────── */
export function AddAdditionalDriverButton({ rentalId, renterName, renterPhone }: { rentalId: string; renterName: string; renterPhone: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [payer, setPayer] = useState(false);
  const [busy, setBusy] = useState(false);
  const invite = useServerFn(inviteAdditionalDriver);
  const qc = useQueryClient();

  async function send() {
    setBusy(true);
    try {
      try { await ensureRentalSynced(rentalId); } catch { /* best effort */ }
      await invite({ data: { rentalId, invitedName: name.trim() || undefined, isAlsoPayer: payer } });
      toast.success(`Invite texted to ${renterName || "the renter"}`);
      qc.invalidateQueries({ queryKey: ["additional-drivers", rentalId] });
      setOpen(false); setName(""); setPayer(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-4 w-4" /> Add Additional Driver
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add additional driver</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs uppercase text-muted-foreground">Primary renter</div>
              <div className="font-medium">{renterName || "—"}</div>
              <div className="text-muted-foreground">{renterPhone || "No phone on file"}</div>
            </div>
            <div className="space-y-1.5">
              <Label>Additional driver's name (optional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="If you know it" />
            </div>
            <label className="flex items-start gap-2">
              <Checkbox checked={payer} onCheckedChange={(v) => setPayer(v === true)} className="mt-0.5" />
              <span>This person will also be paying for the rental</span>
            </label>
            <p className="text-xs text-muted-foreground">
              A one-time link (valid 7 days) is texted to the primary renter to forward. Nobody is authorized until you approve them.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={send} disabled={busy || !renterPhone}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send invite to renter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────── Review section ───────── */
const STATUS_STYLE: Record<string, string> = {
  invited: "bg-muted text-muted-foreground",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-primary/15 text-primary",
  rejected: "bg-destructive/15 text-destructive",
  revoked: "bg-destructive/15 text-destructive",
};
const STATUS_LABEL: Record<string, string> = {
  invited: "Invite sent", pending: "Pending review", approved: "Approved", rejected: "Rejected", revoked: "Revoked",
};

export function AdditionalDriversSection({ rentalId }: { rentalId: string }) {
  const listFn = useServerFn(listAdditionalDrivers);
  const reviewFn = useServerFn(reviewAdditionalDriver);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["additional-drivers", rentalId],
    queryFn: () => listFn({ data: { rentalId } }),
  });
  const [zoom, setZoom] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; action: "reject" | "revoke" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject" | "revoke", why?: string) {
    setBusy(id);
    try {
      await reviewFn({ data: { id, action, reason: why } });
      toast.success(action === "approve" ? "Driver approved — both parties texted" : action === "reject" ? "Rejected — both parties texted" : "Authorization revoked — both parties texted");
      qc.invalidateQueries({ queryKey: ["additional-drivers", rentalId] });
      qc.invalidateQueries({ queryKey: COUNTS_KEY });
      setReasonFor(null); setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Users className="h-4 w-4" /> Additional Drivers
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading…</div>
      ) : !data?.length ? (
        <div className="text-sm text-muted-foreground">No additional drivers on this rental.</div>
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <Card key={d.id} className="space-y-3 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{d.fullName || d.invitedName || "Awaiting submission"}{d.isAlsoPayer && <span className="ml-2 text-xs font-normal text-muted-foreground">· also paying</span>}</div>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.status] ?? ""}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
              </div>

              {d.status === "invited" ? (
                <p className="text-xs text-muted-foreground">Link sent {new Date(d.createdAt).toLocaleString()} · expires {new Date(d.tokenExpiresAt).toLocaleDateString()}</p>
              ) : (
                <>
                  {d.flags.length > 0 && (
                    <div className="space-y-1 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                      {d.flags.map((f, i) => <div key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{f}</div>)}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <Row k="DOB" v={d.dateOfBirth} />
                    <Row k="Phone" v={d.phone} />
                    <Row k="Email" v={d.email} />
                    <Row k="Address" v={d.address} />
                    <Row k="License" v={[d.licenseState, d.licenseNumber].filter(Boolean).join(" ")} />
                    <Row k="Expires" v={d.licenseExpiration} />
                    <Row k="OCR check" v={d.ocrMatchStatus === "match" ? "License # matches photo" : d.ocrMatchStatus === "mismatch" ? "Mismatch" : "Could not read"} />
                    <Row k="Submitted" v={d.submittedAt ? new Date(d.submittedAt).toLocaleString() : null} />
                    {d.revokedAt && <Row k="Revoked" v={new Date(d.revokedAt).toLocaleString()} />}
                    {d.rejectionReason && <Row k="Reason" v={d.rejectionReason} />}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[["License", d.licenseUrl], ["Selfie", d.selfieUrl]].map(([label, url]) => (
                      <button key={label} type="button" className="overflow-hidden rounded border bg-muted/30" onClick={() => url && setZoom(url)}>
                        {url ? <img src={url} alt={label ?? ""} className="h-36 w-full object-contain" /> : <div className="h-36" />}
                        <div className="border-t py-0.5 text-[11px] text-muted-foreground">{label}</div>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    {Object.keys(d.acknowledgements).length} of 5 acknowledgements confirmed
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.addendumUrl && (
                      <Button size="sm" variant="outline" asChild><a href={d.addendumUrl} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" />Signed addendum</a></Button>
                    )}
                    {d.status === "pending" && (
                      <>
                        <Button size="sm" disabled={busy === d.id} onClick={() => act(d.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="destructive" disabled={busy === d.id} onClick={() => setReasonFor({ id: d.id, action: "reject" })}>Reject</Button>
                      </>
                    )}
                    {d.status === "approved" && (
                      <Button size="sm" variant="destructive" disabled={busy === d.id} onClick={() => setReasonFor({ id: d.id, action: "revoke" })}>Revoke</Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-3xl">{zoom && <img src={zoom} alt="Document" className="max-h-[80vh] w-full object-contain" />}</DialogContent>
      </Dialog>

      <Dialog open={!!reasonFor} onOpenChange={(o) => { if (!o) { setReasonFor(null); setReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{reasonFor?.action === "reject" ? "Reject additional driver" : "Revoke authorization"}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason{reasonFor?.action === "reject" ? " (required)" : " (optional)"}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            <p className="text-xs text-muted-foreground">Both the driver and the primary renter will be texted.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reasonFor || busy === reasonFor.id || (reasonFor.action === "reject" && !reason.trim())}
              onClick={() => reasonFor && act(reasonFor.id, reasonFor.action, reason.trim() || undefined)}
            >
              {reasonFor?.action === "reject" ? "Reject" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return <div><span className="text-muted-foreground">{k}: </span>{v || "—"}</div>;
}

export { Badge as _unusedBadge };
