import { useMemo, useState } from "react";
import type { MechanicJobRow } from "@/lib/mechanic-jobs.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { vehicleById } from "@/lib/mock/data";

const money = (n: number) => `$${(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const partsTotal = (j: MechanicJobRow) => (j.parts_list ?? []).reduce((s, p) => s + (Number(p.price) || 0), 0);

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
function vehLabel(id: string | null) {
  if (!id) return "—";
  const v = vehicleById(id);
  return v ? `${v.year} ${v.make} ${v.model}` : id;
}

export function MechanicJobHistory({ jobs, onView }: { jobs: MechanicJobRow[]; onView: (j: MechanicJobRow) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, MechanicJobRow[]>();
    for (const j of jobs) {
      const key = `${j.mechanic_name}|${j.mechanic_phone}`;
      const arr = map.get(key) ?? [];
      arr.push(j);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, list]) => {
      const submitted = list.filter((j) => j.status === "submitted");
      const completed = submitted.length;
      const partsSum = submitted.reduce((s, j) => s + partsTotal(j), 0);
      const labourSum = submitted.reduce((s, j) => s + (Number(j.labour_cost) || 0), 0);
      const durations = submitted
        .filter((j) => j.submitted_at && j.sent_at)
        .map((j) => new Date(j.submitted_at!).getTime() - new Date(j.sent_at).getTime())
        .filter((ms) => ms > 0);
      const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const lastJob = list.map((j) => j.submitted_at ?? j.sent_at).sort().reverse()[0];
      return {
        key,
        name: list[0].mechanic_name,
        phone: list[0].mechanic_phone,
        completed,
        avgHours: avgMs ? avgMs / 3600000 : 0,
        partsSum,
        labourSum,
        lastJob,
        jobs: list.sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? "")),
      };
    }).sort((a, b) => (b.lastJob ?? "").localeCompare(a.lastJob ?? ""));
  }, [jobs]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4" /> Mechanic Job History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {groups.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No mechanic diagnosis jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Mechanic</TableHead>
                  <TableHead className="text-xs">Jobs</TableHead>
                  <TableHead className="text-xs">Avg time</TableHead>
                  <TableHead className="text-xs">Parts $</TableHead>
                  <TableHead className="text-xs">Labour $</TableHead>
                  <TableHead className="text-xs">Last job</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <>
                    <TableRow key={g.key} className="cursor-pointer" onClick={() => setExpanded((p) => (p === g.key ? null : g.key))}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-muted-foreground">{g.phone}</div>
                      </TableCell>
                      <TableCell className="text-xs">{g.completed}</TableCell>
                      <TableCell className="text-xs">{g.avgHours ? `${g.avgHours.toFixed(1)} hr` : "—"}</TableCell>
                      <TableCell className="text-xs">{money(g.partsSum)}</TableCell>
                      <TableCell className="text-xs">{money(g.labourSum)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(g.lastJob)}</TableCell>
                      <TableCell className="text-xs">
                        {expanded === g.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                    </TableRow>
                    {expanded === g.key && g.jobs.map((j) => (
                      <TableRow key={j.id} className="bg-muted/30">
                        <TableCell colSpan={7} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span className="text-muted-foreground">{fmtDate(j.submitted_at ?? j.sent_at)}</span>
                            <span>{vehLabel(j.vehicle_id)}</span>
                            <span className="text-muted-foreground">{j.issue_description ?? "—"}</span>
                            <span>Parts {money(partsTotal(j))}</span>
                            <span>Labour {money(Number(j.labour_cost) || 0)}</span>
                            <span className="font-medium">Total {money(partsTotal(j) + (Number(j.labour_cost) || 0))}</span>
                            <Badge
                              variant={j.status === "submitted" ? "default" : j.status === "cancelled" ? "destructive" : "secondary"}
                              className="text-[10px] capitalize"
                            >
                              {j.status}
                            </Badge>
                            {j.status === "submitted" && (
                              <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); onView(j); }}>
                                View
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}