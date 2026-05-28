import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState<string>("");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const startStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch {
      toast.error("Could not access camera. Check permissions or use Upload from Files.");
      onOpenChange(false);
    }
  }, [onOpenChange]);

  useEffect(() => {
    if (open) {
      setCaptured("");
      void startStream();
    } else {
      stopStream();
      setCaptured("");
    }
    return () => stopStream();
  }, [open, startStream, stopStream]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCaptured(canvas.toDataURL("image/jpeg", 0.9));
    stopStream();
  };

  const retake = () => {
    setCaptured("");
    void startStream();
  };

  const useThis = () => {
    if (!captured) return;
    const [meta, b64] = captured.split(",");
    const mime = /data:([^;]+);/.exec(meta)?.[1] ?? "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], `camera-${Date.now()}.jpg`, { type: mime });
    onCapture(file);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{captured ? "Does this look good?" : "Take Photo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border bg-black">
            {captured ? (
              <img src={captured} alt="Captured" className="max-h-[60vh] w-full object-contain" />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                className="max-h-[60vh] w-full object-contain"
              />
            )}
          </div>
          {captured ? (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={retake}>
                Retake
              </Button>
              <Button className="flex-1" onClick={useThis}>
                Use This Photo
              </Button>
            </div>
          ) : (
            <Button className="w-full" size="lg" onClick={takePhoto} disabled={!ready}>
              {ready ? "📸 Capture" : "Starting camera…"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}