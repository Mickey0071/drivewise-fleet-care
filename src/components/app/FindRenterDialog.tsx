import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Search } from "lucide-react";
import type { ViolationRow, RentalOption } from "@/lib/violations.functions";
import {
  matchViolationToRental,
  flagViolationOrphan,
} from "@/lib/violations-workflow.functions";
import { sendViolationRetroLink } from "@/lib/violation-retro.functions";
import { CreateAgreementDialog } from "@/components/app/CreateAgreementDialog";

const normPlate = (s: string | null | undefined) =>
  (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase().replace(/^NJ(?=[A-Z0-9]{4,})/, "");

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function statusLabel(r: RentalOption): { label: string; tone: string } {
  if (r.source === "migrated") return { label: "Migration", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
  const s = (r.reservation_status || "").toLowerCase();
  if (s === "returned") return { label: "Returned", tone: "bg-muted text-muted-foreground" };
  return { label: "Active", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
}

type Relevance = {
  rank: 0 | 1 | 2;
  distance: number;
  label: string;
  icon: string;
  tone: string;
};

function dayDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86400000));
}

function relevanceFor(r: RentalOption, vDate: string): Relevance {
  const start = (r.start_date || "").slice(0, 10);
  const end = (r.end_date || "").slice(0, 10);
  // Within rental period.
  if (vDate && start && start <= vDate && (!end || end >= vDate)) {
    return {
      rank: 0,
      distance: 0,
      label: "Violation date within rental period",
      icon: "✅",
      tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    };
  }
  // Closeness to the period (within 7 days of either boundary).
  const dStart = start ? dayDiff(start, vDate) : Number.POSITIVE_INFINITY;
  const dEnd = end ? dayDiff(end, vDate) : Number.POSITIVE_INFINITY;
  const distance = Math.min(dStart, dEnd);
  if (vDate && distance <= 7) {
    return {
      rank: 1,
      distance,
      label: "Close to rental period",
      icon: "🟡",
      tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    };
  }
  return {
    rank: 2,
    distance,
    label: "Same plate — different period",
    icon: "⚪",
    tone: "bg-muted text-muted-foreground",
  };
}

