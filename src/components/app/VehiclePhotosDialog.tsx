import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VehicleGallery } from "@/components/app/VehicleGallery";
import { getVehiclePhotos, useStoreVersion } from "@/lib/mock/store";
import type { Vehicle } from "@/lib/mock/data";
import { Copy, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { sendVehiclePhotosSms } from "@/lib/vehicle-photo-share.functions";

export function VehiclePhotosDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: Vehicle | null;
}) {
  useStoreVersion();
  const sendPhotos = useServerFn(sendVehiclePhotosSms);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const photoUrls = useMemo(() => {
    if (!vehicle) return [] as string[];
    const gallery = getVehiclePhotos(vehicle.id).map((p) => p.url);
    const all = vehicle.imageUrl ? [vehicle.imageUrl, ...gallery.filter((u) => u !== vehicle.imageUrl)] : gallery;
    return all;
  }, [vehicle, open]);

  if (!vehicle) return null;

  const header = `${vehicle.year} ${vehicle.make} ${vehicle.model} — photos`;
  const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const shareText =
    photoUrls.length === 0
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model} — no photos available yet.`
      : `${vehicle.year} ${vehicle.make} ${vehicle.model} photos:\n${photoUrls.join("\n")}`;

  async function copyLinks() {
    if (photoUrls.length === 0) {
      toast.error("No photos to share yet — add some first");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success(`Copied ${photoUrls.length} photo link${photoUrls.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function shareSms() {
    if (photoUrls.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }
    const url = `sms:?&body=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank");
  }

  function shareWhatsApp() {
    if (photoUrls.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank");
  }

  async function sendDirect() {
    if (photoUrls.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }
    if (phone.trim().length < 7) {
      toast.error("Enter the client's phone number");
      return;
    }
    setSending(true);
    try {
      const res = await sendPhotos({ data: { phone: phone.trim(), vehicleLabel, photoUrls } });
      toast.success(`Sent ${res.sent} photo${res.sent === 1 ? "" : "s"} to ${phone.trim()}`);
      setPhone("");
    } catch (e) {
      toast.error("Could not send SMS", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-2">
          <DialogTitle className="text-base">{header}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <VehicleGallery vehicleId={vehicle.id} coverUrl={vehicle.imageUrl} />
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-background px-4 py-2">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="tel"
              placeholder="Client phone (e.g. +15551234567)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="sm:flex-1"
            />
            <Button size="sm" onClick={sendDirect} disabled={sending || photoUrls.length === 0}>
              <Send className="mr-1 h-4 w-4" /> {sending ? "Sending…" : "Text photos to client"}
            </Button>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"} ready to send
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyLinks}>
                <Copy className="mr-1 h-4 w-4" /> Copy links
              </Button>
              <Button size="sm" variant="outline" onClick={shareSms}>
                <MessageSquare className="mr-1 h-4 w-4" /> SMS app
              </Button>
              <Button size="sm" variant="outline" onClick={shareWhatsApp}>
                WhatsApp
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}