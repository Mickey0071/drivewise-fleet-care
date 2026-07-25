import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Loader2, FileSignature, FilePlus2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SignaturePad } from "@/components/app/SignaturePad";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  searchRentalsForViolation,
  sendRetroAgreementLink,
  cancelRetroAgreementLink,
  listAwaitingRetroAgreements,
  signRetroAgreementInOffice,
  type ViolationSearchCard,
} from "@/lib/retro-agreement.functions";
import { createViolation } from "@/lib/violations.functions";
import { downloadViolationPacket } from "@/lib/violation-packet.functions";
import { DisputePacketDialog } from "@/components/app/DisputePacketDialog";
import { analyzeViolationPhoto } from "@/lib/violation-photo.functions";
import { DEFAULT_SETTINGS, renderClauseBody } from "@/lib/agreementSettings";

/** Parse a free-form search term into a date (YYYY-MM-DD) and/or plate. */
function parseTerm(raw: string): { date: string | null; plate: string | null } {
  const term = raw.trim();
  if (!term) return { date: null, plate: null };
  // MM/DD/YYYY or M/D/YY
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(term);
  if (slash) {
    let [, mm, dd, yy] = slash;
    if (yy.length === 2) yy = `20${yy}`;
    return { date: `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, plate: null };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(term)) return { date: term, plate: null };
  return { date: null, plate: term.toUpperCase() };
}

function fmt(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US");
}

const AUTHORITIES = [
  { key: "nj_ezpass", label: "NJ E-ZPass" },
  { key: "nj_turnpike", label: "NJ Turnpike" },
  { key: "ny_ezpass", label: "NY E-ZPass" },
  { key: "pa_turnpike", label: "PA Turnpike" },
  { key: "ppa", label: "Philadelphia Parking Authority (PPA)" },
  { key: "nj_mvc", label: "NJ MVC" },
  { key: "other", label: "Other" },
];

export function ViolationSearchSection({
  onCreated,
  hideAwaitingRetro = false,
}: {
  onCreated: () => void;
  /** When true, suppresses the "Awaiting Retroactive Agreements" card so the
   *  parent can render it inside a "More" dialog and keep the main view clean. */
  hideAwaitingRetro?: boolean;
}) {
  const qc = useQueryClient();
  const runSearch = useServerFn(searchRentalsForViolation);
  const cancelLink = useServerFn(cancelRetroAgreementLink);

  const [term, setTerm] = useState("");
  const [searched, setSearched] = useState<{ date: string | null; plate: string | null } | null>(null);
  const [results, setResults] = useState<ViolationSearchCard[] | null>(null);
  const [loading, setLoading] = useState(false);

  const awaiting = useQuery({
    queryKey: ["awaiting-retro"],
    queryFn: () => listAwaitingRetroAgreements(),
  });

  // Create-violation modal state
  const [createFor, setCreateFor] = useState<ViolationSearchCard | null>(null);
  // Send-link modal state
  const [linkFor, setLinkFor] = useState<ViolationSearchCard | null>(null);
  // Create-agreement (in-office) modal state
  const [createAgrFor, setCreateAgrFor] = useState<ViolationSearchCard | null>(null);

  const doSearch = async () => {
    const parsed = parseTerm(term);
    if (!parsed.date && !parsed.plate) {
      toast.error("Enter a date (MM/DD/YYYY) or a license plate");
      return;
    }
    setLoading(true);
    setSearched(parsed);
    try {
      const res = await runSearch({ data: parsed });
      setResults(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6 space-y-4">
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                placeholder="Enter violation date (MM/DD/YYYY) or license plate"
                className="h-12 pl-10 text-base"
              />
            </div>
            <Button onClick={doSearch} disabled={loading} size="lg" className="bg-emerald-600 hover:bg-emerald-700">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search Rentals
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Search by date or plate from your EZPass ticket
          </p>
        </CardContent>
      </Card>

      {results && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {results.length} rental{results.length === 1 ? "" : "s"} found
          </p>
          {results.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No rentals matched. Try the plate only, or a different date.
              </CardContent>
            </Card>
          )}
          {results.map((r) => (
            <Card key={`${r.source}:${r.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-[200px]">
                  <div className="text-lg font-semibold">{r.customerName}</div>
                  <div className="text-sm text-muted-foreground">
                    {r.vehicleLabel}
                    {r.plate ? ` — Plate: ${r.plate}` : ""}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Rental Period: {fmt(r.startDate)} to {fmt(r.endDate)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.isMigration && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                        Fleet Finesse Migration
                      </Badge>
                    )}
                    {r.hasAgreement ? (
                      <Badge className="bg-emerald-600">✓ Rental Agreement Signed</Badge>
                    ) : (
                      <Badge variant="destructive">⚠️ No Agreement on File</Badge>
                    )}
                    {r.isMigration && r.retroSentAt && !r.retroSignedAt && (
                      <Badge variant="outline">Link sent {fmt(r.retroSentAt.slice(0, 10))}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.hasAgreement ? (
                    <Button size="sm" onClick={() => setCreateFor(r)} className="bg-emerald-600 hover:bg-emerald-700">
                      <FilePlus2 className="mr-1 h-4 w-4" /> Create Violation
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={() => setCreateAgrFor(r)}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        <FileSignature className="mr-1 h-4 w-4" /> Create Rental Agreement
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setLinkFor(r)}>
                        <FileSignature className="mr-1 h-4 w-4" /> Send Agreement Link
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!hideAwaitingRetro && (awaiting.data?.length ?? 0) > 0 && (
        <Card className="border-amber-200">
          <CardContent className="p-4">
            <h3 className="mb-2 font-semibold">Awaiting Retroactive Agreements</h3>
            <div className="space-y-2">
              {awaiting.data!.filter((a) => !a.retroSignedAt).map((a) => {
                const days = a.retroSentAt
                  ? Math.floor((Date.now() - new Date(a.retroSentAt).getTime()) / 86400000)
                  : 0;
                return (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                    <div>
                      <div className="font-medium">{a.customerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.vehicleLabel} · {fmt(a.startDate)} · sent {days} day{days === 1 ? "" : "s"} ago
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <ResendButton legacyId={a.id} phone={a.phone} email={a.email} name={a.customerName} onDone={() => qc.invalidateQueries({ queryKey: ["awaiting-retro"] })} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await cancelLink({ data: { legacyId: a.id } });
                            toast.success("Link cancelled");
                            qc.invalidateQueries({ queryKey: ["awaiting-retro"] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed");
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              })}
              {awaiting.data!.filter((a) => a.retroSignedAt).length > 0 && (
                <div className="pt-2 text-xs font-medium text-emerald-700">
                  Ready for violation: {awaiting.data!.filter((a) => a.retroSignedAt).map((a) => a.customerName).join(", ")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send Agreement Link modal */}
      <SendLinkModal
        card={linkFor}
        onClose={() => setLinkFor(null)}
        onSent={() => {
          setLinkFor(null);
          qc.invalidateQueries({ queryKey: ["awaiting-retro"] });
          if (searched) doSearch();
        }}
      />

      {/* Create Violation modal */}
      <CreateViolationModal
        card={createFor}
        defaultDate={searched?.date ?? null}
        onClose={() => setCreateFor(null)}
        onCreated={() => {
          setCreateFor(null);
          onCreated();
        }}
      />

      {/* Create Rental Agreement (in-office) modal */}
      <CreateAgreementModal
        card={createAgrFor}
        onClose={() => setCreateAgrFor(null)}
        onSigned={() => {
          setCreateAgrFor(null);
          qc.invalidateQueries({ queryKey: ["awaiting-retro"] });
          if (searched) doSearch();
        }}
      />
    </div>
  );
}

function ResendButton({
  legacyId,
  phone,
  email,
  name,
  onDone,
}: {
  legacyId: string;
  phone: string | null;
  email: string | null;
  name: string;
  onDone: () => void;
}) {
  const sendLink = useServerFn(sendRetroAgreementLink);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        if (!phone) {
          toast.error("No phone on file — open the rental to add one");
          return;
        }
        setBusy(true);
        try {
          await sendLink({ data: { legacyId, phone, email } });
          toast.success(`Link resent to ${name}`);
          onDone();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend Link"}
    </Button>
  );
}

function SendLinkModal({
  card,
  onClose,
  onSent,
}: {
  card: ViolationSearchCard | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const sendLink = useServerFn(sendRetroAgreementLink);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // reset on open
  const open = Boolean(card);
  if (card && phone === "" && card.phone) {
    // seed once
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Retroactive Agreement Link</DialogTitle>
        </DialogHeader>
        {card && (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Customer</Label>
              <Input value={card.customerName} disabled />
            </div>
            <div className="grid gap-1">
              <Label>Phone (required)</Label>
              <Input
                value={phone || card.phone || ""}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="grid gap-1">
              <Label>Email (optional)</Label>
              <Input value={email || card.email || ""} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Custom message (optional)</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Leave blank to use the default compliance message." />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              if (!card) return;
              const finalPhone = phone || card.phone || "";
              if (!finalPhone.trim()) {
                toast.error("Phone is required");
                return;
              }
              setBusy(true);
              try {
                await sendLink({
                  data: {
                    legacyId: card.id,
                    phone: finalPhone,
                    email: email || card.email || null,
                    message: message || null,
                  },
                });
                toast.success("Agreement link sent");
                setPhone(""); setEmail(""); setMessage("");
                onSent();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to send");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send Agreement Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAgreementModal({
  card,
  onClose,
  onSigned,
}: {
  card: ViolationSearchCard | null;
  onClose: () => void;
  onSigned: () => void;
}) {
  const sign = useServerFn(signRetroAgreementInOffice);
  const open = Boolean(card);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [ack3, setAck3] = useState(false);
  const [ack4, setAck4] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seededId, setSeededId] = useState<string | null>(null);

  // Seed fields from the card once per opened card.
  if (card && seededId !== card.id) {
    setSeededId(card.id);
    setFullName(card.customerName === "Unknown renter" ? "" : card.customerName);
    setAddress("");
    setLicenseNumber("");
    setDlState("");
    setDateOfBirth("");
    setPhone(card.phone ?? "");
    setEmail(card.email ?? "");
    setSig(null);
    setAck1(false); setAck2(false); setAck3(false); setAck4(false);
  }

  const reset = () => {
    setSeededId(null);
  };

  const allAck = ack1 && ack2 && ack3 && ack4;
  const canSubmit = fullName.trim().length > 1 && Boolean(sig) && allAck && !busy;

  const handleSubmit = async () => {
    if (!card) return;
    if (!sig) { toast.error("Please capture a signature"); return; }
    if (!allAck) { toast.error("Please check all acknowledgements"); return; }
    setBusy(true);
    try {
      await sign({
        data: {
          legacyId: card.id,
          fullName: fullName.trim(),
          address,
          licenseNumber,
          dlState,
          dateOfBirth,
          phone,
          email,
          signatureDataUrl: sig,
          ack1: true, ack2: true, ack3: true, ack4: true,
        },
      });
      toast.success("Agreement signed");
      reset();
      onSigned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save agreement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Rental Agreement</DialogTitle>
        </DialogHeader>
        {card && (
          <div className="grid gap-4">
            <Card>
              <CardContent className="grid gap-1 p-4 text-sm">
                <div><span className="text-muted-foreground">Customer: </span>{card.customerName}</div>
                <div>
                  <span className="text-muted-foreground">Vehicle: </span>
                  {card.vehicleLabel}{card.plate ? ` — Plate ${card.plate}` : ""}
                </div>
                <div>
                  <span className="text-muted-foreground">Rental period: </span>
                  {fmt(card.startDate)} to {fmt(card.endDate)}
                </div>
              </CardContent>
            </Card>

            <div>
              <h3 className="mb-2 font-semibold">Rental Agreement Terms</h3>
              <ScrollArea className="h-48 rounded-md border p-3 text-xs leading-relaxed">
                {DEFAULT_SETTINGS.clauses.map((c) => (
                  <div key={c.title} className="mb-3">
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-muted-foreground">{renderClauseBody(c.body, DEFAULT_SETTINGS)}</p>
                  </div>
                ))}
              </ScrollArea>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Full Name</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Date of Birth</Label>
                <Input value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} placeholder="MM/DD/YYYY" />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <Label>Address</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Driver's License #</Label>
                <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>License State</Label>
                <Input value={dlState} onChange={(e) => setDlState(e.target.value.toUpperCase().slice(0, 2))} placeholder="NJ" />
              </div>
              <div className="grid gap-1">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Signature</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>

            <div className="grid gap-2 text-sm">
              {[
                { c: ack1, set: setAck1, label: "Renter confirms they rented this vehicle on the dates shown" },
                { c: ack2, set: setAck2, label: "Renter accepts all terms of this rental agreement" },
                { c: ack3, set: setAck3, label: "Renter authorizes charges for any violations during this rental period" },
                { c: ack4, set: setAck4, label: "Renter understands this electronic signature is legally binding" },
              ].map((row, i) => (
                <label key={i} className="flex items-start gap-2">
                  <Checkbox checked={row.c} onCheckedChange={(v) => row.set(Boolean(v))} className="mt-0.5" />
                  <span>{row.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            disabled={!canSubmit}
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={handleSubmit}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Signed Agreement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateViolationModal({
  card,
  defaultDate,
  onClose,
  onCreated,
}: {
  card: ViolationSearchCard | null;
  defaultDate: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = useServerFn(createViolation);
  const dlPacket = useServerFn(downloadViolationPacket);
  const analyze = useServerFn(analyzeViolationPhoto);
  const [citation, setCitation] = useState("");
  const [date, setDate] = useState(defaultDate ?? "");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [amount, setAmount] = useState("");
  const [authority, setAuthority] = useState("nj_ezpass");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [packetFor, setPacketFor] = useState<string | null>(null);

  const open = Boolean(card);

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

  const downloadPacket = (violationId: string) => {
    // Open the picker dialog instead of silently generating.
    setPacketFor(violationId);
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setCitation(""); setTime(""); setLocation(""); setAmount("");
          setPhotoUrl(null); setCreatedId(null); setAuthority("nj_ezpass");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Violation</DialogTitle>
        </DialogHeader>
        {card && !createdId && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {card.customerName} · {card.vehicleLabel}{card.plate ? ` · ${card.plate}` : ""}
            </p>
            <div className="grid gap-1">
              <Label>Citation / Reference #</Label>
              <Input value={citation} onChange={(e) => setCitation(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Toll Authority</Label>
                <Select value={authority} onValueChange={setAuthority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUTHORITIES.map((a) => (
                      <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Upload notice image (optional)</Label>
              <Input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {photoUrl && <span className="text-xs text-emerald-600">✓ Notice attached</span>}
            </div>
          </div>
        )}
        {createdId && (
          <div className="grid gap-3 py-2">
            <p className="text-sm text-emerald-700">Violation {createdId} created. Generate the dispute packet:</p>
            <div className="flex gap-2">
              <Button onClick={() => downloadPacket(createdId)} className="bg-emerald-600 hover:bg-emerald-700">
                Download Packet
              </Button>
              <Button variant="outline" onClick={() => downloadPacket(createdId)}>
                <ExternalLink className="mr-1 h-4 w-4" /> Print Packet
              </Button>
            </div>
          </div>
        )}
        {!createdId && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={async () => {
                if (!card) return;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("Date required"); return; }
                const amt = Number(amount);
                if (!Number.isFinite(amt) || amt < 0) { toast.error("Amount invalid"); return; }
                setBusy(true);
                try {
                  const res = await create({
                    data: {
                      rentalId: card.source === "live" ? card.id : null,
                      legacyRentalId: card.source === "migrated" ? card.id : null,
                      vehicleId: card.vehicleId,
                      driverId: card.driverId,
                      type: "toll",
                      date,
                      time,
                      location,
                      licensePlate: card.plate,
                      amount: amt,
                      authorityKey: authority,
                      citationNumber: citation || null,
                      photoUrl,
                    },
                  });
                  setCreatedId(res.violation.id);
                  toast.success("Violation created");
                  onCreated();
                  // auto-build packet
                  downloadPacket(res.violation.id);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create Violation & Generate Packet
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    <DisputePacketDialog
      violationId={packetFor}
      onClose={() => setPacketFor(null)}
    />
    </>
  );
}