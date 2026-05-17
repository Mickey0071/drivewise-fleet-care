import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VehicleGallery } from "@/components/app/VehicleGallery";
import { getVehiclePhotos, useStoreVersion } from "@/lib/mock/store";
import type { Vehicle } from "@/lib/mock/data";
import { Copy, MessageSquare } from "lucide-react";
import { toast } from "sonner";

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

  const photoUrls = useMemo(() => {
    if (!vehicle) return [] as string[];
    const gallery = getVehiclePhotos(vehicle.id).map((p) => p.url);
    const all = vehicle.imageUrl ? [vehicle.imageUrl, ...gallery.filter((u) => u !== vehicle.imageUrl)] : gallery;
    return all;
  }, [vehicle, open]);

  if (!vehicle) return null;

  const header = `${vehicle.year} ${vehicle.make} ${vehicle.model} — photos`;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-2">
          <DialogTitle className="text-base">{header}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <VehicleGallery vehicleId={vehicle.id} coverUrl={vehicle.imageUrl} />
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-background px-4 py-2 sm:flex-row sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"} ready to send
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyLinks}>
              <Copy className="mr-1 h-4 w-4" /> Copy links
            </Button>
            <Button size="sm" variant="outline" onClick={shareSms}>
              <MessageSquare className="mr-1 h-4 w-4" /> SMS
            </Button>
            <Button size="sm" onClick={shareWhatsApp}>
              WhatsApp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}