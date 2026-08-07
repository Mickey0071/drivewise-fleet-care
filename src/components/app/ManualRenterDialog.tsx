import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { SignaturePad } from "@/components/app/SignaturePad";
import { createManualRenter, saveBlankAgreement } from "@/lib/dispute-packets.functions";
import { renderBlankRentalAgreementPdf } from "@/components/pdf/BlankRentalAgreementPDF";

const today = () => new Date().toISOString().slice(0, 10);

export function ManualRenterDialog({
  open,
  onOpenChange,
  plate,
  incidentDate,
  onCreated,
  onMatched,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plate: string | null;
  incidentDate: string | null;
  onCreated: (renter: { id: string; name: string }) => void;
  /** Fired once the plate is permanently linked to the renter. */
  onMatched?: (plate: string, renter: { id: string; name: string }) => void;
}) {
  const create = useServerFn(createManualRenter);
  const saveAgreement = useServerFn(saveBlankAgreement);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [renter, setRenter] = useState<{ id: string; name: string } | null>(null);

  const [startDate, setStartDate] = useState(incidentDate ?? today());
  const [endDate, setEndDate] = useState("");
  const [weeklyRate, setWeeklyRate] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setAddress("");
    setPhone("");
    setRenter(null);
    setEndDate("");
    setWeeklyRate("");
    setSignature(null);
  };

  const submitRenter = async () => {
    if (name.trim().length < 2) return toast.error("Enter the renter's name.");
    if (address.trim().length < 3) return toast.error("Enter the renter's address.");
    setBusy(true);
    try {
      const res = await create({
        data: { name: name.trim(), address: address.trim(), phone: phone.trim() || undefined },
      });
      setRenter(res);
      onCreated(res);
      toast.success("Renter created and linked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create renter");
    } finally {
      setBusy(false);
    }
  };

  const generateAgreement = async () => {
    if (!renter) return;
    if (!startDate || !endDate) return toast.error("Enter rental start and end dates.");
    setBusy(true);
    try {
      const bytes = await renderBlankRentalAgreementPdf({
        renterName: renter.name,
        renterAddress: address.trim(),
        renterPhone: phone.trim() || null,
        plate,
        incidentDate,
        startDate,
        endDate,
        weeklyRate: Number(weeklyRate || 0),
        signatureDataUrl: signature,
        signedDate: today(),
      });
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      await saveAgreement({
        data: {
          renterId: renter.id,
          renterName: renter.name,
          plate,
          pdfBase64: btoa(bin),
          signedDate: today(),
        },
      });
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${renter.id}_${plate ?? "NOPLATE"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (plate) {
        onMatched?.(plate, renter);
        toast.success(`${plate} is now permanently matched to ${renter.name}`);
      } else {
        toast.success("Agreement generated and stored");
      }
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate agreement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{renter ? "Blank rental agreement" : "Create renter"}</DialogTitle>
          <DialogDescription>
            {renter
              ? "Fill the rental term, sign, and we'll store the agreement against this plate."
              : "Add a renter that isn't in the database yet and link them to this violation."}
          </DialogDescription>
        </DialogHeader>

        {!renter ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Renter name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, Newark, NJ 07102"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone (optional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Renter:</span> <strong>{renter.name}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Plate:</span> <strong>{plate ?? "—"}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Incident date:</span>{" "}
                <strong>{incidentDate ?? "—"}</strong>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Weekly rate</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={weeklyRate}
                  onChange={(e) => setWeeklyRate(e.target.value)}
                  placeholder="450"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Renter signature (optional — or print and sign)</Label>
              <SignaturePad onChange={setSignature} height={140} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={renter ? generateAgreement : submitRenter} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {renter ? "Generate blank vehicle rental agreement" : "Create and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
