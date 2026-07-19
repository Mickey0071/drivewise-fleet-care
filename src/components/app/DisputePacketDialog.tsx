import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { downloadViolationPacket } from "@/lib/violation-packet.functions";

type IncludeKey =
  | "coverLetter"
  | "agreement"
  | "license"
  | "selfie"
  | "signature"
  | "receipt"
  | "violationPhoto";

const OPTIONS: Array<{ key: IncludeKey; label: string; hint?: string }> = [
  { key: "coverLetter", label: "Cover Letter (summary sheet)" },
  { key: "agreement", label: "Signed Rental Agreement" },
  { key: "license", label: "Driver's License" },
  { key: "selfie", label: "Renter Selfie" },
  { key: "signature", label: "Renter Signature" },
  { key: "receipt", label: "Rental Receipt" },
  { key: "violationPhoto", label: "Violation Photo / Notice" },
];

export function DisputePacketDialog({
  violationId,
  onClose,
}: {
  violationId: string | null;
  onClose: () => void;
}) {
  const dl = useServerFn(downloadViolationPacket);
  const [busy, setBusy] = useState(false);
  const [include, setInclude] = useState<Record<IncludeKey, boolean>>({
    coverLetter: true,
    agreement: true,
    license: true,
    selfie: false,
    signature: false,
    receipt: false,
    violationPhoto: true,
  });
  const [addressPrompt, setAddressPrompt] = useState(false);
  const [address, setAddress] = useState("");
  const [sigPrompt, setSigPrompt] = useState(false);
  const [allowUnsigned, setAllowUnsigned] = useState(false);

  useEffect(() => {
    if (violationId) {
      setAddressPrompt(false);
      setSigPrompt(false);
      setAddress("");
      setAllowUnsigned(false);
    }
  }, [violationId]);

  const open = Boolean(violationId);
  const toggle = (k: IncludeKey) =>
    setInclude((s) => ({ ...s, [k]: !s[k] }));

  const generate = async () => {
    if (!violationId) return;
    if (!Object.values(include).some(Boolean)) {
      toast.error("Pick at least one document to include.");
      return;
    }
    if (addressPrompt && address.trim().length < 5) {
      toast.error("Enter the renter's full address.");
      return;
    }
    if (sigPrompt && !allowUnsigned) {
      toast.error(
        "Tick 'Proceed without signature' to override, or send a retroactive signing link first.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await dl({
        data: {
          violationId,
          include,
          renterAddressOverride: addressPrompt ? address.trim() : undefined,
          allowUnsigned: sigPrompt ? allowUnsigned : undefined,
        },
      });
      if (!res.ok) {
        if (res.errorCode === "missing_address") {
          setAddressPrompt(true);
          toast.error(res.error ?? "Renter address is missing on the agreement.");
          return;
        }
        if (res.errorCode === "missing_signature") {
          setSigPrompt(true);
          toast.error(res.error ?? "Renter signature is missing on the agreement.");
          return;
        }
        toast.error("Packet failed");
        return;
      }
      const bin = atob(res.base64!);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename!;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        res.missing && res.missing.length > 0
          ? `Packet downloaded — missing: ${res.missing.join(", ")}`
          : "Packet downloaded",
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Packet failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose documents for the dispute packet</DialogTitle>
          <DialogDescription>
            Pick which items to include in the ZIP. The rental agreement must have the renter's address AND signature — you'll be prompted below if either is missing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {OPTIONS.map((o) => (
            <label key={o.key} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={include[o.key]}
                onCheckedChange={() => toggle(o.key)}
                className="mt-0.5"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>

        {addressPrompt && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <p className="text-xs font-medium text-destructive">
              ⚠ Renter address is missing on the agreement.
            </p>
            <Label className="text-xs text-destructive">
              Enter renter's mailing address (will be saved to their record)
            </Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Newark, NJ 07102"
              className="bg-background"
            />
          </div>
        )}

        {sigPrompt && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <p className="text-xs font-medium text-destructive">
              ⚠ Rental agreement has no renter signature.
            </p>
            <p className="text-[11px] text-destructive/80">
              Prefer sending a retroactive signing link from the row first. To proceed anyway:
            </p>
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={allowUnsigned}
                onCheckedChange={(v) => setAllowUnsigned(Boolean(v))}
                className="mt-0.5"
              />
              <span>Proceed without renter signature (admin override)</span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={generate}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Download Packet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}