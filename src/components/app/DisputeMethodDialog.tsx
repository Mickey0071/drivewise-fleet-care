import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { bulkRecordDispute } from "@/lib/violations-workflow.functions";

export type DisputeMethod = "mail" | "walk_in" | "online" | "phone";

export interface DisputeGroups {
  /** EZPass / DRPA / anything that is not Philadelphia. */
  ezpass: string[];
  /** Philadelphia (PPA) — mail only. */
  philly: string[];
}

const METHODS: Array<{
  key: DisputeMethod;
  icon: string;
  label: string;
  desc: string;
}> = [
  { key: "mail", icon: "✉️", label: "Mail", desc: "Send physical packet to violation authority. Recommended for all Philadelphia violations." },
  { key: "walk_in", icon: "🚶", label: "Walk-in", desc: "Submit in person at authority office. Best for NJ EZPass — Camden office." },
  { key: "online", icon: "🌐", label: "Online", desc: "Submit via authority website. Not available for Philadelphia violations." },
  { key: "phone", icon: "📞", label: "Phone", desc: "Call authority to dispute. NJ EZPass: 1-888-288-6865." },
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function MethodCard({
  m,
  selected,
  disabled,
  onPick,
}: {
  m: (typeof METHODS)[number];
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "rounded-lg border p-3 text-left transition",
        selected ? "border-emerald-600 bg-emerald-600/10" : "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <div className="text-sm font-semibold">
        {m.icon} {m.label}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{m.desc}</div>
    </button>
  );
}

/**
 * Post-download dialog: ask how the packet is being submitted, then record the
 * method/date/notes and move everything to the Disputed tab.
 */
export function DisputeMethodDialog({
  groups,
  onClose,
  onDone,
}: {
  groups: DisputeGroups | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const record = useServerFn(bulkRecordDispute);
  const [ezMethod, setEzMethod] = useState<DisputeMethod | null>(null);
  const [phMethod, setPhMethod] = useState<DisputeMethod | null>(null);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const ez = groups?.ezpass ?? [];
  const ph = groups?.philly ?? [];
  const mixed = ez.length > 0 && ph.length > 0;
  const total = ez.length + ph.length;

  useEffect(() => {
    if (groups) {
      setEzMethod(null);
      setPhMethod(ph.length > 0 ? "mail" : null);
      setDate(todayISO());
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const ready = (ez.length === 0 || !!ezMethod) && (ph.length === 0 || !!phMethod);

  const label = (m: DisputeMethod | null) =>
    m ? METHODS.find((x) => x.key === m)!.label : "";

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (ez.length > 0 && ezMethod) {
        await record({ data: { violationIds: ez, method: ezMethod, disputedDate: date, notes } });
      }
      if (ph.length > 0 && phMethod) {
        await record({ data: { violationIds: ph, method: phMethod, disputedDate: date, notes } });
      }
      toast.success(`✅ ${total} violation${total === 1 ? "" : "s"} moved to Disputed`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record dispute");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!groups} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How are you submitting these violations?</DialogTitle>
          <DialogDescription>
            {total} violation{total === 1 ? "" : "s"} were included in the downloaded packet.
          </DialogDescription>
        </DialogHeader>

        {ez.length > 0 && (
          <div className="space-y-2">
            {mixed && (
              <p className="text-sm font-medium">EZPass/DRPA violations ({ez.length}):</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => (
                <MethodCard
                  key={m.key}
                  m={m}
                  selected={ezMethod === m.key}
                  onPick={() => setEzMethod(m.key)}
                />
              ))}
            </div>
          </div>
        )}

        {ph.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Philadelphia violations ({ph.length}):</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => (
                <MethodCard
                  key={m.key}
                  m={m}
                  selected={m.key === "mail" && phMethod === "mail"}
                  disabled={m.key !== "mail"}
                  onPick={() => setPhMethod("mail")}
                />
              ))}
            </div>
            <p className="text-xs text-amber-600">
              Philadelphia violations can only be mailed.
            </p>
          </div>
        )}

        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {ready
              ? mixed
                ? `Mark ${ez.length} EZPass/DRPA via ${label(ezMethod)} and ${ph.length} Philadelphia via Mail?`
                : `Mark ${total} violation${total === 1 ? "" : "s"} as disputed via ${label(ez.length > 0 ? ezMethod : phMethod)}?`
              : "Pick a submission method above."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Certified mail tracking # 1234567890"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Not yet
          </Button>
          <Button
            onClick={confirm}
            disabled={!ready || busy}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? "Saving…" : "Confirm + Move to Disputed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
