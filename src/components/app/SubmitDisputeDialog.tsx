import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getViolationSubmissionDetail,
  submitViolationToAuthority,
  markViolationResolved,
  type ViolationRow,
} from "@/lib/violations.functions";

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

export const AUTHORITY_OPTIONS = ["EZPass", "NJ DMV", "NY DMV", "PA DOT", "Other"];
export const METHOD_OPTIONS = ["Email", "Mail", "Online Portal", "Phone"];
export const RESOLUTION_REASONS = [
  "Liability transferred",
  "Customer paid authority directly",
  "Dismissed",
  "Other",
];

function TimelineRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${value ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
      />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {value ? new Date(value).toLocaleString() : "—"}
        </div>
      </div>
    </div>
  );
}

export function SubmitDisputeDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const detailFn = useServerFn(getViolationSubmissionDetail);
  const submitFn = useServerFn(submitViolationToAuthority);
  const resolveFn = useServerFn(markViolationResolved);

  const [authority, setAuthority] = useState("EZPass");
  const [method, setMethod] = useState("Email");
  const [confirmation, setConfirmation] = useState("");
  const [subNotes, setSubNotes] = useState("");
  const [resReason, setResReason] = useState("Liability transferred");
  const [resNotes, setResNotes] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["violation-detail", violation?.id],
    queryFn: () => detailFn({ data: { id: violation!.id } }),
    enabled: !!violation,
  });

  useEffect(() => {
    if (detail) setEmailDraft(detail.emailBody);
  }, [detail]);

  if (!violation) return null;

  const copyEmail = async () => {
    const text = detail ? `Subject: ${detail.emailSubject}\n\n${emailDraft}` : emailDraft;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Email copied to clipboard");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const markSubmitted = async () => {
    setBusy(true);
    try {
      await submitFn({
        data: {
          id: violation.id,
          authority,
          method,
          confirmationNumber: confirmation,
          notes: subNotes,
        },
      });
      toast.success(`Marked submitted to ${authority}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const markResolved = async () => {
    if (!resReason.trim()) {
      toast.error("Resolution reason required");
      return;
    }
    setBusy(true);
    try {
      await resolveFn({ data: { id: violation.id, reason: resReason, notes: resNotes } });
      toast.success("Violation resolved");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const isSigned = violation.status === "affidavit_signed";
  const isSubmitted = violation.status === "submitted_to_authority";
  const isResolved = violation.status === "resolved";

  return (
    <Dialog open={!!violation} onOpenChange={(b) => { if (!b) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Violation Dispute — {violation.id}</DialogTitle>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Customer</div>
                <div className="font-medium">{detail.driver?.fullName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{detail.driver?.email ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{detail.driver?.phone ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  DL: {detail.driver?.licenseNumber ?? "—"}
                  {detail.driver?.dlState ? ` (${detail.driver.dlState})` : ""}
                </div>
                <div className="text-xs text-muted-foreground">{detail.driver?.address ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Violation</div>
                <div className="font-medium">{fmtMoney(detail.amount)}</div>
                <div className="text-xs text-muted-foreground">Date: {fmtDate(detail.dateIssued)}</div>
                <div className="text-xs text-muted-foreground">Plate: {detail.plate ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{detail.vehicleLabel}</div>
                <div className="text-xs text-muted-foreground">
                  Signed: {detail.signedAt ? new Date(detail.signedAt).toLocaleString() : "—"}
                  {detail.signedName ? ` by ${detail.signedName}` : ""}
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="flex flex-wrap gap-2">
              {detail.signedPdfUrl ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={detail.signedPdfUrl} target="_blank" rel="noreferrer" download>
                    📄 Download Affidavit PDF
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>No affidavit PDF</Button>
              )}
              {detail.licenseUrl ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={detail.licenseUrl} target="_blank" rel="noreferrer" download>
                    🪪 Download License Copy
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>No license on file</Button>
              )}
              {detail.agreementUrl ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={detail.agreementUrl} target="_blank" rel="noreferrer" download>
                    📑 Download Rental Agreement
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>No rental agreement</Button>
              )}
            </div>

            {/* Email template */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Pre-formatted Email (editable)</Label>
                <Button size="sm" variant="secondary" onClick={copyEmail}>
                  📋 Copy to Clipboard
                </Button>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Subject: {detail.emailSubject}
              </div>
              <Textarea
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>

            {/* Mark as Submitted */}
            {isSigned && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="font-medium">Mark as Submitted</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Authority submitted to</Label>
                    <Select value={authority} onValueChange={setAuthority}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUTHORITY_OPTIONS.map((a) => (
                          <SelectItem key={a} value={a}>{a}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Submission method</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {METHOD_OPTIONS.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Submission date</Label>
                    <Input value={new Date().toLocaleDateString()} disabled />
                  </div>
                  <div>
                    <Label>Confirmation number (optional)</Label>
                    <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Notes (optional)</Label>
                  <Textarea value={subNotes} onChange={(e) => setSubNotes(e.target.value)} rows={2} />
                </div>
                <Button onClick={markSubmitted} disabled={busy} className="w-full">
                  {busy ? "Saving…" : "Confirm Submission"}
                </Button>
              </div>
            )}

            {/* Submitted info + Mark Resolved */}
            {(isSubmitted || isResolved) && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div>Submitted to: <strong>{detail.submittedTo ?? "—"}</strong> via {detail.submissionMethod ?? "—"}</div>
                {detail.confirmationNumber && <div>Confirmation #: {detail.confirmationNumber}</div>}
                <div>Submitted: {detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : "—"}</div>
              </div>
            )}

            {isSubmitted && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="font-medium">Mark Resolved</div>
                <div>
                  <Label>Resolution reason</Label>
                  <Input
                    value={resReason}
                    onChange={(e) => setResReason(e.target.value)}
                    placeholder="Liability transferred / dismissed / paid to authority"
                  />
                </div>
                <div>
                  <Label>Notes (optional)</Label>
                  <Textarea value={resNotes} onChange={(e) => setResNotes(e.target.value)} rows={2} />
                </div>
                <Button onClick={markResolved} disabled={busy} className="w-full">
                  {busy ? "Saving…" : "Mark Resolved"}
                </Button>
              </div>
            )}

            {isResolved && (
              <div className="rounded-md border bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <div className="font-medium">Resolved</div>
                <div>{detail.resolutionReason}</div>
                {detail.resolutionNotes && <div className="text-muted-foreground">{detail.resolutionNotes}</div>}
                <div>{detail.resolvedAt ? new Date(detail.resolvedAt).toLocaleString() : ""}</div>
              </div>
            )}

            {/* Audit timeline */}
            <div className="rounded-md border p-3">
              <div className="mb-3 font-medium">Audit Trail</div>
              <div className="space-y-3">
                <TimelineRow label="Created" value={violation.created_at} />
                <TimelineRow label="Sent to customer" value={violation.sent_to_customer_at} />
                <TimelineRow label="Signed by customer" value={detail.signedAt} />
                <TimelineRow label="Submitted to authority" value={detail.submittedAt} />
                <TimelineRow label="Resolved" value={detail.resolvedAt} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
