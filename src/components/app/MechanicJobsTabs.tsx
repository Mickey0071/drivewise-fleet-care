import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, Loader2, RotateCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cancelMechanicJob,
  listMechanicJobs,
  resendMechanicJob,
  type MechanicJobRow,
} from "@/lib/mechanic-jobs.functions";
import type { SavedMechanic } from "@/lib/mechanics.functions";
import { ViewDiagnosisDialog } from "@/components/app/ViewDiagnosisDialog";
import { vehicleById } from "@/lib/mock/data";

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return d;
  }
}

function vehInfo(id: string | null) {
  if (!id) return { label: "—", plate: "" };
  const v = vehicleById(id);
  return v ? { label: `${v.year} ${v.make} ${v.model}`, plate: (v as any).plate ?? "" } : { label: id, plate: "" };
}

function hoursTaken(j: MechanicJobRow) {
  if (!j.submitted_at || !j.sent_at) return null;
  const ms = new Date(j.submitted_at).getTime() - new Date(j.sent_at).getTime();
  return ms > 0 ? ms / 3600000 : null;
}

type Filter = "open" | "completed" | "all";

export function MechanicJobsTabs({ mechanics, manage }: { mechanics: SavedMechanic[]; manage: React.ReactNode }) {
  const listFn = useServerFn(listMechanicJobs);
  const resendFn = useServerFn(resendMechanicJob);
  const cancelFn = useServerFn(cancelMechanicJob);
  const [jobs, setJobs] = useState<MechanicJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("open");
  const [viewing, setViewing] = useState<MechanicJobRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listFn();
      setJobs((res.jobs ?? []) as unknown as MechanicJobRow[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byMechanic = useMemo(() => {
    const phones = new Map(mechanics.map((m) => [digits(m.phone), m.id]));
    const map = new Map<string, MechanicJobRow[]>();
    for (const j of jobs) {
      const key = phones.get(digits(j.mechanic_phone)) ?? "__other";
      map.set(key, [...(map.get(key) ?? []), j]);
    }
    return map;
  }, [jobs, mechanics]);

  const other = byMechanic.get("__other") ?? [];

  async function resend(j: MechanicJobRow) {
    setBusyId(j.id);
    try {
      const v = vehInfo(j.vehicle_id);
      await resendFn({ data: { id: j.id, vehicleLabel: v.label, plate: v.plate } });
      toast.success("Reminder sent");
    } catch (e: any) {
      toast.error(e?.message || "Failed to resend");
    } finally {
      setBusyId(null);
    }
  }
  async function cancel(j: MechanicJobRow) {
    if (!confirm("Cancel this job? The mechanic's link will stop working.")) return;
    setBusyId(j.id);
    try {
      await cancelFn({ data: { id: j.id } });
      toast.success("Job cancelled");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel");
    } finally {
      setBusyId(null);
    }
  }

  function JobList({ list }: { list: MechanicJobRow[] }) {
    const open = list.filter((j) => j.status === "sent").length;
    const done = list.filter((j) => j.status === "submitted");
    const hrs = done.map(hoursTaken).filter((h): h is number => h !== null);
    const avg = hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
    const shown = list
      .filter((j) => (filter === "open" ? j.status === "sent" : filter === "completed" ? j.status === "submitted" : true))
      .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""));

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Open" value={String(open)} />
          <Stat label="Completed" value={String(done.length)} />
          <Stat label="Avg time" value={avg ? `${avg.toFixed(1)} hr` : "—"} />
        </div>
        <div className="flex gap-1">
          {(["open", "completed", "all"] as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className="capitalize">
              {f}
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No jobs here.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {shown.map((j) => {
              const v = vehInfo(j.vehicle_id);
              const h = hoursTaken(j);
              return (
                <li key={j.id} className="flex flex-wrap items-start gap-3 p-3">
                  <div className="pt-0.5">
                    {j.status === "submitted" ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : j.status === "cancelled" ? (
                      <XCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">
                      {v.label}
                      {v.plate ? <span className="text-muted-foreground"> · {v.plate}</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{j.issue_description || "—"}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>Sent {fmt(j.sent_at)}</span>
                      {j.status === "submitted" && <span>Completed {fmt(j.submitted_at)}</span>}
                      {h !== null && <span>Took {h.toFixed(1)} hr</span>}
                      {filterAllName(j)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={j.status === "submitted" ? "default" : j.status === "cancelled" ? "destructive" : "secondary"}>
                      {j.status === "sent" ? "Waiting" : j.status === "submitted" ? "Completed" : "Cancelled"}
                    </Badge>
                    {j.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => resend(j)}>
                          <RotateCw className="h-3.5 w-3.5" /> Resend
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId === j.id} onClick={() => cancel(j)}>
                          Cancel
                        </Button>
                      </>
                    )}
                    {j.status === "submitted" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setViewing(j)}>View diagnosis</Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/repairs" search={{ vehicleId: j.vehicle_id ?? undefined }}>Open in Repairs</Link>
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  let showNames = false;
  function filterAllName(j: MechanicJobRow) {
    return showNames ? <span>{j.mechanic_name}</span> : null;
  }

  const defaultTab = mechanics[0]?.id ?? "all";

  return (
    <>
      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          {mechanics.map((m) => {
            const open = (byMechanic.get(m.id) ?? []).filter((j) => j.status === "sent").length;
            return (
              <TabsTrigger key={m.id} value={m.id}>
                {m.name}
                {open > 0 && <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{open}</Badge>}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="all">All</TabsTrigger>
          {other.length > 0 && <TabsTrigger value="__other">Other</TabsTrigger>}
          <TabsTrigger value="manage">Manage mechanics</TabsTrigger>
        </TabsList>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
          </div>
        ) : (
          <>
            {mechanics.map((m) => (
              <TabsContent key={m.id} value={m.id}>
                <Card><CardContent className="pt-4"><JobList list={byMechanic.get(m.id) ?? []} /></CardContent></Card>
              </TabsContent>
            ))}
            <TabsContent value="all">
              {(() => { showNames = true; return null; })()}
              <Card><CardContent className="pt-4"><JobList list={jobs} /></CardContent></Card>
            </TabsContent>
            <TabsContent value="__other">
              <Card><CardContent className="pt-4"><JobList list={other} /></CardContent></Card>
            </TabsContent>
          </>
        )}
        <TabsContent value="manage" className="space-y-6">{manage}</TabsContent>
      </Tabs>
      <ViewDiagnosisDialog job={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
