import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Mobile-friendly photo picker that downsizes to JPEG data URLs. */
export function PhotoCapture({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  value: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">(value ? "uploaded" : "idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const MAX_BYTES = 25 * 1024 * 1024;

  useEffect(() => {
    if (value && status !== "uploaded" && status !== "uploading") setStatus("uploaded");
  }, [value, status]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      const msg = "File too large, max 25MB";
      setErrorMsg(msg); setStatus("error"); toast.error(msg);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setErrorMsg(null); setStatus("uploading");
    const reader = new FileReader();
    reader.onerror = () => { setErrorMsg("Could not read file"); setStatus("error"); };
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => { setErrorMsg("Invalid image file"); setStatus("error"); };
      img.onload = () => {
        try {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) onChange(reader.result as string);
          else {
            ctx.drawImage(img, 0, 0, w, h);
            onChange(canvas.toDataURL("image/jpeg", 0.85));
          }
          setStatus("uploaded");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not process image";
          setErrorMsg(msg); setStatus("error"); toast.error(msg);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {value && status !== "uploading" && status !== "error" ? (
        <div className="space-y-2">
          <img src={value} alt={label} className="max-h-48 w-full rounded border bg-muted/30 object-contain" />
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Uploaded
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Replace</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Button type="button" variant="outline" className="w-full" disabled={status === "uploading"} onClick={() => inputRef.current?.click()}>
            {status === "uploading" ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>) : status === "error" ? `Retry — ${label}` : label}
          </Button>
          {status === "error" && errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}