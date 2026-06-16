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
import { SendLinkPreview } from "@/components/app/SendLinkPreview";

const getPublicAppOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

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
  const [deposit, setDeposit] = useState<string>("300");
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (open && vehicle) {
      setStartDate(today);
      setBillingPeriod("weekly");
      setRate(String(vehicle.weeklyRate ?? ""));
      setDeposit("300");
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

  const url = token ? `${getPublicAppOrigin()}/rent/${token}` : "";

  async function handleCreate() {
    if (!vehicle) return;
    const r = Number(rate);
    if (!r || r <= 0) return toast.error("Enter a valid rate");
    const dep = Number(deposit) || 0;
    if (dep < 0) return toast.error("Enter a valid deposit");
    const cleanPhone = phone.trim();
    const willSend = cleanPhone.length >= 7;
    setCreating(true);
    try {
      const res = await create({ data: { vehicleId: vehicle.id, startDate, billingPeriod, rate: r, deposit: dep } });
      setToken(res.token);
      const newUrl = `${getPublicAppOrigin()}/rent/${res.token}`;
      if (willSend) {
        try {
          await sendSms({ data: { token: res.token, url: newUrl, phone: cleanPhone, name: name.trim() || undefined } });
          toast.success(`Link sent to ${cleanPhone}`);
        } catch (e) {
          toast.error("Link created — SMS failed", {
            description: e instanceof Error ? e.message : "Unknown error. Copy the link and send it manually.",
            duration: 8000,
          });
        }
      } else {
        toast.success("Share link generated");
      }
    } catch (e) {
      toast.error("Could not create share link", {
        description: e instanceof Error ? e.message : "Unknown error. Please try again.",
        duration: 8000,
      });
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
    const cleanPhone = phone.trim();
    if (cleanPhone.length < 7) return toast.error("Enter a valid phone number");
    setSmsLoading(true);
    try {
      await sendSms({ data: { token, url, phone: cleanPhone, name: name.trim() || undefined } });
      toast.success(`Sent to ${cleanPhone}`);
    } catch (e) {
      toast.error("SMS failed", {
        description: e instanceof Error ? e.message : "Unknown error. Copy the link and send it manually.",
        duration: 8000,
      });
    } finally {
      setSmsLoading(false);
    }
  }

  function handleSendEmail() {
    if (!url) return;
    if (!email.trim()) return toast.error("Enter an email");
    const subject = encodeURIComponent("Your Camauto Rentals application link");
    const body = encodeURIComponent(
      `${name ? `Hi ${name},\n\n` : "Hi,\n\n"}You're invited to rent a vehicle from Camauto Rentals.\n\nComplete your application — driver's license, selfie, and signature — here:\n${url}\n\nThis link expires in 60 days.\n\nThanks,\nCamauto Rentals`
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="share-start">Start date</Label>
              <Input id="share-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!!token} />
            </div>
            <div>
              <Label htmlFor="share-period">Billing period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "daily" | "weekly" | "monthly")} disabled={!!token}>
                <SelectTrigger id="share-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="share-rate">Rate ($)</Label>
              <Input
                id="share-rate"
                type="number"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                disabled={!!token}
              />
            </div>
            <div>
              <Label htmlFor="share-deposit">Deposit ($)</Label>
              <Input
                id="share-deposit"
                type="number"
                inputMode="decimal"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                disabled={!!token}
              />
              <p className="mt-1 text-xs text-muted-foreground">Charged with the first payment. Set 0 for none.</p>
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-2">
            <Label htmlFor="share-name" className="text-sm">Customer name (optional)</Label>
            <Input id="share-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />

            <Label htmlFor="share-phone" className="flex items-center gap-2 text-sm pt-2"><MessageSquare className="h-4 w-4" /> Customer phone</Label>
            <Input
              id="share-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555 555 5555"
            />
            <p className="text-xs text-muted-foreground">Leave blank to just generate a link.</p>
          </div>

          {!token ? (
            <>
            <SendLinkPreview route="/rent/[token]" />
            <Button type="button" onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : phone.trim().length >= 7
                ? <><MessageSquare className="h-4 w-4" /> Generate & text link</>
                : <><Link2 className="h-4 w-4" /> Generate share link</>}
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
                <p className="mt-1 text-xs text-muted-foreground">Anyone with this link can apply to rent this vehicle. Expires in 60 days.</p>
              </div>

              <Button type="button" onClick={handleSendSms} disabled={smsLoading} className="w-full" variant="secondary">
                {smsLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><MessageSquare className="h-4 w-4" /> Resend SMS</>}
              </Button>

              <div className="rounded-md border border-border p-3 space-y-2">
                <Label htmlFor="share-email" className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4" /> Send by email</Label>
                <div className="flex gap-2">
                  <Input id="share-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
                  <Button type="button" variant="outline" onClick={handleSendEmail}>Open</Button>
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