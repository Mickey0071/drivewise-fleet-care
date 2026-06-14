import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, AlertTriangle, FileUp, MoreHorizontal, Trash2, Phone, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listViolations,
  lookupRentalByPlate,
  createViolation,
  chargeViolationRecord,
  markViolationDisputed,
  markViolationPaidManually,
  type ViolationRow,
} from "@/lib/violations.functions";
import { listRentalsForViolation } from "@/lib/violations.functions";
import {
  changeViolationStatus,
  listViolationHistory,
  type ViolationHistoryRow,
} from "@/lib/violations.functions";
import { sendViolationToCustomer } from "@/lib/violations.functions";
import { deleteViolation } from "@/lib/violations.functions";
import { updateViolation } from "@/lib/violations.functions";
import {
  generateLiabilityTransfer,
  generateMailPacket,
  markViolationStage,
} from "@/lib/liability-transfer.functions";
import {
  getViolationReadiness,
  sendViolationRetroLink,
  overrideViolationMailReady,
} from "@/lib/violation-retro.functions";
import { analyzeViolationPhoto } from "@/lib/violation-photo.functions";
import { CameraCaptureDialog } from "@/components/app/CameraCaptureDialog";
import { SubmitDisputeDialog } from "@/components/app/SubmitDisputeDialog";
import { CreateAgreementDialog } from "@/components/app/CreateAgreementDialog";
import { ViolationSearchSection } from "@/components/app/ViolationSearchSection";
import { downloadCSV } from "@/lib/exports";

function SendCustomerButton({ violation, onDone }: { violation: ViolationRow; onDone: () => void }) {
  const send = useServerFn(sendViolationToCustomer);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      await send({ data: { id: violation.id } });
      toast.success("Resolution link sent to customer");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  };
  const label = violation.sent_to_customer_at ? "Resend Link" : "Send to Customer";
  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={busy} className="ml-2">
      {busy ? "Sending…" : label}
    </Button>
  );
}

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "Violations — Camauto Rentals" }] }),
  component: ViolationsPage,
});

