import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { vehicleById, driverById, type Rental } from "@/lib/mock/data";
import { useAuth } from "@/hooks/use-auth";
import { adminOverrideReturn } from "@/lib/admin-override-return.functions";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

type Props = {
  rental: Rental | null;
  onClose: () => void;
  /** Called when the admin picks "Dispatch runner" — parent opens NewTaskDialog with prefill. */
  onDispatchRunner: (rental: Rental) => void;
};

export function ReturnVehicleDialog({ rental, onClose, onDispatchRunner }: Props) {
  const navigate = useNavigate();
  const router = useRouter();
  const { role } = useAuth();
  const overrideFn = useServerFn(adminOverrideReturn);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  async function runOverride() {
    if (!rental) return;
    setSubmitting(true);
    try {
      const res = await overrideFn({ data: { rental_id: rental.id } });
      if (res.alreadyReturned) {
        toast.info("Rental was already returned.");
      } else {
        const smsNote =
          res.sms_status === "sent"
            ? " Renter notified by SMS."
            : res.sms_status === "skipped_no_phone"
              ? " (No phone on file — SMS skipped.)"
              : " (SMS failed to send.)";
        toast.success(`Admin override return recorded.${smsNote}`);
      }
      setConfirmOverride(false);
      onClose();
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to override return");
    } finally {
      setSubmitting(false);
    }
  }

  const isAdmin = role === "admin";

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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConfirmOverride(true)}
              disabled={submitting}
              className="w-full rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-4 text-left text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
            >
              <div className="flex items-center gap-2 text-base font-semibold">
                <ShieldAlert className="h-4 w-4" />
                ADMIN: Return Without Inspection
              </div>
              <div className="mt-1 text-sm opacity-90">
                Bypass the inspection workflow and close out this rental immediately.
              </div>
            </button>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
      <AlertDialog open={confirmOverride} onOpenChange={setConfirmOverride}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip inspection and return vehicle now?</AlertDialogTitle>
            <AlertDialogDescription>
              This admin override will close out the rental, mark the vehicle available,
              notify the renter by SMS, and log who performed the override. No inspection
              checklist will be recorded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); runOverride(); }}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting ? "Returning…" : "Yes, override return"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}