import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/mock/data";
import { approveRmCard, rejectRmCard, type RmCardRow, type RmItem } from "@/lib/rm-cards.functions";

export function RmPendingApprovals({
  cards,
  labelFor,
  onChanged,
}: {
  cards: RmCardRow[];
  labelFor: (vehicleId: string) => string;
  onChanged: () => void;
}) {
  const approveFn = useServerFn(approveRmCard);
  const rejectFn = useServerFn(rejectRmCard);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, RmItem[]>>({});

  function itemsFor(c: RmCardRow): RmItem[] {
    if (overrides[c.id]) return overrides[c.id];
    return Array.isArray(c.items_checked) ? c.items_checked : [];
  }
  function setStatus(c: RmCardRow, idx: number, status: "Pass" | "Fail") {
    const base = itemsFor(c).map((it, i) => (i === idx ? { ...it, status } : it));
    setOverrides((p) => ({ ...p, [c.id]: base }));
  }

  async function approve(c: RmCardRow) {
    const items = itemsFor(c);
    if (items.some((i) => i.status !== "Pass" && i.status !== "Fail")) {
      toast.error("Set Pass or Fail for every item");
      return;
    }
    setBusyId(c.id);
    try {
      const res = await approveFn({ data: { id: c.id, items } });
      toast.success(`✓ Applied · ${res.passed.length} passed, ${res.failed.length} failed`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve");
    } finally {
      setBusyId(null);
    }
  }
  async function reject(c: RmCardRow) {
    setBusyId(c.id);
    try {
      await rejectFn({ data: { id: c.id } });
      toast.success("RM Card rejected");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject");
    } finally {
      setBusyId(null);
    }
  }

  if (cards.length === 0) return null;

  return (
    <Card className="mt-4 border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-amber-500" />
          RM Cards Awaiting Approval ({cards.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {cards.map((c) => {
            const items = itemsFor(c);
            const passed = items.filter((i) => i.status === "Pass").length;
            const failed = items.filter((i) => i.status === "Fail").length;
            const open = openId === c.id;
            const busy = busyId === c.id;
            return (
              <li key={c.id} className="px-4 py-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setOpenId(open ? null : c.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{labelFor(c.vehicle_id)}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate((c.submitted_at ?? c.created_at)?.slice(0, 10))} · {c.inspector_name || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="rounded-full bg-green-500/15 px-2 py-0.5 font-medium text-green-600">{passed} pass</span>
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", failed > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{failed} fail</span>
                  </div>
                </button>

                {open && (
                  <div className="mt-3 space-y-2">
                    {items.map((it, idx) => (
                      <div key={`${it.type}-${it.customId ?? idx}`} className="rounded-md border border-border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm">{it.label}</div>
                            {it.due && <div className="text-xs text-muted-foreground">{it.due}</div>}
                            {it.notes && <div className="text-xs italic text-muted-foreground">“{it.notes}”</div>}
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant={it.status === "Pass" ? "default" : "outline"}
                              className={cn("h-7 px-2", it.status === "Pass" && "bg-green-600 hover:bg-green-600/90")}
                              onClick={() => setStatus(c, idx, "Pass")}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={it.status === "Fail" ? "destructive" : "outline"}
                              className="h-7 px-2"
                              onClick={() => setStatus(c, idx, "Fail")}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {c.overall_notes && (
                      <p className="text-xs text-muted-foreground">Notes: {c.overall_notes}</p>
                    )}
                    {overrides[c.id] && <Badge variant="secondary" className="text-[10px]">Overridden</Badge>}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="flex-1" disabled={busy} onClick={() => approve(c)}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve & Apply"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => reject(c)}>
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}