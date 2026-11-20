import { useEffect, useState } from "react";
import { agreementObjectUrl } from "@/lib/agreement-download";

export function AgreementPreview({ url, title, className }: { url: string; title: string; className?: string }) {
  const [fitted, setFitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setFitted(null); setError(null);
    agreementObjectUrl(url).then(value => {
      if (!alive) { URL.revokeObjectURL(value); return; }
      objectUrl = value; setFitted(value);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load agreement"); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!fitted) return <p className="text-sm text-muted-foreground">Preparing agreement…</p>;
  return <iframe src={fitted} title={title} className={className} />;
}