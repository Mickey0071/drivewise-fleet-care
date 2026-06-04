import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listAutoExtensionOffers,
  resendAutoExtensionOffer,
  cancelAutoExtensionOffer,
  manualOverrideExtension,
  type AdminOffer,
} from "@/lib/admin-extensions.functions";
import { Loader2, Send, Ban, Wand2 } from "lucide-react";

export const Route = createFileRoute("/admin/extensions")({
  head: () => ({ meta: [{ title: "Auto-Extension Offers — Camauto Rentals" }] }),
  component: ExtensionsPage,
});

const FILTERS = ["all", "sent", "signed", "paid", "expired", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
    return `${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear()).slice(2)}`;
  } catch {
    return s;
  }
}
function fmtMoney(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

/** Derive a user-facing status from the offer + linked extension. */
function deriveStatus(o: AdminOffer): Filter | "sent" {
  if (o.status === "cancelled") return "cancelled";
  if (o.paidAt) return "paid";
  if (o.signedAt || o.status === "consumed") return "signed";
  if (new Date(o.expiresAt).getTime() < Date.now()) return "expired";
  return "sent";
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    paid: "default",
    signed: "secondary",
    sent: "outline",
    expired: "destructive",
    cancelled: "destructive",
  };
  return (map[s] as any) ?? "outline";
}

function ExtensionsPage() {
  const load = useServerFn(listAutoExtensionOffers);
  const resendFn = useServerFn(resendAutoExtensionOffer);
  const cancelFn = useServerFn(cancelAutoExtensionOffer);
  const overrideFn = useServerFn(manualOverrideExtension);

  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<AdminOffer | null>(null);

  const refresh = () =>
    load()
      .then((r) => setOffers(r.offers))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return offers
      .map((o) => ({ o, derived: deriveStatus(o) }))
      .filter(({ derived }) => filter === "all" || derived === filter);
  }, [offers, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of offers) {
      const s = deriveStatus(o);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [offers]);

  async function onResend(o: AdminOffer) {
    setBusy(o.token + ":resend");
    try {
      await resendFn({ data: { token: o.token } });
      toast.success("Link resent");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setBusy(null);
    }
  }
  async function onCancel(o: AdminOffer) {
    setBusy(o.token + ":cancel");
    try {
      await cancelFn({ data: { token: o.token } });
      toast.success("Offer cancelled");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }
  async function onOverride(o: AdminOffer, choice: "daily" | "weekly") {
    setBusy(o.token + ":override");
    try {
      const r = await overrideFn({ data: { token: o.token, choice } });
      toast.success(`Extended to ${fmtDate(r.newEndDate)}`);
      setView(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Override failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auto-Extension Offers"
        subtitle="Track every extension offer sent to customers — sent, signed, paid, expired, or cancelled."
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f}
            {f !== "all" && counts[f] ? ` (${counts[f]})` : ""}
          </Button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No offers found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ o, derived }) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.customerName || "—"}</TableCell>
                  <TableCell>{o.vehicle || "—"}</TableCell>
                  <TableCell>{fmtDate(o.sentAt)}</TableCell>
                  <TableCell className="capitalize">{o.extensionChoice || o.offerType || "—"}</TableCell>
                  <TableCell>{fmtMoney(o.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge(derived)} className="capitalize">
                      {derived}
                      {o.autoPayEnabled ? " · auto" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => setView(o)}>
                      View
                    </Button>
                    {derived !== "paid" && o.status !== "consumed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === o.token + ":resend"}
                        onClick={() => onResend(o)}
                      >
                        {busy === o.token + ":resend" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer Details</DialogTitle>
          </DialogHeader>
          {view && (
            <div className="space-y-2 text-sm">
              <Row label="Customer" value={view.customerName} />
              <Row label="Phone" value={view.phone} />
              <Row label="Email" value={view.email} />
              <Row label="Vehicle" value={view.vehicle} />
              <Row label="Sent" value={fmtDate(view.sentAt)} />
              <Row label="Opened" value={view.openedAt ? fmtDate(view.openedAt) : "—"} />
              <Row label="Chose" value={view.extensionChoice || "—"} />
              <Row label="Auto-pay" value={view.autoPayEnabled ? "Yes" : "No"} />
              <Row label="Amount" value={fmtMoney(view.amount)} />
              <Row label="Signed at" value={fmtDate(view.signedAt)} />
              <Row label="Paid at" value={fmtDate(view.paidAt)} />
              <Row label="New end date" value={fmtDate(view.newEndDate)} />
              <Row label="Resent count" value={String(view.resentCount)} />
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {view && view.status !== "consumed" && view.status !== "cancelled" && (
              <>
                <Button
                  variant="outline"
                  disabled={busy === view.token + ":cancel"}
                  onClick={() => onCancel(view)}
                >
                  <Ban className="mr-1 h-4 w-4" /> Cancel Offer
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === view.token + ":override"}
                  onClick={() => onOverride(view, "daily")}
                >
                  <Wand2 className="mr-1 h-4 w-4" /> Override +1 day
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === view.token + ":override"}
                  onClick={() => onOverride(view, "weekly")}
                >
                  <Wand2 className="mr-1 h-4 w-4" /> Override +1 week
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}