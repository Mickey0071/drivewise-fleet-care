import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck, Check, X } from "lucide-react";
import { fmtDate } from "@/lib/mock/data";
import { listRmCards, type RmCardRow } from "@/lib/rm-cards.functions";

export function RmHistoryTab({ vehicleId }: { vehicleId: string }) {
  const loadFn = useServerFn(listRmCards);
  const [cards, setCards] = useState<RmCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<RmCardRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await loadFn();
        if (cancelled) return;
        setCards(((r.cards ?? []) as RmCardRow[]).filter(c => c.vehicle_id === vehicleId && c.status === "submitted"));
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId, loadFn]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-primary" /> RM History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : cards.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No routine maintenance cards yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Inspector</th>
                  <th className="px-4 py-2 text-right font-medium">Passed</th>
                  <th className="px-4 py-2 text-right font-medium">Failed</th>
                  <th className="px-4 py-2 text-right font-medium">Mileage</th>
                  <th className="px-4 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cards.map(c => {
                  const items = Array.isArray(c.items_checked) ? c.items_checked : [];
                  const passed = items.filter(i => i.status === "Pass").length;
                  const failed = items.filter(i => i.status === "Fail").length;
                  return (
                    <tr key={c.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2">{fmtDate((c.submitted_at ?? c.created_at)?.slice(0, 10))}</td>
                      <td className="px-4 py-2">
                        {c.inspector_name || "—"}
                        <Badge variant="secondary" className="ml-2 text-[10px] capitalize">{c.inspector_type}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right text-green-600">{passed}</td>
                      <td className={`px-4 py-2 text-right ${failed > 0 ? "text-destructive" : ""}`}>{failed}</td>
                      <td className="px-4 py-2 text-right">{c.mileage_at_inspection != null ? Number(c.mileage_at_inspection).toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setView(c)}>View</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!view} onOpenChange={(o) => { if (!o) setView(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>RM Card · {view ? fmtDate((view.submitted_at ?? view.created_at)?.slice(0, 10)) : ""}</DialogTitle>
          </DialogHeader>
          {view && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <div><span className="font-medium">Inspector:</span> {view.inspector_name || "—"} ({view.inspector_type})</div>
                {view.inspector_phone && <div><span className="font-medium">Phone:</span> {view.inspector_phone}</div>}
                <div><span className="font-medium">Mileage:</span> {view.mileage_at_inspection != null ? Number(view.mileage_at_inspection).toLocaleString() : "—"} mi</div>
              </div>
              <div className="space-y-2">
                {(Array.isArray(view.items_checked) ? view.items_checked : []).map((it, i) => (
                  <div key={i} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{it.label}</span>
                      {it.status === "Pass" ? (
                        <span className="flex items-center gap-1 text-xs text-green-600"><Check className="h-3.5 w-3.5" /> Pass</span>
                      ) : it.status === "Fail" ? (
                        <span className="flex items-center gap-1 text-xs text-destructive"><X className="h-3.5 w-3.5" /> Fail</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    {it.notes && <div className="mt-1 text-xs text-muted-foreground">{it.notes}</div>}
                  </div>
                ))}
              </div>
              {view.overall_notes && (
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <span className="font-medium">Notes:</span> {view.overall_notes}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
