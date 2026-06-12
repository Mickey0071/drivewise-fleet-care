import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/StatusBadge";
import {
  drivers,
  rentals,
  payments,
  vehicleById,
  fmtDate,
  fmtMoney,
} from "@/lib/mock/data";
import type { Driver } from "@/lib/mock/data";
import { formatAddressBlock } from "@/lib/us-states";
import { Ban, Car, CreditCard, IdCard, Mail, MapPin, Phone, User } from "lucide-react";

/**
 * Channel mapping mirrors the P&L page so a renter's "Money Spent" total
 * coincides with the revenue attributed to them in P&L (paid payments only).
 */
function channelOf(method?: string): "stripe" | "cash" {
  const m = (method ?? "").toLowerCase();
  if (m === "stripe" || m === "card") return "stripe";
  return "cash";
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="break-words font-medium">{value || "—"}</div>
      </div>
    </div>
  );
}

export function RenterDetailDialog({
  driver,
  onClose,
}: {
  driver: Driver | null;
  onClose: () => void;
}) {
  const open = Boolean(driver);
  // Re-resolve from the live mock store so edits reflect immediately.
  const d = driver ? drivers.find((x) => x.id === driver.id) ?? driver : null;

  const myRentals = d
    ? rentals
        .filter((r) => r.driverId === d.id)
        .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))
    : [];

  const myPaid = d
    ? payments
        .filter((p) => p.driverId === d.id && p.status === "paid")
        .sort((a, b) => (b.paidDate ?? b.dueDate).localeCompare(a.paidDate ?? a.dueDate))
    : [];

  const totalSpent = myPaid.reduce((s, p) => s + p.amount, 0);
  const stripeSpent = myPaid
    .filter((p) => channelOf(p.method) === "stripe")
    .reduce((s, p) => s + p.amount, 0);
  const cashSpent = totalSpent - stripeSpent;

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {d && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {d.fullName}
                <StatusBadge status={d.status} />
                {d.blocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                    <Ban className="h-3 w-3" /> Blocked
                  </span>
                )}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {d.id} · Renter since {fmtDate(d.dateAdded)}
              </p>
            </DialogHeader>

            <Tabs defaultValue="info">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="info">Information</TabsTrigger>
                <TabsTrigger value="rentals">
                  Rental History ({myRentals.length})
                </TabsTrigger>
                <TabsTrigger value="money">Money Spent</TabsTrigger>
              </TabsList>

              {/* INFORMATION */}
              <TabsContent value="info" className="mt-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={d.phone} />
                  <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={d.email} />
                  <InfoRow icon={<User className="h-4 w-4" />} label="Date of Birth" value={fmtDate(d.dateOfBirth)} />
                  <InfoRow icon={<Car className="h-4 w-4" />} label="Rideshare" value={d.rideshare} />
                  <InfoRow
                    icon={<IdCard className="h-4 w-4" />}
                    label="Driver's License"
                    value={[d.licenseNumber, d.dlState].filter(Boolean).join(" · ")}
                  />
                  <InfoRow icon={<IdCard className="h-4 w-4" />} label="License Expires" value={fmtDate(d.licenseExpiry)} />
                  <InfoRow icon={<MapPin className="h-4 w-4" />} label="Address" value={address} />
                  <InfoRow
                    icon={<CreditCard className="h-4 w-4" />}
                    label="Card on File"
                    value={d.cardLast4 ? `${d.cardBrand ?? "Card"} •••• ${d.cardLast4}` : "None"}
                  />
                  <InfoRow icon={<User className="h-4 w-4" />} label="Insurance on File" value={d.insuranceOnFile ? "Yes" : "No"} />
                  {(d.altContactName || d.altContactPhone) && (
                    <InfoRow
                      icon={<Phone className="h-4 w-4" />}
                      label="Alternate Contact"
                      value={[d.altContactName, d.altContactPhone].filter(Boolean).join(" · ")}
                    />
                  )}
                </div>
                {d.blocked && d.blockReason && (
                  <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
                    Blocked: {d.blockReason}
                  </div>
                )}
              </TabsContent>

              {/* RENTAL HISTORY */}
              <TabsContent value="rentals" className="mt-3">
                {myRentals.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No rentals on record for this renter.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {myRentals.map((r) => {
                      const v = vehicleById(r.vehicleId);
                      return (
                        <Card key={r.id}>
                          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                            <div className="min-w-0">
                              <div className="font-medium">
                                {v ? `${v.year} ${v.make} ${v.model}` : "Vehicle (removed)"}
                                {v?.plate ? ` · ${v.plate}` : ""}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : "ongoing"}
                                {" · "}
                                {r.id}
                              </div>
                            </div>
                            {r.reservationStatus && <StatusBadge status={r.reservationStatus} />}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* MONEY SPENT */}
              <TabsContent value="money" className="mt-3">
                <div className="grid grid-cols-3 gap-2">
                  <Card>
                    <CardContent className="p-3 text-center">
                      <div className="text-xs text-muted-foreground">Total Spent</div>
                      <div className="text-lg font-bold">{fmtMoney(totalSpent)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <div className="text-xs text-muted-foreground">Card / Stripe</div>
                      <div className="text-lg font-semibold">{fmtMoney(stripeSpent)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <div className="text-xs text-muted-foreground">Cash / Other</div>
                      <div className="text-lg font-semibold">{fmtMoney(cashSpent)}</div>
                    </CardContent>
                  </Card>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reflects paid payments only — the same figures attributed to this renter in P&L.
                </p>
                {myPaid.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No payments recorded yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-1">
                    {myPaid.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-md border p-2 text-sm"
                      >
                        <div>
                          <div className="font-medium">{fmtMoney(p.amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDate(p.paidDate ?? p.dueDate)} · {p.method ?? "Cash"} · {p.rentalId}
                          </div>
                        </div>
                        <StatusBadge status="paid" />
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}