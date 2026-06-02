import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banknote, CreditCard, Smartphone, ChevronRight } from "lucide-react";
import type { SavedCard } from "@/lib/card-display";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  renterName: string;
  balance: number;
  savedCard?: SavedCard | null;
  onCash: () => void;
  onCard: () => void;
  onLink: () => void;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  renterName,
  balance,
  savedCard,
  onCash,
  onCard,
  onLink,
}: Props) {
  const cardUsable = !!savedCard && !savedCard.expired;
  const choose = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="font-medium">{renterName || "Renter"}</div>
            <div className="text-muted-foreground">
              Balance due: <span className="font-semibold text-foreground">${balance.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => choose(onCash)}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Banknote className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Record Cash Payment</span>
              <span className="block text-xs text-muted-foreground">Manual entry — updates balance &amp; P&amp;L instantly</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => choose(onCard)}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CreditCard className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Charge Card on File</span>
              <span className="block text-xs text-muted-foreground">
                {cardUsable
                  ? `Charge •••• ${savedCard?.last4} instantly`
                  : "No active card on file"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => choose(onLink)}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <Smartphone className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Send Payment Link</span>
              <span className="block text-xs text-muted-foreground">SMS / email a secure checkout link</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