function LiabilityActions({ v, onDone }: { v: ViolationRow; onDone: () => void }) {
  const genTransfer = useServerFn(generateLiabilityTransfer);
  const genPacket = useServerFn(generateMailPacket);
  const mark = useServerFn(markViolationStage);
  const readiness = useServerFn(getViolationReadiness);
  const sendRetro = useServerFn(sendViolationRetroLink);
  const override = useServerFn(overrideViolationMailReady);
  const [busy, setBusy] = useState<string | null>(null);
  const [retroOpen, setRetroOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [retroPhone, setRetroPhone] = useState("");
  const [retroMsg, setRetroMsg] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState(
    "Customer unreachable - proceeding with available info per N.J.S.A. 39:4-138.1",
  );

  const transferred0 = !!v.liability_transfer_generated_at;
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["violation-readiness", v.id],
    queryFn: () => readiness({ data: { violationId: v.id } }),
    enabled: transferred0,
  });

  const refreshAll = () => {
    refetchStatus();
    onDone();
  };

  const doTransfer = async () => {
    setBusy("transfer");
    try {
      const res = await genTransfer({ data: { violationId: v.id } });
      if (res.pdfUrl) window.open(res.pdfUrl, "_blank");
      toast.success("Liability transfer letter generated");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const doPacket = async () => {
    setBusy("packet");
    try {
      const res = await genPacket({ data: { violationId: v.id } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await mark({ data: { violationId: v.id, stage: "printed" } });
      if (res.missing.length) {
        toast.message(`Mail packet ready — ${res.missing.length} item(s) missing`, {
          description: res.missing.join(", "),
        });
      } else {
        toast.success("Mail packet ready to print");
      }
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const doMark = async (stage: "mailed" | "confirmed") => {
    setBusy(stage);
    try {
      await mark({ data: { violationId: v.id, stage } });
      toast.success(stage === "mailed" ? "Marked mailed" : "Marked disputed successfully");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const doSendRetro = async () => {
    if (!retroPhone.trim()) {
      toast.error("Enter a phone number");
      return;
    }
    setBusy("retro");
    try {
      await sendRetro({
        data: { violationId: v.id, phone: retroPhone.trim(), message: retroMsg.trim() || null },
      });
      toast.success("Retroactive agreement link sent — awaiting signature");
      setRetroOpen(false);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(null);
    }
  };

  const doOverride = async () => {
    if (!overrideNote.trim()) {
      toast.error("A note is required for an override");
      return;
    }
    setBusy("override");
    try {
      await override({ data: { violationId: v.id, note: overrideNote.trim() } });
      toast.success("Override recorded — packet may proceed without signature");
      setOverrideOpen(false);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const transferred = !!v.liability_transfer_generated_at;
  const eligible = !["paid", "affidavit_signed", "resolved"].includes(v.status);

  if (!eligible && !transferred) return null;

  const statusTone =
    status?.state === "ready" ? "🟢" : status?.state === "awaiting_signature" ? "🔴" : "🟡";
  const statusClass =
    status?.state === "ready"
      ? "bg-success/15 text-success border-success/30"
      : status?.state === "awaiting_signature"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-warning/20 text-warning-foreground border-warning/40";
  const canMail = status?.state === "ready";
  const needsLink = status && (status.state === "missing_info" || status.state === "awaiting_signature");

  return (
    <div className="mt-2 flex flex-wrap justify-end gap-1">
      {!transferred && eligible && (
        <Button size="sm" variant="outline" onClick={doTransfer} disabled={busy === "transfer"}>
          {busy === "transfer" ? "…" : "⚖️ Liability Transfer"}
        </Button>
      )}
      {transferred && (
        <>
          {status && (
            <span
              className={`inline-flex items-center gap-1 self-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass}`}
              title={status.missingFields.length ? `Missing: ${status.missingFields.join(", ")}` : undefined}
            >
              {statusTone} {status.label}
            </span>
          )}
          {v.liability_transfer_pdf_url && (
            <a
              href={v.liability_transfer_pdf_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline self-center"
            >
              Letter
            </a>
          )}
          {needsLink && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              ✍️ Create Agreement
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={doPacket} disabled={busy === "packet"}>
            {busy === "packet" ? "Building…" : "🖨️ Mail Packet"}
          </Button>
          {!v.mailed_at && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => doMark("mailed")}
              disabled={busy === "mailed" || !canMail}
              title={canMail ? undefined : "Requires a signed agreement or an admin override"}
            >
              ✉️ Mark Mailed
            </Button>
          )}
          {!v.mailed_at && status && status.state !== "ready" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setOverrideOpen(true)}
            >
              ⚠️ Override
            </Button>
          )}
          {v.mailed_at && !v.transfer_confirmed_at && (
            <Button size="sm" variant="ghost" onClick={() => doMark("confirmed")} disabled={busy === "confirmed"}>
              ✅ Mark Disputed Successfully
            </Button>
          )}
        </>
      )}

      <Dialog open={retroOpen} onOpenChange={setRetroOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send retroactive agreement link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Texts the customer a link to sign their rental agreement. Once signed, the renter's
              address, license # and DOB are filled in, a signed agreement PDF is attached, and the
              packet becomes ready to mail.
            </p>
            <div className="space-y-1">
              <Label>Customer phone</Label>
              <Input
                value={retroPhone}
                onChange={(e) => setRetroPhone(e.target.value)}
                placeholder="(555) 555-5555"
              />
            </div>
            <div className="space-y-1">
              <Label>Custom message (optional)</Label>
              <Textarea
                value={retroMsg}
                onChange={(e) => setRetroMsg(e.target.value)}
                placeholder="Leave blank to use the default compliance message."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetroOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doSendRetro} disabled={busy === "retro"}>
              {busy === "retro" ? "Sending…" : "Send link via SMS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateAgreementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        violationId={v.id}
        violationDate={v.date_issued}
        defaults={{ fullName: status?.customerName ?? v.driver_name ?? null, phone: status?.phone ?? v.driver_phone ?? null }}
        onDone={refreshAll}
      />

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin override — proceed without signature</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this only when the customer is unreachable. This is recorded in the audit trail and
              allows the mail packet to be marked mailed without a signed agreement.
            </p>
            <div className="space-y-1">
              <Label>Override note (required)</Label>
              <Textarea
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doOverride} disabled={busy === "override"}>
              {busy === "override" ? "Saving…" : "Confirm override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function V1Timeline({ v }: { v: ViolationRow }) {
  const f = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const events: { icon: string; label: string; date: string | null }[] = [
    { icon: "📅", label: "Violation received", date: f(v.created_at) },
    { icon: "📨", label: "Sent to customer", date: f(v.sent_to_customer_at) },
    { icon: "👁️", label: "Customer viewed", date: f(v.viewed_at) },
    { icon: "⏰", label: "Reminder sent", date: f(v.reminder_sent_at) },
    { icon: "⚠️", label: "Final warning", date: f(v.final_warning_sent_at) },
    { icon: "💳", label: "Paid directly", date: v.status === "paid" ? f(v.paid_at) : null },
    { icon: "📋", label: "Liability transfer generated", date: f(v.liability_transfer_generated_at) },
    { icon: "🖨️", label: "Mail packet printed", date: f(v.mail_packet_printed_at) },
    { icon: "✉️", label: "Mailed to authority", date: f(v.mailed_at) },
    { icon: "✅", label: "Disputed successfully", date: f(v.transfer_confirmed_at) },
  ].filter((e) => e.date);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <span>{e.icon}</span>
          <span className="font-medium text-foreground">{e.label}</span>
          <span>· {e.date}</span>
        </div>
      ))}
    </div>
  );
}

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

/** Direct phone numbers to violation / toll bureaus for status follow-up calls. */
const BUREAU_CONTACTS: { name: string; phone: string; note: string }[] = [
  { name: "NJ E-ZPass Customer Service", phone: "(888) 288-6865", note: "Toll violations & account status" },
  { name: "NJ Turnpike Authority Violations", phone: "(732) 750-5300", note: "Turnpike / Parkway tolls" },
  { name: "NJ MVC (DMV)", phone: "(609) 292-6500", note: "Title, registration & surcharges" },
  { name: "NY E-ZPass Violations", phone: "(800) 333-8655", note: "NY toll violations" },
  { name: "NY DMV", phone: "(518) 486-9786", note: "Tickets & registration" },
  { name: "PA Turnpike Toll By Plate", phone: "(877) 736-6727", note: "PA toll bills" },
];

function BureauContactsCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-4">
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-emerald-600" />
            Violations Bureau Direct Lines
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BUREAU_CONTACTS.map((b) => (
              <a
                key={b.name}
                href={`tel:${b.phone.replace(/[^\d]/g, "")}`}
                className="rounded-md border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="font-medium">{b.name}</div>
                <div className="text-base font-semibold text-emerald-700">{b.phone}</div>
                <div className="text-xs text-muted-foreground">{b.note}</div>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type TabKey = "uploaded" | "matched" | "disputed" | "completed";

const TAB_ORDER: TabKey[] = ["uploaded", "matched", "disputed", "completed"];
const TAB_LABELS: Record<TabKey, string> = {
  uploaded: "Uploaded",
  matched: "Matched",
  disputed: "Disputed",
  completed: "Completed",
};

const PENDING_RESPONSE = ["pending", "failed", "sent_to_customer", "viewing"];

/** Which of the 4 dashboard tabs a violation belongs to.
 *  Hybrid: an explicit workflow_stage (set by "Move to…" actions) always wins,
 *  otherwise the stage is derived from the violation's data. */
function tabOf(v: ViolationRow): TabKey {
  if (v.workflow_stage && TAB_ORDER.includes(v.workflow_stage as TabKey)) {
    return v.workflow_stage as TabKey;
  }
  if (v.transfer_confirmed_at || v.status === "resolved") return "completed";
  if (
    v.disputed_at ||
    v.mailed_at ||
    v.submitted_to_authority_at ||
    ["submitted_to_authority", "disputed"].includes(v.status)
  )
    return "disputed";
  if (v.rental_id && v.agreement_on_file) return "matched";
  return "uploaded";
}

/** A violation is ready for liability transfer when the customer has had >7 days
 * with no payment/signature and no transfer has been generated yet. */
function transferReady(v: ViolationRow): boolean {
  if (v.liability_transfer_generated_at) return false;
  if (["paid", "affidavit_signed", "resolved", "submitted_to_authority"].includes(v.status))
    return false;
  if (!v.sent_to_customer_at) return false;
  const days = (Date.now() - new Date(v.sent_to_customer_at).getTime()) / 86400000;
  return days >= 7;
}

function ViolationsPage() {
  const list = useServerFn(listViolations);
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["violations"],
    queryFn: () => list(),
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [chargeFor, setChargeFor] = useState<ViolationRow | null>(null);
  const [statusFor, setStatusFor] = useState<ViolationRow | null>(null);
  const [submitFor, setSubmitFor] = useState<ViolationRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<ViolationRow | null>(null);
  const [editFor, setEditFor] = useState<ViolationRow | null>(null);

  const delFn = useServerFn(deleteViolation);
  const delMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Violation deleted");
      setDeleteFor(null);
      qc.invalidateQueries({ queryKey: ["violations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && stageOf(r) !== filter) return false;
      if (!q) return true;
      const hay = [
        r.id,
        r.reference_number,
        r.license_plate,
        r.rental_id,
        r.driver_name,
        r.vehicle_label,
        r.date_issued,
        r.type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter, search]);

  const unpaidCount = rows.filter((r) => r.status === "pending" || r.status === "failed").length;
  const unpaidTotal = rows
    .filter((r) => r.status === "pending" || r.status === "failed")
    .reduce((s, r) => s + Number(r.total_amount || r.amount || 0), 0);

  const readyForTransfer = rows.filter(transferReady);

  const refresh = () => qc.invalidateQueries({ queryKey: ["violations"] });

  const exportCsv = () => {
    const headers = [
      "ID", "Date Issued", "Type", "Plate", "Vehicle", "Customer", "Rental",
      "Amount", "Fee", "Total", "Status", "Stage", "Sent", "Mailed", "Confirmed",
    ];
    const data = filtered.map((v) => [
      v.id,
      v.date_issued,
      v.type,
      v.license_plate ?? "",
      v.vehicle_label ?? "",
      v.driver_name ?? "",
      v.rental_id ?? "",
      v.amount,
      v.fee,
      v.total_amount,
      v.status,
      stageOf(v),
      v.sent_to_customer_at ?? "",
      v.mailed_at ?? "",
      v.transfer_confirmed_at ?? "",
    ]);
    downloadCSV(`violations-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
  };

  return (
    <div>
      <PageHeader
        title="Violations"
        subtitle={`${rows.length} on record`}
        action={
          <div className="flex items-center gap-2">
            {unpaidCount > 0 && (
              <Badge variant="destructive" className="h-7 px-2 text-xs">
                {unpaidCount} unpaid · {fmtMoney(unpaidTotal)}
              </Badge>
            )}
            <Button variant="outline" asChild>
              <Link to="/violations/bulk-upload">
                <FileUp className="mr-1 h-4 w-4" /> Bulk Upload EZPass
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  More <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/violations/disputes">Disputes</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/violations/authorities">Authorities</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/violations/import">Import CSV</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/violations/imports">Import History</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/violations/exports">Export Data</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}>Export CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setNewOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-1 h-4 w-4" /> New Violation
            </Button>
          </div>
        }
      />

      <ViolationSearchSection onCreated={refresh} />

      <BureauContactsCard />

      {readyForTransfer.length > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              <span>
                <strong>{readyForTransfer.length}</strong> violation
                {readyForTransfer.length === 1 ? "" : "s"} past 7 days with no customer response —
                ready for liability transfer.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilter("awaiting_response")}
              className="border-amber-400"
            >
              Review
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="awaiting_response">Awaiting Response</TabsTrigger>
              <TabsTrigger value="paid_direct">Paid Directly</TabsTrigger>
              <TabsTrigger value="transfer_generated">Auto-Transfer</TabsTrigger>
              <TabsTrigger value="packet_printed">Packet Printed</TabsTrigger>
              <TabsTrigger value="mailed">Mailed</TabsTrigger>
              <TabsTrigger value="confirmed">Disputed Successfully</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by plate, rental, customer, date…"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No violations match.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Violation #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Vehicle</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <Fragment key={v.id}>
                    <tr className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{v.reference_number || v.id}</td>
                      <td className="p-3">{fmtDate(v.date_issued)}</td>
                      <td className="p-3 capitalize">{v.type}</td>
                      <td className="p-3">
                        {v.vehicle_label || v.license_plate || "—"}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{v.driver_name || "Unknown renter"}</div>
                        {v.driver_phone && (
                          <a
                            href={`tel:${v.driver_phone.replace(/[^\d]/g, "")}`}
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Phone className="h-3 w-3" /> {v.driver_phone}
                          </a>
                        )}
                        {v.rental_id && (
                          <div className="text-xs text-muted-foreground">{v.rental_id}</div>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {fmtMoney(Number(v.total_amount || v.amount))}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={v.status} />
                        {v.status === "paid" && v.paid_at && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            ✓ {new Date(v.paid_at).toLocaleString()}
                          </div>
                        )}
                        {v.resolution_choice && v.status !== "paid" && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Choice: {v.resolution_choice === "pay" ? "Paid" : v.resolution_choice}
                          </div>
                        )}
                        {PENDING_RESPONSE.includes(v.status) && v.sent_to_customer_at && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Sent {new Date(v.sent_to_customer_at).toLocaleDateString()}
                            {v.viewed_at ? " · viewed" : ""}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(v.status === "pending" || v.status === "failed") && v.rental_id && (
                            <Button size="sm" variant="outline" onClick={() => setChargeFor(v)}>
                              Charge
                            </Button>
                          )}
                          {!["paid", "resolved", "submitted_to_authority"].includes(v.status) && (
                            <SendCustomerButton violation={v} onDone={refresh} />
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title="Delete violation"
                            onClick={() => setDeleteFor(v)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => setEditFor(v)}>
                                Edit / fill missing info
                              </DropdownMenuItem>
                              {v.payment_link_url && v.status === "pending" && (
                                <DropdownMenuItem asChild>
                                  <a href={v.payment_link_url} target="_blank" rel="noreferrer">
                                    Open payment link
                                  </a>
                                </DropdownMenuItem>
                              )}
                              {["submitted_to_authority", "resolved"].includes(v.status) && (
                                <DropdownMenuItem onClick={() => setSubmitFor(v)}>
                                  View dispute
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setStatusFor(v)}>
                                Change status
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                              >
                                {expanded === v.id ? "Hide timeline" : "View timeline"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteFor(v)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete violation
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <LiabilityActions v={v} onDone={refresh} />
                      </td>
                    </tr>
                    {expanded === v.id && (
                      <tr key={`${v.id}-tl`} className="border-b bg-muted/20 last:border-0">
                        <td colSpan={8} className="p-4">
                          <V1Timeline v={v} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewViolationDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(created) => {
        refresh();
        setNewOpen(false);
        setChargeFor(created);
      }} />

      <ChargeDialog
        violation={chargeFor}
        onClose={() => setChargeFor(null)}
        onDone={() => {
          refresh();
          setChargeFor(null);
        }}
      />

      <ChangeStatusDialog
        violation={statusFor}
        onClose={() => setStatusFor(null)}
        onDone={() => {
          refresh();
        }}
      />
      <SubmitDisputeDialog
        violation={submitFor}
        onClose={() => setSubmitFor(null)}
        onDone={refresh}
      />

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this violation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFor && (
                <>
                  This permanently removes the violation for{" "}
                  <strong>{deleteFor.driver_name || "this renter"}</strong>
                  {deleteFor.license_plate ? ` (${deleteFor.license_plate})` : ""} and its history.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={delMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteFor) delMutation.mutate(deleteFor.id);
              }}
            >
              {delMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditViolationDialog
        violation={editFor}
        onClose={() => setEditFor(null)}
        onDone={() => {
          refresh();
          setEditFor(null);
        }}
      />
    </div>
  );
}

function EditViolationDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const update = useServerFn(updateViolation);
  const analyze = useServerFn(analyzeViolationPhoto);
  const [violationNumber, setViolationNumber] = useState("");
  const [plate, setPlate] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [location, setLocation] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!violation) return;
    setViolationNumber(violation.reference_number || violation.id || "");
    setPlate(violation.license_plate || "");
    setDate((violation.date_issued || "").slice(0, 10));
    setAmount(violation.amount != null ? String(violation.amount) : "");
    setFee(violation.fee != null ? String(violation.fee) : "");
    setLocation(violation.location || "");
    setTime(violation.violation_time || "");
    setDescription(violation.description || "");
    setPhotoUrl(violation.photo_url || "");
  }, [violation]);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await analyze({ data: { dataUrl } });
      setPhotoUrl(res.photoUrl);
      toast.success("Notice uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!violation) return;
    setSaving(true);
    try {
      await update({
        data: {
          id: violation.id,
          violationNumber: violationNumber || null,
          licensePlate: plate || null,
          date: date || null,
          amount: amount === "" ? null : Number(amount),
          fee: fee === "" ? null : Number(fee),
          location: location || null,
          time: time || null,
          description: description || null,
          photoUrl: photoUrl || null,
        },
      });
      toast.success("Violation updated");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!violation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Violation — fill in missing info</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Violation / Ticket #</Label>
            <Input value={violationNumber} onChange={(e) => setViolationNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>License Plate</Label>
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Amount ($)</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Fee ($)</Label>
              <Input type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Time</Label>
              <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 14:32" />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Notes / Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid gap-1">
            <Label>Violation notice image</Label>
            <Input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
            {photoUrl && !uploading && <span className="text-xs text-emerald-600">✓ Notice on file</span>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewViolationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onCreated: (v: ViolationRow) => void;
}) {
  const lookup = useServerFn(lookupRentalByPlate);
  const create = useServerFn(createViolation);
  const analyze = useServerFn(analyzeViolationPhoto);
  const listRentals = useServerFn(listRentalsForViolation);

  const { data: rentalOptions = [] } = useQuery({
    queryKey: ["rentals-for-violation"],
    queryFn: () => listRentals(),
    enabled: open,
  });
  const [selectedRentalId, setSelectedRentalId] = useState<string>("");
  const [manualOverride, setManualOverride] = useState(false);
  const [manualQuery, setManualQuery] = useState("");

  const [type, setType] = useState<"toll" | "parking" | "damage" | "traffic" | "other">("toll");
  const [plate, setPlate] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tollAmount, setTollAmount] = useState("");
  const [tollFee, setTollFee] = useState("");
  const [description, setDescription] = useState("");
  const [citationNumber, setCitationNumber] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [location, setLocation] = useState("");
  const [lookupResult, setLookupResult] = useState<Awaited<ReturnType<typeof lookup>> | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thumbnail, setThumbnail] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pdfPages, setPdfPages] = useState<{
    renderPage: (n: number) => Promise<string>;
    pageCount: number;
  } | null>(null);

  const reset = () => {
    setType("toll");
    setPlate("");
    setDate(new Date().toISOString().slice(0, 10));
    setTollAmount("");
    setTollFee("");
    setDescription("");
    setCitationNumber("");
    setPhotoUrl("");
    setLocation("");
    setLookupResult(null);
    setThumbnail("");
    setConfidence(null);
    setPdfPages(null);
    setSelectedRentalId("");
    setManualOverride(false);
    setManualQuery("");
  };
  const analyzeDataUrl = async (dataUrl: string) => {
    setThumbnail(dataUrl);
    setAnalyzing(true);
    setConfidence(null);
    try {
      const res = await analyze({ data: { dataUrl } });
      setPhotoUrl(res.photoUrl);
      const ex = res.extraction;
      setConfidence(ex.confidence);
      let plateForLookup = "";
      let dateForLookup = "";
      if (ex.confidence >= 70) {
        if (ex.license_plate) {
          // strip leading state abbrev like "NJ "
          const cleaned = ex.license_plate.replace(/^[A-Z]{2}\s+/, "").toUpperCase();
          setPlate(cleaned);
          plateForLookup = cleaned;
        }
        if (ex.violation_date) {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ex.violation_date);
          if (m) {
            const [, mo, d, y] = m;
            dateForLookup = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
            setDate(dateForLookup);
          }
        }
        if (ex.location) setLocation(ex.location);
        if (ex.citation_number) setCitationNumber(ex.citation_number.toUpperCase());
        if (ex.toll_amount != null) setTollAmount(String(ex.toll_amount));
        if (ex.fee_amount != null) setTollFee(String(ex.fee_amount));
        if (ex.violation_type) setType(ex.violation_type);
        toast.success(`Extracted with ${ex.confidence}% confidence`);
        // Auto-match renter by plate + date as soon as we have both
        if (plateForLookup) {
          await doLookup(plateForLookup, dateForLookup || date);
        }
      } else {
        toast.message("Couldn't read clearly — please enter manually", {
          description: `Confidence ${ex.confidence}%`,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const usePdfPage = async (pageNumber: number) => {
    if (!pdfPages) return;
    setAnalyzing(true);
    try {
      const dataUrl = await pdfPages.renderPage(pageNumber);
      setPdfPages(null);
      await analyzeDataUrl(dataUrl);
    } catch (e) {
      setAnalyzing(false);
      toast.error(e instanceof Error ? e.message : "Could not read PDF page");
    }
  };

  const handlePhoto = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isImage && !isPdf) {
      toast.error("Please upload a JPG, PNG, or PDF file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    setPdfPages(null);
    if (isPdf) {
      try {
        const { loadPdf } = await import("@/lib/pdf-to-image");
        const pdf = await loadPdf(file);
        if (pdf.pageCount > 1) {
          setPdfPages(pdf);
          toast.message("Multi-page document", {
            description: `${pdf.pageCount} pages found. Using the first page unless you choose another.`,
          });
          return;
        }
        const dataUrl = await pdf.renderPage(1);
        await analyzeDataUrl(dataUrl);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not read PDF");
      }
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Read failed"));
      r.readAsDataURL(file);
    });
    await analyzeDataUrl(dataUrl);
  };

  const doLookup = async (plateArg?: string, dateArg?: string) => {
    const p = (plateArg ?? plate).trim();
    const d = dateArg ?? date;
    if (!p || !d) return;
    setLookingUp(true);
    try {
      const r = await lookup({ data: { plate: p, date: d } });
      setLookupResult(r);
      // Combined pool of overlapping candidates (live + migrated/legacy).
      const liveIds = r.matches.map((m) => m.rental.id);
      const legacyIds = (r.legacyMatches ?? []).map((m) => `LEGACY:${m.id}`);
      const allIds = [...liveIds, ...legacyIds];
      if (allIds.length === 1) {
        // Exactly one rental/reservation covers this plate + date → auto-select.
        setSelectedRentalId(allIds[0]);
      } else {
        setSelectedRentalId("");
      }
      if (!r.vehicleFound) toast.message("Vehicle not in fleet or OCR failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async () => {
    const amt = parseFloat(tollAmount || "0");
    const fee = parseFloat(tollFee || "0");
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const picked = selectedRentalId
      ? rentalOptions.find((r) => r.id === selectedRentalId) ?? null
      : null;
    const isLegacyPick = !!picked && picked.source === "migrated";
    const fallbackVehicleId = lookupResult?.vehicle?.id ?? null;
    setSaving(true);
    try {
      const baseDesc =
        description ||
        `${type} violation${plate ? ` on ${plate.toUpperCase()}` : ""}${location ? ` at ${location}` : ""}`;
      const finalDesc = isLegacyPick
        ? `${baseDesc} — Renter (migrated): ${picked!.driver_name ?? "Unknown"}`
        : baseDesc;
      const r = await create({
        data: {
          type,
          date,
          licensePlate: plate || null,
          amount: amt,
          fee,
          description: finalDesc,
          photoUrl: photoUrl || null,
          rentalId: picked && !isLegacyPick ? picked.id : null,
          vehicleId: picked && !isLegacyPick ? picked.vehicle_id : fallbackVehicleId,
          driverId: picked && !isLegacyPick ? picked.driver_id : null,
          legacyRentalId: isLegacyPick ? picked!.id.replace(/^LEGACY:/, "") : null,
          extractedConfidence: confidence,
          citationNumber: citationNumber || null,
        },
      });
      toast.success(`Created ${r.violation.id}`);
      reset();
      onCreated(r.violation);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(b) => { if (!b) reset(); onOpenChange(b); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>New Violation</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Photo, scan, or PDF of a toll bill, parking ticket, or violation notice
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    size="lg"
                    className="flex-1"
                    onClick={() => setCameraOpen(true)}
                  >
                    📱 Take Photo with Camera
                  </Button>
                  <label className="flex-1">
                    <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
                      📤 Upload from Files
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePhoto(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <CameraCaptureDialog
                  open={cameraOpen}
                  onOpenChange={setCameraOpen}
                  onCapture={(f) => void handlePhoto(f)}
                />
                {pdfPages && (
                  <div className="mt-3 rounded-md border bg-background p-3 text-xs">
                    <div className="mb-2 font-medium">
                      This is a multi-page document ({pdfPages.pageCount} pages). Use the first page?
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" disabled={analyzing} onClick={() => void usePdfPage(1)}>
                        Use First Page
                      </Button>
                      <span className="text-muted-foreground">or choose a page:</span>
                      <Select onValueChange={(v) => void usePdfPage(Number(v))}>
                        <SelectTrigger className="h-8 w-28"><SelectValue placeholder="Page…" /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: pdfPages.pageCount }, (_, i) => i + 1).map((n) => (
                            <SelectItem key={n} value={String(n)}>Page {n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                {thumbnail && (
                  <div className="mt-3 flex items-start gap-3">
                    <img src={thumbnail} alt="Violation" className="h-20 w-20 rounded border object-cover" />
                    <div className="flex-1 text-xs">
                      {analyzing && <div className="text-muted-foreground">Analyzing photo…</div>}
                      {!analyzing && confidence !== null && confidence >= 70 && (
                        <div className="text-emerald-700 dark:text-emerald-400">
                          ✓ Extracted with {confidence}% confidence
                        </div>
                      )}
                      {!analyzing && confidence !== null && confidence < 70 && (
                        <div className="text-amber-600">
                          ⚠️ Could not read clearly ({confidence}%). Please enter manually or try a different photo.
                        </div>
                      )}
                      {!analyzing && confidence === null && (
                        <div className="text-emerald-700 dark:text-emerald-400">✓ File ready.</div>
                      )}
                      <label className="mt-1 inline-block">
                        <span className="cursor-pointer text-primary underline-offset-2 hover:underline">Change file</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handlePhoto(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="toll">Toll Plate</SelectItem>
                    <SelectItem value="parking">Parking</SelectItem>
                    <SelectItem value="damage">Damage</SelectItem>
                    <SelectItem value="traffic">Traffic</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Violation / Citation #</Label>
                <Input
                  value={citationNumber}
                  onChange={(e) => setCitationNumber(e.target.value.toUpperCase())}
                  placeholder="As printed on the notice (used as the record ID)"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to auto-generate. When entered, this becomes the violation's ID so it matches the uploaded notice.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>License Plate</Label>
                  <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="ABC1234" />
                </div>
                <div>
                  <Label>Violation Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{type === "toll" ? "Toll Amount" : "Amount"} ($)</Label>
                  <Input type="number" step="0.01" value={tollAmount} onChange={(e) => setTollAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Fee ($)</Label>
                  <Input type="number" step="0.01" value={tollFee} onChange={(e) => setTollFee(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Description / Notes</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>

              <div>
                <Label>Location</Label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Toll plaza, street, or place of violation"
                />
              </div>

              <div>
                <Label>Photo URL (optional)</Label>
                <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label>Renter Match</Label>
                  {lookupResult && (
                    <Badge
                      variant={lookupResult.matchConfidence >= 90 ? "default" : "secondary"}
                      className="text-xs"
                    >
                      Match confidence: {lookupResult.matchConfidence}%
                    </Badge>
                  )}
                </div>
                {lookupResult && (
                  <div
                    className={`mb-3 rounded-md p-2 text-xs ${
                      !lookupResult.vehicleFound
                        ? "bg-destructive/10 text-destructive"
                        : lookupResult.matchConfidence >= 90
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-500"
                    }`}
                  >
                    {!lookupResult.vehicleFound
                      ? "Vehicle not in fleet or OCR failed — enter plate / select renter manually."
                      : lookupResult.matchConfidence >= 90
                        ? `${lookupResult.confidenceLabel} — renter auto-selected.`
                        : `Low confidence — ${lookupResult.confidenceLabel}. Verify renter.`}
                  </div>
                )}
                {(() => {
                  // Candidates that actually overlap the plate + violation date.
                  const liveIds = lookupResult?.matches?.map((m) => m.rental.id) ?? [];
                  const legacyIds = lookupResult?.legacyMatches?.map((m) => `LEGACY:${m.id}`) ?? [];
                  const matchIds = [...liveIds, ...legacyIds];
                  const candidates = rentalOptions.filter((r) => matchIds.includes(r.id));
                  const picked = selectedRentalId
                    ? rentalOptions.find((r) => r.id === selectedRentalId) ?? null
                    : null;

                  return (
                    <>
                      {/* Auto-matched renter — shown front and center, no big list */}
                      {picked && !manualOverride && (
                        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
                          <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                            {picked.source === "migrated" ? "📋 " : ""}
                            {picked.driver_name ?? "Unknown renter"}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {picked.id.startsWith("LEGACY:") ? "Migrated reservation" : picked.id}
                            {picked.plate ? ` · ${picked.plate}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {picked.vehicle_label ?? ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {picked.start_date} → {picked.end_date || "ongoing"}
                          </div>
                        </div>
                      )}

                      {/* Ambiguous: a few candidates overlap — let admin pick the right one */}
                      {!manualOverride && candidates.length > 1 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">
                            {candidates.length} renters overlap this date — pick the right one:
                          </div>
                          {candidates.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setSelectedRentalId(r.id)}
                              className={`flex w-full flex-col items-start rounded border p-2 text-left text-xs hover:bg-accent ${
                                selectedRentalId === r.id ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : ""
                              }`}
                            >
                              <span className="font-medium">
                                {r.source === "migrated" ? "📋 " : ""}
                                {r.driver_name ?? "Unknown"}
                              </span>
                              <span className="text-muted-foreground">
                                {r.plate ?? ""} · {r.start_date} → {r.end_date || "ongoing"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Exactly one overlapping reservation that wasn't auto-selected
                          (e.g. a migrated reservation with no live rental) */}
                      {!manualOverride && candidates.length === 1 && !picked && (
                        <button
                          type="button"
                          onClick={() => setSelectedRentalId(candidates[0].id)}
                          className="flex w-full flex-col items-start rounded-md border border-emerald-300 bg-emerald-50 p-3 text-left text-sm hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30"
                        >
                          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                            {candidates[0].source === "migrated" ? "📋 " : ""}
                            {candidates[0].driver_name ?? "Unknown renter"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {candidates[0].plate ?? ""}
                            {candidates[0].start_date
                              ? ` · ${candidates[0].start_date} → ${candidates[0].end_date || "ongoing"}`
                              : ""}
                          </span>
                          <span className="text-xs text-emerald-700 dark:text-emerald-400">
                            Tap to use this renter
                          </span>
                        </button>
                      )}

                      {/* No automatic match found */}
                      {!manualOverride &&
                        lookupResult &&
                        candidates.length === 0 && (
                          <div className="rounded-md p-2 text-sm text-amber-600">
                            {lookupResult.reason ||
                              "No renter matched this plate + date. Choose manually below."}
                          </div>
                        )}

                      {/* Manual override: full searchable list of every renter/reservation */}
                      {manualOverride && (() => {
                        const norm = (s: unknown) =>
                          String(s ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
                        const qRaw = manualQuery.trim().toLowerCase();
                        const qPlate = norm(manualQuery);
                        const filtered = qRaw
                          ? rentalOptions.filter((r) => {
                              const text = [r.driver_name, r.vehicle_label, r.id]
                                .filter(Boolean)
                                .some((field) => String(field).toLowerCase().includes(qRaw));
                              const plate =
                                !!qPlate &&
                                (norm(r.plate).includes(qPlate) ||
                                  norm(r.vehicle_label).includes(qPlate));
                              return text || plate;
                            })
                          : rentalOptions;
                        return (
                          <div className="space-y-2">
                            <Input
                              autoFocus
                              value={manualQuery}
                              onChange={(e) => setManualQuery(e.target.value)}
                              placeholder="Search by name, plate/tag, or vehicle…"
                            />
                            <div className="max-h-60 space-y-1 overflow-auto rounded-md border p-1">
                              {filtered.length === 0 ? (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                  No renters match “{manualQuery}”
                                </div>
                              ) : (
                                filtered.slice(0, 100).map((r) => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => setSelectedRentalId(r.id)}
                                    className={`flex w-full flex-col items-start rounded p-2 text-left text-xs hover:bg-accent ${
                                      selectedRentalId === r.id
                                        ? "border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                                        : ""
                                    }`}
                                  >
                                    <span className="font-medium">
                                      {r.source === "migrated" ? "📋 " : ""}
                                      {r.driver_name ?? "Unknown"}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {r.id.startsWith("LEGACY:") ? "Migrated" : r.id}
                                      {r.plate ? ` · ${r.plate}` : ""}
                                      {r.start_date ? ` · ${r.start_date} → ${r.end_date || "ongoing"}` : ""}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                            {filtered.length > 100 && (
                              <p className="text-xs text-muted-foreground">
                                Showing first 100 — refine your search to narrow results.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      <div className="my-3 border-t" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void doLookup()}
                          disabled={!plate || !date || lookingUp}
                        >
                          {lookingUp ? "Looking up…" : "Re-match plate + date"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setManualOverride((m) => !m);
                            if (!manualOverride) setSelectedRentalId("");
                            setManualQuery("");
                          }}
                        >
                          {manualOverride ? "Use auto match" : "Choose manually"}
                        </Button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 bg-muted/30 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add Violation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const charge = useServerFn(chargeViolationRecord);
  const dispute = useServerFn(markViolationDisputed);
  const markPaid = useServerFn(markViolationPaidManually);
  const m = useMutation({
    mutationFn: async (mode: "auto" | "link") =>
      charge({ data: { id: violation!.id, mode } }),
    onSuccess: (res) => {
      if (res.mode === "link") {
        toast.success("Payment link sent to renter");
      } else {
        toast.success("Card charged successfully");
      }
      onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Charge failed"),
  });

  if (!violation) return null;
  const amt = Number(violation.total_amount || violation.amount);

  return (
    <Dialog open={!!violation} onOpenChange={(b) => { if (!b) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Charge Violation — {fmtMoney(amt)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div><strong>{violation.id}</strong> · {violation.type}</div>
            <div className="text-xs text-muted-foreground">
              {violation.driver_name || "—"} · {violation.vehicle_label || violation.license_plate || "—"}
            </div>
            {violation.description && (
              <div className="mt-1 text-xs">{violation.description}</div>
            )}
          </div>
          <p className="text-sm">How do you want to charge?</p>
          <div className="grid gap-2">
            <Button
              onClick={() => m.mutate("auto")}
              disabled={m.isPending}
            >
              Auto-Charge Card on File
            </Button>
            <Button
              variant="outline"
              onClick={() => m.mutate("link")}
              disabled={m.isPending}
            >
              Send Payment Link (SMS + Email)
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await markPaid({ data: { id: violation.id, method: "manual" } });
                  toast.success("Marked paid");
                  onDone();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={m.isPending}
            >
              Mark Paid (manual)
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await dispute({ data: { id: violation.id } });
                  toast.success("Marked disputed");
                  onDone();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={m.isPending}
            >
              Mark Disputed
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Unpaid (Pending)" },
  { value: "paid", label: "Paid" },
  { value: "disputed", label: "Disputed" },
  { value: "failed", label: "Failed" },
  { value: "mailed_pending_review", label: "Mailed (Pending Review)" },
];

const statusLabel = (s: string | null) =>
  STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s ?? "—";

function ChangeStatusDialog({
  violation,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const change = useServerFn(changeViolationStatus);
  const history = useServerFn(listViolationHistory);
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ["violation-history", violation?.id],
    queryFn: () => history({ data: { id: violation!.id } }),
    enabled: !!violation,
  });

  if (!violation) return null;

  const submit = async () => {
    if (!status) {
      toast.error("Pick a new status");
      return;
    }
    setSaving(true);
    try {
      await change({ data: { id: violation.id, status, reason } });
      toast.success(`Status changed to ${statusLabel(status)}`);
      setReason("");
      setStatus("");
      qc.invalidateQueries({ queryKey: ["violation-history", violation.id] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!violation} onOpenChange={(b) => { if (!b) { setReason(""); setStatus(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Status — {violation.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Current:</span>
            <StatusBadge status={violation.status} />
          </div>

          <div>
            <Label>New status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status…" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.filter((o) => o.value !== violation.status).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is the status changing?"
            />
          </div>

          <div>
            <Label className="mb-2 block">Timeline</Label>
            {loadingTimeline ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : timeline.length === 0 ? (
              <div className="text-xs text-muted-foreground">No status changes yet.</div>
            ) : (
              <ol className="space-y-2 border-l pl-4">
                {timeline.map((h: ViolationHistoryRow) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{statusLabel(h.from_status)}</span>
                      <span>→</span>
                      <StatusBadge status={h.to_status} />
                    </div>
                    {h.reason && <div className="mt-0.5 text-xs">{h.reason}</div>}
                    <div className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                      {h.changed_by_name ? ` · ${h.changed_by_name}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setReason(""); setStatus(""); onClose(); }}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !status}>
            {saving ? "Saving…" : "Save Change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
