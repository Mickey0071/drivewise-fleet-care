import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Search, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listViolations, type ViolationRow } from "@/lib/violations.functions";
import { SubmitDisputeDialog } from "@/components/app/SubmitDisputeDialog";

export const Route = createFileRoute("/violations_/disputes")({
  head: () => ({ meta: [{ title: "Violation Disputes — Camauto Rentals" }] }),
  component: DisputesPage,
});

const fmtMoney = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtDateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "—");

type Filter = "all" | "awaiting" | "submitted" | "resolved";

const DISPUTE_STATUSES = ["affidavit_signed", "submitted_to_authority", "resolved"];

function DisputesPage() {
  const list = useServerFn(listViolations);
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["violations"],
    queryFn: () => list(),
  });

  const [filter, setFilter] = useState<Filter>("awaiting");
  const [search, setSearch] = useState("");
  const [submitFor, setSubmitFor] = useState<ViolationRow | null>(null);

  const disputes = useMemo(
    () => rows.filter((r) => DISPUTE_STATUSES.includes(r.status)),
    [rows],
  );

  const counts = useMemo(
    () => ({
      all: disputes.length,
      awaiting: disputes.filter((r) => r.status === "affidavit_signed").length,
      submitted: disputes.filter((r) => r.status === "submitted_to_authority").length,
      resolved: disputes.filter((r) => r.status === "resolved").length,
    }),
    [disputes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return disputes.filter((r) => {
      if (filter === "awaiting" && r.status !== "affidavit_signed") return false;
      if (filter === "submitted" && r.status !== "submitted_to_authority") return false;
      if (filter === "resolved" && r.status !== "resolved") return false;
      if (!q) return true;
      const hay = [r.id, r.license_plate, r.rental_id, r.driver_name, r.vehicle_label, r.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [disputes, filter, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["violations"] });

  return (
    <div>
      <PageHeader
        title="Violation Disputes"
        subtitle="Signed affidavits ready to submit to authority"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> All Violations
            </Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="awaiting">Awaiting Submission ({counts.awaiting})</TabsTrigger>
              <TabsTrigger value="submitted">Submitted ({counts.submitted})</TabsTrigger>
              <TabsTrigger value="resolved">Resolved ({counts.resolved})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by plate, customer, location…"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <FileSignature className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No disputes in this category.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Vehicle / Plate</th>
                    <th className="p-3">Violation Date</th>
                    <th className="p-3">Location</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Signed</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        {v.driver_name || "—"}
                        {v.rental_id && (
                          <div className="text-xs text-muted-foreground">{v.rental_id}</div>
                        )}
                      </td>
                      <td className="p-3">{v.vehicle_label || v.license_plate || "—"}</td>
                      <td className="p-3">{fmtDate(v.date_issued)}</td>
                      <td className="p-3 max-w-[200px] truncate">{v.description || "—"}</td>
                      <td className="p-3 text-right font-semibold">
                        {fmtMoney(Number(v.total_amount || v.amount))}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{fmtDateTime(v.signed_at)}</td>
                      <td className="p-3"><StatusBadge status={v.status} /></td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setSubmitFor(v)}>
                          {v.status === "affidavit_signed" ? "View & Submit" : "View Dispute"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SubmitDisputeDialog
        violation={submitFor}
        onClose={() => setSubmitFor(null)}
        onDone={refresh}
      />
    </div>
  );
}
