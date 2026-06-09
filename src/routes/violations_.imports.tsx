import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Upload } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listImportLogs } from "@/lib/data-exports.functions";

export const Route = createFileRoute("/violations_/imports")({
  head: () => ({ meta: [{ title: "Import History — Camauto Rentals" }] }),
  component: ImportsPage,
});

function ImportsPage() {
  const fetchLogs = useServerFn(listImportLogs);
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["import-logs"],
    queryFn: () => fetchLogs(),
  });

  return (
    <div>
      <PageHeader
        title="Import History"
        subtitle="Every CSV import logged with results"
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/violations_/import">
                <Upload className="mr-1 h-4 w-4" /> New Import
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/violations">
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No imports yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left uppercase text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">File</th>
                    <th className="p-3">Rows</th>
                    <th className="p-3">Renters</th>
                    <th className="p-3">Rentals</th>
                    <th className="p-3">Skipped</th>
                    <th className="p-3">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="p-3 whitespace-nowrap">
                        {new Date(l.created_at).toLocaleString()}
                      </td>
                      <td className="p-3">{l.file_name || "—"}</td>
                      <td className="p-3">{l.rows_total}</td>
                      <td className="p-3">
                        {l.drivers_created} new / {l.drivers_matched} matched
                      </td>
                      <td className="p-3">{l.rentals_created}</td>
                      <td className="p-3">{l.rentals_skipped}</td>
                      <td className="p-3">
                        {l.error_count > 0 ? (
                          <span className="text-red-600">{l.error_count}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}