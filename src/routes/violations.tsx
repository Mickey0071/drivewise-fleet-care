import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, AlertTriangle } from "lucide-react";
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
  listViolations,
  lookupRentalByPlate,
  createViolation,
  chargeViolationRecord,
  markViolationDisputed,
  markViolationPaidManually,
  type ViolationRow,
} from "@/lib/violations.functions";
import { downloadViolationPacket } from "@/lib/violation-packet.functions";

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "Violations — Camauto Rentals" }] }),
  component: ViolationsPage,
});

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

type Filter = "all" | "unpaid" | "paid" | "disputed";

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "unpaid" && !(r.status === "pending" || r.status === "failed")) return false;
      if (filter === "paid" && r.status !== "paid") return false;
      if (filter === "disputed" && r.status !== "disputed") return false;
      if (!q) return true;
      const hay = [
        r.id,
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["violations"] });

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
            <Button onClick={() => setNewOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-1 h-4 w-4" /> New Violation
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unpaid">Unpaid</TabsTrigger>
              <TabsTrigger value="paid">Paid</TabsTrigger>
              <TabsTrigger value="disputed">Disputed</TabsTrigger>
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
                    <th className="p-3">ID</th>
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
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{v.id}</td>
                      <td className="p-3">{fmtDate(v.date_issued)}</td>
                      <td className="p-3 capitalize">{v.type}</td>
                      <td className="p-3">
                        {v.vehicle_label || v.license_plate || "—"}
                      </td>
                      <td className="p-3">
                        {v.driver_name || "—"}
                        {v.rental_id && (
                          <div className="text-xs text-muted-foreground">{v.rental_id}</div>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {fmtMoney(Number(v.total_amount || v.amount))}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="p-3 text-right">
                        {(v.status === "pending" || v.status === "failed") && v.rental_id && (
                          <Button size="sm" variant="outline" onClick={() => setChargeFor(v)}>
                            Charge
                          </Button>
                        )}
                        {v.payment_link_url && v.status === "pending" && (
                          <a
                            href={v.payment_link_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 text-xs text-primary underline"
                          >
                            Link
                          </a>
                        )}
                      </td>
                    </tr>
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
    </div>
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

  const [type, setType] = useState<"toll" | "parking" | "damage" | "traffic" | "other">("toll");
  const [plate, setPlate] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tollAmount, setTollAmount] = useState("");
  const [tollFee, setTollFee] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [lookupResult, setLookupResult] = useState<Awaited<ReturnType<typeof lookup>> | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setType("toll");
    setPlate("");
    setDate(new Date().toISOString().slice(0, 10));
    setTollAmount("");
    setTollFee("");
    setDescription("");
    setPhotoUrl("");
    setLookupResult(null);
  };

  const doLookup = async () => {
    if (!plate.trim() || !date) return;
    setLookingUp(true);
    try {
      const r = await lookup({ data: { plate, date } });
      setLookupResult(r);
      if (!r.found) toast.message(r.reason || "No matching rental");
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
    setSaving(true);
    try {
      const r = await create({
        data: {
          type,
          date,
          licensePlate: plate || null,
          amount: amt,
          fee,
          description: description || `${type} violation${plate ? ` on ${plate.toUpperCase()}` : ""}`,
          photoUrl: photoUrl || null,
          rentalId: lookupResult?.found ? lookupResult.rental.id : null,
          vehicleId: lookupResult?.found ? lookupResult.vehicle.id : null,
          driverId: lookupResult?.found ? lookupResult.rental.driver_id : null,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Violation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
            <Label>Photo URL (optional)</Label>
            <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={doLookup} disabled={!plate || !date || lookingUp}>
                {lookingUp ? "Looking up…" : "Lookup Rental"}
              </Button>
              <span className="text-xs text-muted-foreground">Match plate + date to a rental</span>
            </div>
            {lookupResult && lookupResult.found && (
              <div className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Found <strong>{lookupResult.rental.id}</strong> — {lookupResult.driver?.full_name ?? "Unknown driver"}
                <div className="text-xs text-muted-foreground">
                  {lookupResult.rental.start_date} → {lookupResult.rental.end_date || "ongoing"}
                </div>
              </div>
            )}
            {lookupResult && !lookupResult.found && (
              <div className="mt-2 text-sm text-amber-600">
                {lookupResult.reason || "No rental matched. Violation will be unlinked."}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
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