export function FindRenterDialog({
  violation,
  rentalOptions,
  onClose,
  onDone,
}: {
  violation: ViolationRow | null;
  rentalOptions: RentalOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const matchFn = useServerFn(matchViolationToRental);
  const orphanFn = useServerFn(flagViolationOrphan);
  const sendLinkFn = useServerFn(sendViolationRetroLink);

  const vDate = (violation?.date_issued || "").slice(0, 10);
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [date, setDate] = useState(vDate);
  const [plate, setPlate] = useState(violation?.license_plate || "");
  const [name, setName] = useState("");
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<RentalOption | null>(null);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Reset when a new violation opens.
  const vId = violation?.id ?? null;
  useMemo(() => {
    setStep("search");
    setDate(vDate);
    setPlate(violation?.license_plate || "");
    setName("");
    setSearched(false);
    setSelected(null);
    setLinked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vId]);

  const results = useMemo(() => {
    if (!searched) return [];
    const pk = normPlate(plate);
    const nq = name.trim().toLowerCase();
    // Always show ALL rentals on the matching plate. Name is an optional
    // narrowing filter only when the admin typed one.
    return rentalOptions
      .filter((r) => (pk ? normPlate(r.plate).includes(pk) : true))
      .filter((r) => (nq ? (r.driver_name || "").toLowerCase().includes(nq) : true))
      .map((r) => ({ r, rel: relevanceFor(r, vDate) }))
      .sort((a, b) => {
        if (a.rel.rank !== b.rel.rank) return a.rel.rank - b.rel.rank;
        if (a.rel.distance !== b.rel.distance) return a.rel.distance - b.rel.distance;
        return (b.r.start_date || "").localeCompare(a.r.start_date || "");
      });
  }, [rentalOptions, searched, plate, name, vDate]);

  const covered = useMemo(() => {
    if (!selected) return false;
    const start = selected.start_date || "";
    const end = selected.end_date;
    if (start && start > vDate) return false;
    if (end && end < vDate) return false;
    return Boolean(start);
  }, [selected, vDate]);

  const ensureLinked = async () => {
    if (!violation || !selected) return false;
    if (linked) return true;
    await matchFn({ data: { violationId: violation.id, rentalId: selected.id } });
    setLinked(true);
    return true;
  };

  const confirmLink = async () => {
    if (!violation || !selected) return;
    setBusy("link");
    try {
      await ensureLinked();
      toast.success("Violation linked to renter");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to link");
    } finally {
      setBusy(null);
    }
  };

  const sendSign = async () => {
    if (!violation || !selected) return;
    const phone = selected.driver_phone || "";
    if (!phone) {
      toast.error("No phone on file for this renter — use Create Agreement instead");
      return;
    }
    setBusy("sign");
    try {
      await ensureLinked();
      await sendLinkFn({ data: { violationId: violation.id, phone } });
      toast.success("Sign link sent to customer");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send link");
    } finally {
      setBusy(null);
    }
  };

  const openCreate = async () => {
    setBusy("create");
    try {
      await ensureLinked();
      setCreateOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to link rental");
    } finally {
      setBusy(null);
    }
  };

  const flagOrphan = async () => {
    if (!violation) return;
    setBusy("orphan");
    try {
      await orphanFn({ data: { violationId: violation.id } });
      toast.success("Flagged as orphan dispute (plate not mine)");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to flag");
    } finally {
      setBusy(null);
    }
  };

  if (!violation) return null;

  return (
    <>
      <Dialog open={!!violation} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === "search" ? "Find Renter" : "Confirm Match"}
            </DialogTitle>
          </DialogHeader>

          {/* Violation summary */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Plate</div>
                <div className="font-medium">{violation.license_plate || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Date</div>
                <div className="font-medium">{vDate}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Location</div>
                <div className="font-medium">{violation.location || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Amount</div>
                <div className="font-medium">{fmtMoney(Number(violation.total_amount || violation.amount))}</div>
              </div>
            </div>
          </div>

          {step === "search" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label>Plate</Label>
                  <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Plate / tag" />
                </div>
                <div className="grid gap-1">
                  <Label>Customer name (optional)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Search name" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Can't find by plate? Clear the plate field and search by customer name instead — this finds legacy rentals with no vehicle or plate on file.
              </p>
              <Button onClick={() => setSearched(true)} className="gap-2">
                <Search className="h-4 w-4" /> Search
              </Button>

              {searched && (
                <div className="space-y-2">
                  {searched && results.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Showing all {results.length} rental{results.length === 1 ? "" : "s"} on this plate — pick the correct one.
                    </div>
                  )}
                  {results.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No rentals found on this plate. Use Create New Rental or Plate Not Mine below.
                    </div>
                  ) : (
                    results.map(({ r, rel }) => {
                      const st = statusLabel(r);
                      return (
                        <div
                          key={r.id}
                          className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="text-sm">
                            <div className="font-semibold">{r.driver_name || "Unknown renter"}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.vehicle_label || r.plate || "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.start_date || "?"} → {r.end_date || "ongoing"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className={`rounded px-1.5 py-0.5 text-xs ${st.tone}`}>{st.label}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs ${
                                  r.agreement_on_file
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                }`}
                              >
                                {r.agreement_on_file ? "Has Agreement" : "No Agreement"}
                              </span>
                              <span className={`rounded px-1.5 py-0.5 text-xs ${rel.tone}`}>
                                {rel.icon} {rel.label}
                              </span>
                              {r.plate_inferred && (
                                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-400">
                                  🔎 Plate inferred from vehicle
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelected(r);
                              setLinked(false);
                              setStep("confirm");
                            }}
                          >
                            Select This Rental
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <Button variant="outline" asChild>
                  <Link to="/rentals">Create New Rental</Link>
                </Button>
                <Button variant="ghost" className="text-destructive" onClick={flagOrphan} disabled={busy === "orphan"}>
                  Plate Not Mine
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === "confirm" && selected && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Reservation</div>
                <div className="font-semibold">{selected.driver_name || "Unknown renter"}</div>
                <div className="text-xs text-muted-foreground">
                  {selected.driver_phone || "no phone"} · {selected.driver_email || "no email"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {selected.id.startsWith("LEGACY:") ? "Migrated reservation" : selected.id}
                </div>
                <div className="text-xs text-muted-foreground">{selected.vehicle_label || selected.plate}</div>
                <div className="text-xs text-muted-foreground">
                  {selected.start_date || "?"} → {selected.end_date || "ongoing"}
                </div>
              </div>

              {/* Date validation */}
              <div
                className={`flex items-center gap-2 rounded-md p-2 text-sm ${
                  covered
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {covered ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {covered
                  ? "Violation date falls within rental period"
                  : "Violation date OUTSIDE rental period — verify match"}
              </div>

              {/* Agreement section */}
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Rental Agreement</div>
                {selected.agreement_on_file ? (
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                    <span>🟢</span> Signed agreement on file
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <span>🟡</span> Not signed
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={openCreate} disabled={busy === "create"}>
                        Create Agreement
                      </Button>
                      <Button size="sm" variant="outline" onClick={sendSign} disabled={busy === "sign"}>
                        Send Sign Link
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <Button variant="ghost" onClick={() => setStep("search")}>
                  Cancel
                </Button>
                <Button onClick={confirmLink} disabled={busy === "link"}>
                  Confirm &amp; Link Violation
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CreateAgreementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        violationId={violation.id}
        violationDate={vDate}
        defaults={{ fullName: selected?.driver_name ?? null, phone: selected?.driver_phone ?? null }}
        onDone={() => {
          onDone();
          onClose();
        }}
      />
    </>
  );
}