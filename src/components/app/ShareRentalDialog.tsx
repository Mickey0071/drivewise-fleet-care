import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, MessageSquare, Mail, Link2, Loader2 } from "lucide-react";
import { createShareLink, sendShareLinkSms } from "@/lib/share-rental.functions";
import type { Vehicle } from "@/lib/mock/data";

export function ShareRentalDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicle: Vehicle | null;
}) {
  const create = useServerFn(createShareLink);
  const sendSms = useServerFn(sendShareLinkSms);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [startDate, setStartDate] = useState(today);
  const [billingPeriod, setBillingPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [rate, setRate] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [smsLoading, setSmsLoading] = useState(false);

  useEffect(() => {
    if (open && vehicle) {
      setStartDate(today);
      setBillingPeriod("weekly");
      setRate(String(vehicle.weeklyRate ?? ""));
      setToken(null);
      setPhone(""); setEmail(""); setName("");
    }
  }, [open, vehicle, today]);

  // Update default rate when billing period changes (only if not yet generated)
  useEffect(() => {
    if (!vehicle || token) return;
    if (billingPeriod === "daily") setRate(String(vehicle.dailyRate ?? ""));
    else if (billingPeriod === "weekly") setRate(String(vehicle.weeklyRate ?? ""));
    else if (billingPeriod === "monthly") setRate(String((vehicle.weeklyRate ?? 0) * 4));
  }, [billingPeriod, vehicle, token]);

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/rent/${token}` : "";

  async function handleCreate() {
    if (!vehicle) return;
    const r = Number(rate);
    if (!r || r <= 0) return toast.error("Enter a valid rate");
    setCreating(true);
    try {
      const res = await create({ data: { vehicleId: vehicle.id, startDate, billingPeriod, rate: r } });
      setToken(res.token);
      toast.success("Share link generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function handleSendSms() {
    if (!url || !token) return;
    if (!phone.trim()) return toast.error("Enter a phone number");
    setSmsLoading(true);
    try {
      await sendSms({ data: { token, url, phone: phone.trim(), name: name.trim() || undefined } });
      toast.success(`Sent to ${phone}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "SMS failed");
    } finally {
      setSmsLoading(false);
    }
  }

  function handleSendEmail() {
    if (!url) return;
    if (!email.trim()) return toast.error("Enter an email");
    const subject = encodeURIComponent("Your Camauto Rentals application link");
    const body = encodeURIComponent(
      `${name ? `Hi ${name},\n\n` : "Hi,\n\n"}You're invited to rent a vehicle from Camauto Rentals.\n\nComplete your application — driver's license, selfie, and signature — here:\n${url}\n\nThis link expires in 14 days.\n\nThanks,\nCamauto Rentals`
    );
    window.open(`mailto:${encodeURIComponent(email.trim())}?subject=${subject}&body=${body}`, "_blank");
    toast.success("Opening your mail client…");
  }

  if (!vehicle) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share rental link</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <div className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</div>
            <div className="text-xs text-muted-foreground">Plate {vehicle.plate}</div>
          </div>

          {!token ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="share-start">Start date</Label>
                  <Input id="share-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="share-period">Billing period</Label>
                  <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "daily" | "weekly" | "monthly")}>
                    <SelectTrigger id="share-period"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="share-rate">Rate ($)</Label>
                <Input
                  id="share-rate"
                  type="number"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Link2 className="h-4 w-4" /> Generate share link</>}
              </Button>
            </>
          ) : (
            <>
              <div>
                <Label>Public link</Label>
                <div className="mt-1 flex gap-2">
                  <Input readOnly value={url} className="font-mono text-xs" />
                  <Button type="button" variant="outline" onClick={handleCopy}><Copy className="h-4 w-4" /></Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Anyone with this link can apply to rent this vehicle. Expires in 14 days.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="share-name">Customer name (optional)</Label>
                <Input id="share-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <Label htmlFor="share-phone" className="flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4" /> Send by SMS</Label>
                <div className="flex gap-2">
                  <Input id="share-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 555 5555" />
                  <Button onClick={handleSendSms} disabled={smsLoading}>
                    {smsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <Label htmlFor="share-email" className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4" /> Send by email</Label>
                <div className="flex gap-2">
                  <Input id="share-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
                  <Button variant="outline" onClick={handleSendEmail}>Open</Button>
                </div>
                <p className="text-xs text-muted-foreground">Opens your mail client with the link pre-filled.</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}