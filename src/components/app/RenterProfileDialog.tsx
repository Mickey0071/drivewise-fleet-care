import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Ban,
  CreditCard,
  DollarSign,
  FileSignature,
  IdCard,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/app/StatusBadge";
import {
  drivers,
  rentals,
  payments,
  violations,
  vehicleById,
  fmtDate,
  fmtMoney,
} from "@/lib/mock/data";
import type { Driver } from "@/lib/mock/data";
import { rentalCanonicalOwed, updateDriver, useStoreVersion } from "@/lib/mock/store";
import { formatAddressBlock } from "@/lib/us-states";
import {
  addRenterIssue,
  addRenterNote,
  useRenterData,
} from "@/lib/renter-notes";
import { useServerFn } from "@tanstack/react-start";
import { uploadDriverLicense } from "@/lib/driver-license.functions";
import {
  listRenterMessages,
  markRenterMessagesRead,
  sendRenterProfileMessage,
  type RenterMessage,
} from "@/lib/renter-messages.functions";
import { toast } from "sonner";

function initialsOf(name?: string) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export function RenterProfileDialog({
  driverId,
  onClose,
}: {
  driverId: string | null;
  onClose: () => void;
}) {
  useStoreVersion();
  const navigate = useNavigate();
  const open = Boolean(driverId);
  const d: Driver | undefined = driverId ? drivers.find((x) => x.id === driverId) : undefined;
  const data = useRenterData(driverId);
  const [noteText, setNoteText] = useState("");
  const [issueText, setIssueText] = useState("");
  const [tab, setTab] = useState<"overview" | "messages">("overview");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadLicense = useServerFn(uploadDriverLicense);
  const loadMessages = useServerFn(listRenterMessages);
  const sendMessage = useServerFn(sendRenterProfileMessage);
  const markRead = useServerFn(markRenterMessagesRead);
  const [messages, setMessages] = useState<RenterMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setTab("overview");
      setMessages([]);
      setDraft("");
    }
  }, [open]);

  const myRentals = useMemo(
    () =>
      d
        ? rentals
            .filter((r) => r.driverId === d.id)
            .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))
        : [],
    [d],
  );
  const myPaid = useMemo(
    () => (d ? payments.filter((p) => p.driverId === d.id && p.status === "paid") : []),
    [d],
  );
  const myViolations = useMemo(
    () => (d ? violations.filter((v) => v.driverId === d.id) : []),
    [d],
  );
  const totalSpent = myPaid.reduce((s, p) => s + p.amount, 0);
  const outstanding = useMemo(
    () =>
      myRentals
        .filter((r) => (r.reservationStatus ?? "active") === "active")
        .reduce((s, r) => s + Math.max(0, rentalCanonicalOwed(r)), 0),
    [myRentals],
  );

  const address =
    d?.address ||
    (d
      ? formatAddressBlock({
          streetAddress: d.streetAddress,
          aptUnit: d.aptUnit,
          city: d.city,
          state: d.state,
          zipCode: d.zipCode,
        })
      : "");

  // License photo: driver record first, then the most recent rental that captured one.
  const licenseUrl =
    d?.licenseImageUrl ||
    myRentals.find((r) => r.licenseImageUrl)?.licenseImageUrl ||
    "";

  const refreshMessages = useCallback(
    async (silent = false) => {
      if (!d) return;
      if (!silent) setMsgLoading(true);
      try {
        const res = await loadMessages({
          data: { driverId: d.id, phone: d.phone ?? null, name: d.fullName },
        });
        setMessages(res.messages);
        if (res.messages.some((m) => m.direction === "received" && !m.read)) {
          await markRead({ data: { driverId: d.id } });
        }
      } catch (e) {
        if (!silent) toast.error(e instanceof Error ? e.message : "Couldn't load messages");
      } finally {
        if (!silent) setMsgLoading(false);
      }
    },
    [d, loadMessages, markRead],
  );

  useEffect(() => {
    if (open && tab === "messages") void refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, driverId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function handleUpload(file: File) {
    if (!d) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      const res = await uploadLicense({ data: { driverId: d.id, dataUrl } });
      updateDriver(d.id, { licenseImageUrl: res.url });
      toast.success("ID uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!d || !text) return;
    if (!d.phone) {
      toast.error("No phone number on file");
      return;
    }
    setSending(true);
    try {
      await sendMessage({ data: { driverId: d.id, phone: d.phone, message: text, name: d.fullName } });
      setDraft("");
      setMessages((m) => [
        ...m,
        { id: `local-${Date.now()}`, message: text, direction: "sent", sentAt: new Date().toISOString(), read: true },
      ]);
      setTimeout(() => void refreshMessages(true), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Message failed");
    } finally {
      setSending(false);
    }
  }

  function printProfile() {
    if (!d) return;
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
    const rows = myRentals
      .map((r) => {
        const v = vehicleById(r.vehicleId);
        return `<tr><td>${esc(r.id)}</td><td>${esc(v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : "—")}</td><td>${esc(fmtDate(r.startDate))} → ${esc(r.endDate ? fmtDate(r.endDate) : "ongoing")}</td><td>${esc(r.reservationStatus ?? "")}</td></tr>`;
      })
      .join("");
    const viols = myViolations
      .map(
        (v) =>
          `<tr><td>${esc(v.type.toUpperCase())}</td><td>${esc(fmtDate(v.dateIssued))}</td><td>${esc(fmtMoney(v.totalAmount ?? v.amount))}</td><td>${esc(v.status)}</td></tr>`,
      )
      .join("");
    const notes = [
      ...data.issues.map((i) => `<li><strong>Issue</strong> · ${new Date(i.at).toLocaleString()}<br/>${esc(i.text)}</li>`),
      ...data.notes.map((n) => `<li><strong>Note</strong> · ${new Date(n.at).toLocaleString()}<br/>${esc(n.text)}</li>`),
    ].join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.fullName)} — Renter Profile</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{margin:0 0 4px;font-size:22px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #eee;padding:6px 4px;text-align:left}
img{max-width:340px;border:1px solid #ddd;border-radius:6px}.meta{font-size:12px;color:#555}ul{font-size:12px;padding-left:18px}li{margin-bottom:6px}</style></head>
<body><h1>${esc(d.fullName)}</h1>
<div class="meta">${esc(d.phone ?? "")} ${d.email ? "· " + esc(d.email) : ""} ${address ? "· " + esc(address) : ""}<br/>${esc(d.id)} · customer since ${esc(fmtDate(d.dateAdded))} · License ${esc(d.licenseNumber || "—")}${d.dlState ? " (" + esc(d.dlState) + ")" : ""}</div>
<h2>ID on file</h2>${licenseUrl ? `<img src="${licenseUrl}" alt="Driver license"/>` : `<p class="meta">No ID photo on file.</p>`}
<h2>Rentals (${myRentals.length}) · Total spent ${esc(fmtMoney(totalSpent))} · Outstanding ${esc(fmtMoney(outstanding))}</h2>
${rows ? `<table><tr><th>ID</th><th>Vehicle</th><th>Period</th><th>Status</th></tr>${rows}</table>` : `<p class="meta">No rentals on record.</p>`}
<h2>Violations (${myViolations.length})</h2>
${viols ? `<table><tr><th>Type</th><th>Date</th><th>Amount</th><th>Status</th></tr>${viols}</table>` : `<p class="meta">None.</p>`}
<h2>Notes &amp; issues</h2>${notes ? `<ul>${notes}</ul>` : `<p class="meta">None.</p>`}
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      toast.error("Allow pop-ups to print this profile");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  }

  function go(to: string, search?: Record<string, unknown>) {
    onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to, search } as any);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {d && (
          <>
            <DialogHeader>
              <DialogTitle className="sr-only">{d.fullName} — Renter profile</DialogTitle>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                  {initialsOf(d.fullName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{d.fullName}</h2>
                    <StatusBadge status={d.status} />
                    {d.blocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        <Ban className="h-3 w-3" /> Do Not Rent
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {d.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {d.phone}
                      </span>
                    )}
                    {d.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {d.email}
                      </span>
                    )}
                    {address && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {address}
                      </span>
                    )}
                    {d.cardLast4 && (
                      <span className="inline-flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {d.cardBrand ?? "Card"} •••• {d.cardLast4}
                      </span>
                    )}
                    <span>· {d.id} · since {fmtDate(d.dateAdded)}</span>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "messages")}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="messages">
                  Messages
                  {messages.some((m) => m.direction === "received" && !m.read) && (
                    <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {messages.filter((m) => m.direction === "received" && !m.read).length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 pt-3">
            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setTab("messages")}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Messages
              </Button>
              <Button size="sm" variant="outline" onClick={printProfile}>
                <Printer className="mr-1.5 h-3.5 w-3.5" /> Print Profile
              </Button>
              <Button size="sm" variant="outline" onClick={() => go("/payments", { driver: d.id })}>
                <DollarSign className="mr-1.5 h-3.5 w-3.5" /> Payment link
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const r = myRentals[0];
                  if (r) go("/rentals", { detail: r.id });
                  else toast.info("No rentals on file yet.");
                }}
              >
                <FileSignature className="mr-1.5 h-3.5 w-3.5" /> Agreements
              </Button>
              <Button size="sm" onClick={() => go("/admin/historic-reservation", { driver: d.id })}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New rental
              </Button>
            </div>

            {/* ID on file */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <IdCard className="h-4 w-4" /> ID on file
              </h3>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleUpload(f);
                }}
              />
              {licenseUrl ? (
                <div className="space-y-2">
                  <a href={licenseUrl} target="_blank" rel="noreferrer">
                    <img
                      src={licenseUrl}
                      alt={`Driver license for ${d.fullName}`}
                      className="max-h-56 rounded-md border border-border object-contain"
                    />
                  </a>
                  <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                    Replace ID
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center">
                  <p className="mb-2 text-xs text-muted-foreground">No ID photo on file for this renter.</p>
                  <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                    Upload ID
                  </Button>
                </div>
              )}
            </section>

            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Total Rentals" value={String(myRentals.length)} />
              <Stat label="Total Spent" value={fmtMoney(totalSpent)} tone="success" />
              <Stat
                label="Violations"
                value={String(myViolations.length)}
                tone={myViolations.length ? "warning" : "default"}
              />
              <Stat
                label="Outstanding"
                value={fmtMoney(outstanding)}
                tone={outstanding > 0 ? "danger" : "default"}
              />
            </div>

            {/* Rental history */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Rental History ({myRentals.length})</h3>
              {myRentals.length === 0 ? (
                <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                  No rentals on record.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {myRentals.map((r) => {
                    const v = vehicleById(r.vehicleId);
                    return (
                      <Link
                        key={r.id}
                        to="/rentals"
                        search={{ detail: r.id }}
                        onClick={() => onClose()}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary hover:bg-accent/40"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {v ? `${v.year} ${v.make} ${v.model}` : "Vehicle removed"}
                            {v?.plate ? ` · ${v.plate}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : "ongoing"} · {r.id}
                          </div>
                        </div>
                        {r.reservationStatus && <StatusBadge status={r.reservationStatus} />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Violations */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Violations ({myViolations.length})</h3>
              {myViolations.length === 0 ? (
                <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                  No violations linked to this renter.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {myViolations.map((v) => {
                    const veh = vehicleById(v.vehicleId);
                    return (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {v.type.toUpperCase()} · {fmtMoney(v.totalAmount ?? v.amount)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDate(v.dateIssued)}
                            {veh ? ` · ${veh.plate}` : ""}
                          </div>
                        </div>
                        <StatusBadge status={v.status} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Issues log */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Issues Log ({data.issues.length})</h3>
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  placeholder="Describe an issue with this renter…"
                  className="min-h-[60px] text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const t = issueText.trim();
                    if (!t) return;
                    addRenterIssue(d.id, t);
                    setIssueText("");
                    toast.success("Issue logged");
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Issue
                </Button>
              </div>
              {data.issues.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {data.issues.map((it) => (
                    <div
                      key={it.id}
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
                    >
                      <div className="whitespace-pre-wrap">{it.text}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(it.at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Admin notes */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Admin Notes ({data.notes.length})</h3>
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Internal note about this renter…"
                  className="min-h-[60px] text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const t = noteText.trim();
                    if (!t) return;
                    addRenterNote(d.id, t);
                    setNoteText("");
                    toast.success("Note added");
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Note
                </Button>
              </div>
              {data.notes.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {data.notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="whitespace-pre-wrap">{n.text}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(n.at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {d.blocked && d.blockReason && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
                <ShieldCheck className="mr-1 inline h-4 w-4" />
                Blocked: {d.blockReason}
              </div>
            )}
            {!d.blocked && d.insuranceOnFile && (
              <p className="text-[11px] text-muted-foreground">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Insurance on file · License {d.licenseNumber ?? "—"}
                {d.dlState ? ` · ${d.dlState}` : ""}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}