import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FileSignature, IdCard, UserRound, ReceiptText, ShieldAlert, FileText } from "lucide-react";
import { violations } from "@/lib/mock/data";
import type { Rental } from "@/lib/mock/data";

interface DocItem {
  key: string;
  label: string;
  url: string;
  kind: "image" | "pdf";
  icon: React.ReactNode;
}

function isPdf(url: string) {
  return url.toLowerCase().split("?")[0].endsWith(".pdf");
}

export function ReservationDocuments({ rental }: { rental: Rental }) {
  const [active, setActive] = useState<DocItem | null>(null);

  const docs: DocItem[] = [];

  const agreementUrl = rental.agreementPdfUrl;
  if (agreementUrl) {
    docs.push({
      key: "agreement",
      label: "Signed Agreement",
      url: agreementUrl,
      kind: isPdf(agreementUrl) ? "pdf" : "image",
      icon: <FileSignature className="h-6 w-6" />,
    });
  } else if (rental.clientSignatureUrl || rental.signatureDataUrl) {
    const sig = (rental.clientSignatureUrl || rental.signatureDataUrl)!;
    docs.push({
      key: "signature",
      label: "Signature",
      url: sig,
      kind: "image",
      icon: <FileSignature className="h-6 w-6" />,
    });
  }

  if (rental.licenseImageUrl) {
    docs.push({
      key: "license",
      label: "Driver's License",
      url: rental.licenseImageUrl,
      kind: "image",
      icon: <IdCard className="h-6 w-6" />,
    });
  }
  if (rental.selfieImageUrl) {
    docs.push({
      key: "selfie",
      label: "Selfie",
      url: rental.selfieImageUrl,
      kind: "image",
      icon: <UserRound className="h-6 w-6" />,
    });
  }
  if (rental.receiptPdfUrl) {
    docs.push({
      key: "receipt",
      label: "Rental Receipt",
      url: rental.receiptPdfUrl,
      kind: isPdf(rental.receiptPdfUrl) ? "pdf" : "image",
      icon: <ReceiptText className="h-6 w-6" />,
    });
  }

  // Violation photos for this rental window (if applicable)
  const rentalEnd = rental.endDate ?? new Date().toISOString().slice(0, 10);
  violations
    .filter(
      (x) =>
        x.vehicleId === rental.vehicleId &&
        x.driverId === rental.driverId &&
        x.dateIssued >= rental.startDate &&
        x.dateIssued <= rentalEnd,
    )
    .forEach((x) => {
      const photo = (x as { photoUrl?: string; photo_url?: string }).photoUrl ??
        (x as { photo_url?: string }).photo_url;
      if (photo) {
        docs.push({
          key: `violation-${x.id}`,
          label: "Violation Photo",
          url: photo,
          kind: isPdf(photo) ? "pdf" : "image",
          icon: <ShieldAlert className="h-6 w-6" />,
        });
      }
    });

  if (docs.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Documents</div>
        <div className="text-sm text-muted-foreground">No documents uploaded yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Documents</div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
        {docs.map((doc) => (
          <button
            key={doc.key}
            onClick={() => setActive(doc)}
            className="group flex flex-col items-center gap-1.5 rounded-md border border-border bg-background p-2 text-center transition-colors hover:border-primary"
          >
            <div className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded bg-muted">
              {doc.kind === "image" ? (
                <img src={doc.url} alt={doc.label} className="h-full w-full object-cover" />
              ) : (
                <FileText className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="absolute bottom-1 right-1 text-muted-foreground/70 group-hover:text-primary">
                {doc.icon}
              </span>
            </div>
            <span className="text-[11px] font-medium leading-tight">{doc.label}</span>
          </button>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-3xl p-2 sm:p-4">
          {active && (
            <div className="w-full">
              <div className="mb-2 text-sm font-medium">{active.label}</div>
              {active.kind === "pdf" ? (
                <iframe
                  src={active.url}
                  title={active.label}
                  className="h-[75vh] w-full rounded border border-border"
                />
              ) : (
                <img
                  src={active.url}
                  alt={active.label}
                  className="max-h-[75vh] w-full rounded object-contain"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}