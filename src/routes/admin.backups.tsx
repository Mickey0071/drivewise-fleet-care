import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileSpreadsheet, FileArchive, FileText, Download, Loader2, RefreshCw, CheckCircle2, AlertTriangle, DatabaseBackup } from "lucide-react";
import { listBackups, generateBackupNow } from "@/lib/backups.functions";

export const Route = createFileRoute("/admin/backups")({
  head: () => ({ meta: [{ title: "Monthly Backups — Camauto Rentals" }] }),
  component: BackupsPage,
});

type BackupFile = { name: string; url: string; category: string; format: string };
type BackupStats = {
  totalRentals: number; totalRevenue: number; totalRepairs: number; totalRepairCost: number;
  newCustomers: number; totalCustomers: number; totalVehicles: number; totalViolations: number; netProfit: number;
};
type BackupRow = {
  id: string; period_month: string; generated_at: string; email_sent_at: string | null;
  email_status: string; email_attempts: number; file_urls: BackupFile[]; stats: BackupStats;
  triggered_by: string; error_message: string | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function money(n: number): string {
  return `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

function BackupsPage() {
  const fetchBackups = useServerFn(listBackups);
  const generate = useServerFn(generateBackupNow);
  const qc = useQueryClient();
  const [year, setYear] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: () => fetchBackups(),
  });

  const backups = (data?.backups ?? []) as unknown as BackupRow[];

  const years = useMemo(() => {
    const set = new Set(backups.map((b) => b.period_month.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [backups]);

  const filtered = year === "all" ? backups : backups.filter((b) => b.period_month.startsWith(year));

  const genMutation = useMutation({
    mutationFn: () => generate({ data: {} }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(
          res.emailStatus === "sent"
            ? `Backup generated and emailed (${monthLabel(res.period)})`
            : `Backup generated for ${monthLabel(res.period)} — email failed, files saved`,
        );
      } else {
        toast.error(`Backup failed: ${res?.error ?? "unknown error"}`);
      }
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Backup failed"),
  });

  const find = (b: BackupRow, fmt: string) => b.file_urls?.find((f) => f.format === fmt && f.category === "combined");
  const findBundle = (b: BackupRow, cat: string) => b.file_urls?.find((f) => f.category === cat);

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Backups" subtitle="Download monthly business data backups" />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-3">
            <DatabaseBackup className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Backups run automatically on the 1st of each month at 8:00 AM and are emailed to rentalprise@yahoo.com.
            </div>
          </div>
          <Button onClick={() => genMutation.mutate()} disabled={genMutation.isPending}>
            {genMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Generate Backup Now
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Year</span>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading backups…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No backups yet. Click “Generate Backup Now” to create one.</CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map((b) => {
            const excel = find(b, "xlsx");
            const csvZip = findBundle(b, "csv-bundle");
            const pdfZip = findBundle(b, "pdf-bundle");
            const s = b.stats ?? ({} as BackupStats);
            return (
              <Card key={b.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-lg">{monthLabel(b.period_month)}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{b.triggered_by === "cron" ? "Scheduled" : "Manual"}</Badge>
                      {b.email_status === "sent" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Email sent</Badge>
                      ) : (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-500"><AlertTriangle className="mr-1 h-3 w-3" /> Email {b.email_status}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Generated {new Date(b.generated_at).toLocaleString()}
                    {b.email_sent_at ? ` · Emailed ${new Date(b.email_sent_at).toLocaleString()}` : ""}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                    <Stat label="Rentals" value={String(s.totalRentals ?? 0)} />
                    <Stat label="Revenue" value={money(s.totalRevenue ?? 0)} />
                    <Stat label="Repairs" value={`${s.totalRepairs ?? 0} (${money(s.totalRepairCost ?? 0)})`} />
                    <Stat label="New customers" value={String(s.newCustomers ?? 0)} />
                    <Stat label="Net profit" value={money(s.netProfit ?? 0)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DownloadBtn url={excel?.url} icon={<FileSpreadsheet className="mr-2 h-4 w-4" />} label="Excel" />
                    <DownloadBtn url={csvZip?.url} icon={<FileArchive className="mr-2 h-4 w-4" />} label="All CSVs (Zip)" />
                    <DownloadBtn url={pdfZip?.url} icon={<FileText className="mr-2 h-4 w-4" />} label="PDF Reports (Zip)" />
                    {b.file_urls?.length ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" /> Individual files</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
                          {b.file_urls.map((f) => (
                            <DropdownMenuItem key={f.name} asChild>
                              <a href={f.url} target="_blank" rel="noreferrer" download>{f.name}</a>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  {b.error_message ? <div className="text-xs text-destructive">Error: {b.error_message}</div> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function DownloadBtn({ url, icon, label }: { url?: string; icon: React.ReactNode; label: string }) {
  if (!url) return <Button variant="outline" size="sm" disabled>{icon}{label}</Button>;
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer" download>{icon}{label}</a>
    </Button>
  );
}