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
import { Input } from "@/components/ui/input";
import { vehicleById, driverById, type Rental } from "@/lib/mock/data";
import { useAuth } from "@/hooks/use-auth";
import { adminOverrideReturn } from "@/lib/admin-override-return.functions";
import { createReturnInspection } from "@/lib/tasks.functions";
import { listRunners, saveRunner, type SavedRunner } from "@/lib/runners.functions";
import { refreshStoreFromCloud, syncLocalReturn } from "@/lib/mock/store";
import { toast } from "sonner";
import { ShieldAlert, ClipboardCheck } from "lucide-react";

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

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
  const listRunnersFn = useServerFn(listRunners);
  const saveRunnerFn = useServerFn(saveRunner);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runners, setRunners] = useState<SavedRunner[]>([]);
  const [runnerId, setRunnerId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listRunnersFn();
        if (!cancelled) setRunners(list);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [listRunnersFn]);

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
    const chosen = runners.find((r) => r.id === runnerId);
    if (!chosen) { toast.error("Select a runner"); return; }
    setSubmitting(true);
    try {
      const res = await sendInspectionFn({
        data: {
          rentalId: rental.id,
          runnerName: chosen.name,
          runnerPhone: chosen.phone,
          origin: window.location.origin,
          vehicleLabel: vLabel,
        },
      });
      const runnerName = chosen.name;
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

  async function saveNewRunner() {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name) { toast.error("Runner name is required"); return; }
    if (phone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid phone number"); return; }
    setSavingNew(true);
    try {
      const saved = await saveRunnerFn({ data: { name, phone } });
      setRunners((prev) => {
        const rest = prev.filter((r) => r.id !== saved.id);
        return [saved, ...rest].sort((a, b) => a.name.localeCompare(b.name));
      });
      setRunnerId(saved.id);
      setNewName("");
      setNewPhone("");
      setAdding(false);
      toast.success(`Saved runner ${saved.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save runner");
    } finally {
      setSavingNew(false);
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
                <option value="">
                  {runners.length === 0 ? "No saved runners — add one below" : "Select runner…"}
                </option>
                {runners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.phone ? ` — ${r.phone.slice(-4)}` : ""}
                  </option>
                ))}
              </select>
              {!adding ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-2 text-sm font-medium text-primary hover:underline"
                >
                  + Add new runner
                </button>
              ) : (
                <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="new-runner-name">Name</Label>
                      <Input
                        id="new-runner-name"
                        className="mt-1"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-runner-phone">Phone</Label>
                      <Input
                        id="new-runner-phone"
                        className="mt-1"
                        type="tel"
                        inputMode="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(formatPhone(e.target.value))}
                        placeholder="(267) 555-1234"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setAdding(false); setNewName(""); setNewPhone(""); }}
                      disabled={savingNew}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveNewRunner} disabled={savingNew}>
                      {savingNew ? "Saving…" : "Save runner"}
                    </Button>
                  </div>
                </div>
              )}
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