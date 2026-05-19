import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { vehicleById, driverById, type Rental } from "@/lib/mock/data";

type Props = {
  rental: Rental | null;
  onClose: () => void;
  /** Called when the admin picks "Dispatch runner" — parent opens NewTaskDialog with prefill. */
  onDispatchRunner: (rental: Rental) => void;
};

export function ReturnVehicleDialog({ rental, onClose, onDispatchRunner }: Props) {
  const navigate = useNavigate();
  if (!rental) {
    return (
      <Dialog open={false} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent />
      </Dialog>
    );
  }
  const v = vehicleById(rental.vehicleId);
  const d = driverById(rental.driverId);
  const vLabel = v ? `${v.year} ${v.make} ${v.model} — ${v.plate}` : rental.vehicleId;
  const dName = d?.fullName ?? "Customer";

  function returnNow() {
    onClose();
    navigate({ to: "/checklist", search: { rental_id: rental!.id, mode: "return" } });
  }

  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Return {vLabel}</DialogTitle>
          <p className="text-sm text-muted-foreground">Customer: {dName}</p>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={returnNow}
            className="w-full rounded-lg border-2 border-primary bg-primary px-4 py-4 text-left text-primary-foreground transition hover:opacity-90"
          >
            <div className="text-base font-semibold">🚗 Return now (I have the vehicle)</div>
            <div className="mt-1 text-sm opacity-90">Complete the return inspection yourself.</div>
          </button>
          <button
            type="button"
            onClick={() => onDispatchRunner(rental)}
            className="w-full rounded-lg border-2 border-border bg-background px-4 py-4 text-left transition hover:bg-muted"
          >
            <div className="text-base font-semibold">🏃 Dispatch runner to retrieve</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Send a runner to pick up the vehicle. They'll complete the return inspection on-site.
            </div>
          </button>
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}