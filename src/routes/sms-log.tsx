import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw } from "lucide-react";
import { getShareLinkSmsLog } from "@/lib/share-rental.functions";

export const Route = createFileRoute("/sms-log")({
  head: () => ({ meta: [{ title: "Share link SMS log — Camauto Rentals" }] }),
  component: SmsLogPage,
});

type Filter = "all" | "sent" | "failed";

function SmsLogPage() {
  const fetchLog = useServerFn(getShareLinkSmsLog);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["share-link-sms-log"],
    queryFn: () => fetchLog(),
  });
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === "all") return all;
    return all.filter((r) => r.status === filter);
  }, [data, filter]);

  const sentCount = (data ?? []).filter((r) => r.status === "sent").length;
  const failedCount = (data ?? []).filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Share link SMS log"
        subtitle="Every text message sent (or attempted) for a rental share link."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          All ({(data ?? []).length})
        </Button>
        <Button size="sm" variant={filter === "sent" ? "default" : "outline"} onClick={() => setFilter("sent")}>
          Sent ({sentCount})
        </Button>
        <Button size="sm" variant={filter === "failed" ? "default" : "outline"} onClick={() => setFilter("failed")}>
          Failed ({failedCount})
        </Button>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">Refresh</span>
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> <span className="ml-2">Loading…</span>
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not load log"}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No SMS attempts yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Token</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TooltipProvider>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "sent" ? "default" : "destructive"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                    <TableCell className="text-sm">{r.recipientName ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.vehicleId ?? "—"}</TableCell>
                    <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                      {r.errorMessage ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate cursor-help">{r.errorMessage}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md whitespace-pre-wrap break-words">
                            {r.errorMessage}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      …{r.token.slice(-6)}
                    </TableCell>
                  </TableRow>
                ))}
              </TooltipProvider>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}