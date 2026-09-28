import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { vehicles, fmtDate } from "@/lib/mock/data";
import { updateVehicle, useStoreVersion } from "@/lib/mock/store";
import {
  loadAllPaperworkTasks, setPaperworkTaskStatus, TASK_TYPE_LABEL, ISSUE_LABEL, type PaperworkTaskRow,
} from "@/lib/vehicle-paperwork";

export const Route = createFileRoute("/admin/paperwork-tasks")({
  head: () => ({
    meta: [
      { title: "Paperwork Tasks — Camauto Rentals" },
      { name: "description", content: "DMV, title transfer, and tag order tasks for fleet vehicles." },
      { property: "og:title", content: "Paperwork Tasks — Camauto Rentals" },
      { property: "og:description", content: "DMV, title transfer, and tag order tasks for fleet vehicles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaperworkTasksPage,
});

const FLAG = { title: "titleMissing", registration: "registrationMissing", tags: "tagsMissing" } as const;

function PaperworkTasksPage() {
  useStoreVersion();
  const [rows, setRows] = useState<PaperworkTaskRow[]>([]);
  const [show, setShow] = useState<"open" | "all">("open");
  const reload = useCallback(() => { loadAllPaperworkTasks().then(setRows).catch((e) => toast.error(e.message)); }, []);
  useEffect(reload, [reload]);

  async function toggle(t: PaperworkTaskRow) {
    const next = t.status === "open" ? "done" : "open";
    try {
      await setPaperworkTaskStatus(t.id, next);
      if (next === "done" && !rows.some((x) => x.id !== t.id && x.vehicle_id === t.vehicle_id && x.issue === t.issue && x.status === "open")) {
        const v = vehicles.find((x) => x.id === t.vehicle_id);
        if (v?.[FLAG[t.issue]]) await updateVehicle(v.id, { [FLAG[t.issue]]: false } as never);
      }
      reload();
    } catch (e: any) { toast.error(e?.message ?? "Could not update"); }
  }

  const list = rows.filter((r) => show === "all" || r.status === "open");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader title="Paperwork Tasks" description="DMV runs, title transfers, and tag orders from vehicle onboarding." />
      <div className="flex gap-2">
        <Button size="sm" variant={show === "open" ? "default" : "outline"} onClick={() => setShow("open")}>Open</Button>
        <Button size="sm" variant={show === "all" ? "default" : "outline"} onClick={() => setShow("all")}>All</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Done</TableHead><TableHead>Vehicle</TableHead><TableHead>Task</TableHead>
            <TableHead>Issue</TableHead><TableHead>Assignee</TableHead><TableHead>Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No paperwork tasks</TableCell></TableRow>}
          {list.map((t) => {
            const v = vehicles.find((x) => x.id === t.vehicle_id);
            const late = t.status === "open" && t.due_date && t.due_date < today;
            return (
              <TableRow key={t.id}>
                <TableCell><input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} /></TableCell>
                <TableCell>
                  <Link to="/fleet/$vehicleId" params={{ vehicleId: t.vehicle_id }} className="underline">
                    {v ? `${v.make} ${v.model} · ${v.plate}` : t.vehicle_id}
                  </Link>
                </TableCell>
                <TableCell>{TASK_TYPE_LABEL[t.task_type]}</TableCell>
                <TableCell>{ISSUE_LABEL[t.issue]}</TableCell>
                <TableCell>{t.assignee}</TableCell>
                <TableCell>{t.due_date ? fmtDate(t.due_date) : "—"} {late && <Badge variant="destructive">Late</Badge>}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
