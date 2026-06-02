import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { vehicleById, driverById, type Rental } from "@/lib/mock/data";
import { useAuth } from "@/hooks/use-auth";
import { adminOverrideReturn } from "@/lib/admin-override-return.functions";
import { createReturnInspection } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { refreshStoreFromCloud, syncLocalReturn } from "@/lib/mock/store";
import { toast } from "sonner";
import { ShieldAlert, ClipboardCheck } from "lucide-react";

type Props = {
  rental: Rental | null;
  onClose: () => void;
};

export function ReturnVehicleDialog({ rental, onClose }: Props) {
  const navigate = useNavigate();
  const router = useRouter();
  const { role } = useAuth();
  const overrideFn = useServerFn(adminOverrideReturn);
  const sendInspectionFn = useServerFn(createReturnInspection);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runners, setRunners] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [runnerId, setRunnerId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "runner");
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, phone")
        .in("id", ids);
      if (cancelled) return;
      setRunners(
        (profs ?? []).map((p: any) => ({
          id: p.id,
          name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Runner",
          phone: p.phone,
        })),
      );
    })();
    return () => { cancelled = true; };
  }, []);

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

  async function sendForInspection() {
    if (!rental) return;
    if (!runnerId) { toast.error("Select a runner"); return; }
    setSubmitting(true);
    try {
      const res = await sendInspectionFn({
        data: {
          rentalId: rental.id,
          runnerId,
          origin: window.location.origin,
          vehicleLabel: vLabel,
        },
      });
      const runnerName = runners.find((r) => r.id === runnerId)?.name || "runner";
      toast.success(
        res.smsStatus === "sent"
          ? `Returned. Inspection sent to ${runnerName} by SMS.`
          : `Returned. Inspection assigned to ${runnerName} (no phone — SMS skipped).`,
      );
      onClose();
      await refreshStoreFromCloud();
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send for inspection");
    } finally {
      setSubmitting(false);
    }
  }

  async function runOverride() {
    if (!rental) return;
    setSubmitting(true);
    try {
      const res = await overrideFn({ data: { rental_id: rental.id } });
      if (res.alreadyReturned) {
        toast.info("Rental was already returned.");
      } else {
        syncLocalReturn(rental.id);
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
      await refreshStoreFromCloud();
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
          <div className="rounded-lg border-2 border-border p-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <ClipboardCheck className="h-4 w-4" /> Send for inspection
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Mark returned and assign a runner to inspect. Vehicle stays in inspection until you approve it.
            </p>
            <div className="mt-3">
              <Label htmlFor="ret-runner">Runner</Label>
              <select
                id="ret-runner"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={runnerId}
                onChange={(e) => setRunnerId(e.target.value)}
              >
                <option value="">Select runner…</option>
                {runners.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.phone ? "" : " (no phone)"}</option>
                ))}
              </select>
            </div>
            <Button className="mt-3 w-full" disabled={submitting || !runnerId} onClick={sendForInspection}>
              {submitting ? "Sending…" : "Create Inspection & Return"}
            </Button>
          </div>
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