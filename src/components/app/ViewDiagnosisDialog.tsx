import type { MechanicJobRow } from "@/lib/mechanic-jobs.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const money = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return d; }
}

export function ViewDiagnosisDialog({ job, onClose }: { job: MechanicJobRow | null; onClose: () => void }) {
  if (!job) return null;
  const partsTotal = (job.parts_list ?? []).reduce((s, p) => s + (Number(p.price) || 0), 0);
  const total = partsTotal + (Number(job.labour_cost) || 0);
  return (
    <Dialog open={!!job} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mechanic Diagnosis</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
            <div><span className="font-medium">Mechanic:</span> {job.mechanic_name} — {job.mechanic_phone}{job.mechanic_shop ? ` (${job.mechanic_shop})` : ""}</div>
            <div><span className="font-medium">Submitted:</span> {fmt(job.submitted_at)}</div>
          </div>

          {(job.checklist_results ?? []).length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Checklist Results</h3>
              <div className="space-y-1.5">
                {(job.checklist_results ?? []).map((r, i) => (
                  <div key={i} className="rounded border px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs">{r.label}</span>
                      <Badge
                        variant={r.result === "fail" ? "destructive" : r.result === "pass" ? "default" : "secondary"}
                        className="text-[10px] capitalize"
                      >
                        {r.result === "na" ? "N/A" : r.result}
                      </Badge>
                    </div>
                    {r.notes ? <div className="mt-1 text-[11px] text-muted-foreground">{r.notes}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Parts</h3>
            <div className="space-y-1">
              {(job.parts_list ?? []).map((p, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{p.name}</span><span>{money(p.price)}</span>
                </div>
              ))}
              {(job.parts_list ?? []).length === 0 && <p className="text-xs text-muted-foreground">No parts listed.</p>}
            </div>
          </div>

          <div className="space-y-1 border-t pt-2 text-xs">
            <div className="flex justify-between"><span>Parts total</span><span>{money(partsTotal)}</span></div>
            <div className="flex justify-between"><span>Labour{job.estimated_hours ? ` (${job.estimated_hours} hrs)` : ""}</span><span>{money(job.labour_cost)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total estimate</span><span>{money(total)}</span></div>
          </div>

          {job.mechanic_notes ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Notes</h3>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{job.mechanic_notes}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}