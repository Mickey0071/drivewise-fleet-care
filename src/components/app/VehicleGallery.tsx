import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ImagePlus, Trash2, Star, ChevronLeft, ChevronRight, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  addVehicleGalleryPhoto,
  deleteVehicleGalleryPhoto,
  getVehiclePhotos,
  updateVehicleImage,
  useStoreVersion,
} from "@/lib/mock/store";

export function VehicleGallery({ vehicleId, coverUrl }: { vehicleId: string; coverUrl?: string }) {
  useStoreVersion();
  const photos = getVehiclePhotos(vehicleId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const f of Array.from(files)) {
      try {
        await addVehicleGalleryPhoto(vehicleId, f);
        ok++;
      } catch (e: any) {
        fail++;
        console.error(e);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (ok) toast.success(`Added ${ok} photo${ok === 1 ? "" : "s"}`);
    if (fail) toast.error(`${fail} photo${fail === 1 ? "" : "s"} failed to upload`);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this photo?")) return;
    try {
      await deleteVehicleGalleryPhoto(id);
      toast.success("Photo deleted");
    } catch (e: any) {
      toast.error("Delete failed", { description: e?.message ?? "Try again" });
    }
  }

  async function handleSetCover(url: string) {
    try {
      await updateVehicleImage(vehicleId, url);
      toast.success("Cover photo updated");
    } catch (e: any) {
      toast.error("Could not set as cover", { description: e?.message ?? "Try again" });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Photos ({photos.length})</CardTitle>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />}
          {uploading ? "Uploading…" : "Add photos"}
        </Button>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40"
          >
            <ImagePlus className="h-6 w-6" />
            Add interior, dashboard, or damage photos
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p, idx) => {
              const isCover = coverUrl === p.url;
              return (
                <div key={p.id} className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                  <img
                    src={p.url}
                    alt={p.caption ?? "Vehicle photo"}
                    className="h-full w-full cursor-zoom-in object-cover transition-transform group-hover:scale-105"
                    onClick={() => setLightboxIdx(idx)}
                  />
                  {isCover && (
                    <span className="absolute left-1 top-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      Cover
                    </span>
                  )}
                  <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!isCover && (
                      <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => handleSetCover(p.url)} title="Set as cover">
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="destructive" className="ml-auto h-7 w-7" onClick={() => handleDelete(p.id)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted/40"
            >
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            </button>
          </div>
        )}
      </CardContent>

      <Dialog open={lightboxIdx !== null} onOpenChange={(o) => !o && setLightboxIdx(null)}>
        <DialogContent className="max-w-4xl border-none bg-black/95 p-0">
          {lightboxIdx !== null && photos[lightboxIdx] && (
            <div className="relative">
              <img
                src={photos[lightboxIdx].url}
                alt={photos[lightboxIdx].caption ?? "Vehicle photo"}
                className="max-h-[80vh] w-full object-contain"
              />
              <Button
                size="icon"
                variant="secondary"
                className="absolute left-2 top-1/2 -translate-y-1/2"
                onClick={() => setLightboxIdx((i) => (i! - 1 + photos.length) % photos.length)}
                disabled={photos.length < 2}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setLightboxIdx((i) => (i! + 1) % photos.length)}
                disabled={photos.length < 2}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute right-2 top-2"
                onClick={() => setLightboxIdx(null)}
              >
                <X className="h-5 w-5" />
              </Button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-white">
                {lightboxIdx + 1} / {photos.length}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}