import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openOnePageAgreement } from "@/lib/agreement-download";

export function AgreementDownload({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  return <Button size="sm" variant="ghost" className={className} disabled={busy} onClick={async () => {
    setBusy(true);
    try { await openOnePageAgreement(url); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not open rental agreement"); }
    finally { setBusy(false); }
  }}>{busy ? "Preparing…" : children}</Button>;
}