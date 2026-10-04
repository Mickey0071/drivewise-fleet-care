import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelCampaign, getCampaignRecipients, listCampaigns } from "@/lib/marketing.functions";

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "—");

export function MarketingCampaigns() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCampaigns);
  const recFn = useServerFn(getCampaignRecipients);
  const cancelFn = useServerFn(cancelCampaign);
  const q = useQuery({ queryKey: ["marketing-campaigns"], queryFn: () => listFn(), refetchInterval: 15000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const recQ = useQuery({ queryKey: ["marketing-recipients", openId], queryFn: () => recFn({ data: { id: openId! } }), enabled: !!openId });

  if (q.isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  const rows = q.data ?? [];
  const open = rows.find((r) => r.id === openId);

  return (
    <Card>
      <CardContent className="overflow-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">Replies</TableHead>
              <TableHead className="text-right">Opt-outs</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">No campaigns yet.</TableCell></TableRow>}
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                <TableCell className="text-xs">{fmt(c.scheduled_at && c.status === "scheduled" ? c.scheduled_at : c.started_at ?? c.created_at)}</TableCell>
                <TableCell>{c.channel === "sms" ? "Text" : "Email"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{c.audience_label}</TableCell>
                <TableCell>
                  <Badge variant={c.status === "completed" ? "default" : c.status === "cancelled" ? "outline" : "secondary"}>{c.status}</Badge>
                  {c.stats.pending > 0 && c.status === "sending" && <span className="ml-1 text-xs text-muted-foreground">{c.stats.pending} left</span>}
                </TableCell>
                <TableCell className="text-right">{c.stats.sent + c.stats.failed}</TableCell>
                <TableCell className="text-right">{c.stats.sent}</TableCell>
                <TableCell className="text-right">{c.stats.failed}</TableCell>
                <TableCell className="text-right">{c.stats.clicks}</TableCell>
                <TableCell className="text-right">{c.stats.replies}</TableCell>
                <TableCell className="text-right">{c.stats.optOuts}</TableCell>
                <TableCell>
                  {(c.status === "scheduled" || c.status === "sending") && (
                    <Button
                      size="sm" variant="outline"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm("Stop this campaign? Texts already sent can't be recalled.")) return;
                        await cancelFn({ data: { id: c.id } });
                        toast.success("Campaign stopped");
                        qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
                      }}
                    >
                      Stop
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{open?.audience_label} — {fmt(open?.started_at ?? open?.created_at)}</DialogTitle></DialogHeader>
          {open && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{open.body}</p>}
          <div className="max-h-[60vh] overflow-auto">
            {recQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Consent</TableHead><TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead><TableHead>Clicked</TableHead><TableHead>Replied</TableHead><TableHead>Opted out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recQ.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs">{r.phone}</TableCell>
                      <TableCell className="text-xs">{r.consent_status}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge>
                        {r.error && <div className="mt-1 max-w-[220px] truncate text-[10px] text-destructive" title={r.error}>{r.error}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{fmt(r.sent_at)}</TableCell>
                      <TableCell className="text-xs">{fmt(r.clicked_at)}</TableCell>
                      <TableCell className="text-xs">{fmt(r.replied_at)}</TableCell>
                      <TableCell className="text-xs">{fmt(r.opted_out_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
