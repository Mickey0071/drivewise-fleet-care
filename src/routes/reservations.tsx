import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rentals, payments, vehicleById, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, pendingExpiresAt, currentPeriodPaid } from "@/lib/mock/store";
import { ExternalLink, Search } from "lucide-react";
import type { Rental } from "@/lib/mock/data";

export const Route = createFileRoute("/reservations")({
  head: () => ({ meta: [{ title: "All Reservations — Camauto Rentals" }] }),
  component: AllReservationsPage,
});

type StatusKey = "all" | "pending" | "active" | "completed";

function reservationLabel(r: Rental): { label: string; tone: "default" | "secondary" | "outline" | "destructive" } {
  const s = r.reservationStatus ?? "active";
  if (s === "completed") return { label: "Returned", tone: "secondary" };
  if (s === "pending") {
    if (!r.signatureDataUrl) return { label: "Awaiting signature", tone: "outline" };
    if (!r.paymentReceived) return { label: "Awaiting payment", tone: "outline" };
    return { label: "Pending hold", tone: "outline" };
  }
  return { label: "On rent", tone: "default" };
}

function totalPaidFor(rentalId: string) {
  return payments
    .filter((p) => p.rentalId === rentalId && p.status === "paid")
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

function balanceFor(rentalId: string) {
  return payments
    .filter((p) => p.rentalId === rentalId && p.status !== "paid")
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

function nextDueFor(rentalId: string): string | undefined {
  const upcoming = payments
    .filter((p) => p.rentalId === rentalId && p.status !== "paid")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return upcoming?.dueDate;
}

function AllReservationsPage() {
  useStoreVersion();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusKey>("all");
  const [selected, setSelected] = useState<Rental | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rentals
      .filter((r) => {
        if (status !== "all" && (r.reservationStatus ?? "active") !== status) return false;
        if (!term) return true;
        const d = driverById(r.driverId);
        const v = vehicleById(r.vehicleId);
        return [
          d?.fullName, d?.phone, d?.email,
          v?.plate, v?.make, v?.model, String(v?.year ?? ""),
        ].some((x) => (x ?? "").toString().toLowerCase().includes(term));
      })
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  }, [q, status]);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = rentals.filter((r) => (r.reservationStatus ?? "active") === "active").length;
    const pending = rentals.filter((r) => r.reservationStatus === "pending").length;
    const awaitingSig = rentals.filter((r) => r.reservationStatus === "pending" && !r.signatureDataUrl).length;
    const pastDue = rentals.filter((r) =>
      (r.reservationStatus ?? "active") === "active" && r.endDate && r.endDate < today
    ).length;
    const outstanding = rentals.reduce((sum, r) => sum + balanceFor(r.id), 0);
    return { active, pending, awaitingSig, pastDue, outstanding };
  }, [rows.length]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="All Reservations"
        subtitle="Every reservation across the fleet, with up-to-date status, payments and signing."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPI label="On rent" value={kpis.active} />
        <KPI label="Pending holds" value={kpis.pending} />
        <KPI label="Awaiting signature" value={kpis.awaitingSig} />
        <KPI label="Past due returns" value={kpis.pastDue} tone={kpis.pastDue ? "destructive" : "default"} />
        <KPI label="Outstanding" value={fmtMoney(kpis.outstanding)} />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search renter, plate, vehicle…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusKey)}>
          <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">On rent</SelectItem>
            <SelectItem value="completed">Returned</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "reservation" : "reservations"}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Renter</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Return</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Signed</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  No reservations match your filters.
                </TableCell>
              </TableRow>
            ) : rows.map((r) => {
              const d = driverById(r.driverId);
              const v = vehicleById(r.vehicleId);
              const label = reservationLabel(r);
              const period = r.billingPeriod === "daily" ? "day" : r.billingPeriod === "monthly" ? "mo" : "wk";
              const today = new Date().toISOString().slice(0, 10);
              const pastDue = r.endDate && r.endDate < today && (r.reservationStatus ?? "active") === "active";
              const paid = totalPaidFor(r.id);
              const balance = balanceFor(r.id);
              const nextDue = nextDueFor(r.id);
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(r)}
                >
                  <TableCell>
                    <div className="font-medium">{d?.fullName ?? r.driverId}</div>
                    <div className="text-xs text-muted-foreground">{d?.phone ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId}</div>
                    <div className="text-xs text-muted-foreground">{v?.plate}</div>
                  </TableCell>
                  <TableCell>{fmtDate(r.startDate)}</TableCell>
                  <TableCell className={pastDue ? "text-destructive font-medium" : ""}>
                    {r.endDate ? fmtDate(r.endDate) : "Open-ended"}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtMoney(Number(r.rate ?? r.weeklyRate ?? 0))}<span className="text-muted-foreground">/{period}</span>
                  </TableCell>
                  <TableCell className="text-right">{fmtMoney(paid)}</TableCell>
                  <TableCell className={`text-right ${balance > 0 ? "text-destructive font-medium" : ""}`}>
                    {fmtMoney(balance)}
                    {nextDue && balance > 0 && (
                      <div className="text-[10px] text-muted-foreground">due {fmtDate(nextDue)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={label.tone}>{label.label}</Badge>
                  </TableCell>
                  <TableCell>
                    {currentPeriodPaid(r)
                      ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Paid</Badge>
                      : <Badge variant="destructive">Unpaid</Badge>}
                  </TableCell>
                  <TableCell>
                    {r.signedAt ? <span className="text-emerald-600">✓ {fmtDate(r.signedAt.slice(0, 10))}</span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <DetailSheet rental={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function KPI({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "destructive" }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</div>
    </Card>
  );
}

function DetailSheet({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  if (!rental) return null;
  const d = driverById(rental.driverId);
  const v = vehicleById(rental.vehicleId);
  const paid = totalPaidFor(rental.id);
  const balance = balanceFor(rental.id);
  const hold = pendingExpiresAt(rental);
  const rentalPayments = payments.filter((p) => p.rentalId === rental.id);
  const hasDocs = !!(rental.licenseImageUrl || rental.selfieImageUrl || rental.clientSignatureUrl || rental.signatureDataUrl);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{d?.fullName ?? rental.driverId}</SheetTitle>
          <div className="text-sm text-muted-foreground">
            {v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : rental.vehicleId}
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">
              Documents {hasDocs && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-5 text-sm">
          <Section title="Reservation">
            <Row k="Status" v={reservationLabel(rental).label} />
            <Row k="Start" v={fmtDate(rental.startDate)} />
            <Row k="Return" v={rental.endDate ? fmtDate(rental.endDate) : "Open-ended"} />
            <Row k="Rate" v={`${fmtMoney(Number(rental.rate ?? rental.weeklyRate ?? 0))} / ${rental.billingPeriod ?? "weekly"}`} />
            <Row k="Deposit paid" v={fmtMoney(Number(rental.depositPaid ?? 0))} />
            {hold && <Row k="Hold expires" v={new Date(hold).toLocaleString()} />}
          </Section>

          <Section title="Payments">
            <Row k="Total paid" v={fmtMoney(paid)} />
            <Row k="Balance" v={fmtMoney(balance)} tone={balance > 0 ? "destructive" : undefined} />
            {rentalPayments.length > 0 && (
              <div className="mt-2 space-y-1">
                {rentalPayments
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                      <span>{fmtDate(p.dueDate)}</span>
                      <span>{fmtMoney(p.amount)}</span>
                      <Badge variant={p.status === "paid" ? "secondary" : "outline"}>{p.status}</Badge>
                    </div>
                  ))}
              </div>
            )}
          </Section>

          <Section title="Signing & ID">
            <Row k="Signed by" v={rental.signedBy ?? "—"} />
            <Row k="Signed at" v={rental.signedAt ? new Date(rental.signedAt).toLocaleString() : "—"} />
            <Row k="Agreement version" v={rental.agreementVersion ?? "—"} />
            {rental.signatureDataUrl && (
              <img src={rental.signatureDataUrl} alt="Signature" className="mt-2 max-h-16 border bg-white p-1" />
            )}
          </Section>

          <Section title="Renter">
            <Row k="Phone" v={d?.phone ?? "—"} />
            <Row k="Email" v={d?.email ?? "—"} />
            <Row k="License #" v={d?.licenseNumber ?? "—"} />
            <Row k="License expiry" v={d?.licenseExpiry ? fmtDate(d.licenseExpiry) : "—"} />
            <Row k="Address" v={d?.address ?? "—"} />
          </Section>

          {rental.extensions && rental.extensions.length > 0 && (
            <Section title="Extensions">
              {rental.extensions.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span>{fmtDate(e.extendedAt.slice(0, 10))} → {fmtDate(e.newEndDate)}</span>
                  <span>{fmtMoney(e.additionalAmount)}</span>
                </div>
              ))}
            </Section>
          )}

          {rental.notes && (
            <Section title="Notes"><p className="whitespace-pre-wrap text-sm">{rental.notes}</p></Section>
          )}

          <div className="flex gap-2 pt-2">
            <Button asChild className="flex-1">
              <Link to="/rentals">Open in workflow</Link>
            </Button>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-4 space-y-5 text-sm">
            {!hasDocs && (
              <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                No documents uploaded yet. The renter uploads their license, selfie and signs the agreement from the signing link.
              </div>
            )}

            <DocCard
              title="Driver's License"
              url={rental.licenseImageUrl}
              emptyHint="Renter hasn't uploaded a license yet."
            />
            <DocCard
              title="Selfie / ID Verification"
              url={rental.selfieImageUrl}
              emptyHint="Renter hasn't uploaded a selfie yet."
            />
            <DocCard
              title="Renter Signature (signed agreement)"
              url={rental.clientSignatureUrl}
              emptyHint="Agreement not signed by renter yet."
              caption={
                rental.clientSignedAt
                  ? `Signed ${new Date(rental.clientSignedAt).toLocaleString()}`
                  : undefined
              }
              whiteBg
            />
            {rental.signatureDataUrl && !rental.clientSignatureUrl && (
              <DocCard
                title="In-store Signature"
                url={rental.signatureDataUrl}
                emptyHint=""
                caption={rental.signedAt ? `Signed ${new Date(rental.signedAt).toLocaleString()}` : undefined}
                whiteBg
              />
            )}

            <div className="rounded-lg border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Rental Agreement
              </div>
              <div className="flex items-center justify-between text-sm">
                <div>
                  <div>Version: {rental.agreementVersion ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {rental.signedAt
                      ? `Signed ${new Date(rental.signedAt).toLocaleString()}`
                      : "Not signed yet"}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/rentals">Open agreement</Link>
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function DocCard({
  title,
  url,
  emptyHint,
  caption,
  whiteBg,
}: {
  title: string;
  url?: string;
  emptyHint: string;
  caption?: string;
  whiteBg?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={title}
            className={`max-h-64 w-full rounded border object-contain ${whiteBg ? "bg-white p-2" : "bg-muted/30"}`}
          />
          {caption && <div className="mt-1 text-xs text-muted-foreground">{caption}</div>}
        </a>
      ) : (
        <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
          {emptyHint}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "destructive" }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={`text-right ${tone === "destructive" ? "text-destructive font-medium" : ""}`}>{v}</span>
    </div>
  );
}