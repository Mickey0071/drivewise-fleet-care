import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bold, Italic, List, Loader2, Mail, MessageSquare, Send, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createCampaign, kickCampaign, listSegments, listTemplates, previewCampaign, saveTemplate, sendTestText,
} from "@/lib/marketing.functions";
import {
  hasPhone, isExcluded, MERGE_FIELDS, mergeVars, renderTemplate, smsStats, withStopFooter, type AudienceCustomer,
} from "@/lib/marketing-shared";
import type { AudienceSelection } from "./MarketingAudience";

type Target = "audience" | "segment" | "all" | "one";

export function MarketingCompose({
  customers, selection, onGoToAudience, onSent,
}: {
  customers: AudienceCustomer[];
  selection: AudienceSelection | null;
  onGoToAudience: () => void;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const segFn = useServerFn(listSegments);
  const tplFn = useServerFn(listTemplates);
  const saveTplFn = useServerFn(saveTemplate);
  const testFn = useServerFn(sendTestText);
  const previewFn = useServerFn(previewCampaign);
  const createFn = useServerFn(createCampaign);
  const kickFn = useServerFn(kickCampaign);
  const segQ = useQuery({ queryKey: ["marketing-segments"], queryFn: () => segFn() });
  const tplQ = useQuery({ queryKey: ["marketing-templates"], queryFn: () => tplFn() });

  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [target, setTarget] = useState<Target>(selection ? "audience" : "all");
  const [segmentId, setSegmentId] = useState<string>("");
  const [oneSearch, setOneSearch] = useState("");
  const [oneId, setOneId] = useState<string>("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [testPhone, setTestPhone] = useState("267-221-3977");
  const [schedule, setSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [previewId, setPreviewId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { total: number; unknownConsent: number; skippedOptedOut: number; skippedNoPhone: number }>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const targetIds: string[] = useMemo(() => {
    if (target === "all") return customers.filter(hasPhone).map((c) => c.id);
    if (target === "audience") return selection?.customerIds ?? [];
    if (target === "segment") {
      const s = (segQ.data ?? []).find((x) => x.id === segmentId);
      return Array.isArray(s?.customer_ids) ? (s!.customer_ids as string[]) : [];
    }
    return oneId ? [oneId] : [];
  }, [target, customers, selection, segQ.data, segmentId, oneId]);

  const targetLabel =
    target === "all" ? "All customers"
      : target === "audience" ? selection?.label ?? "Custom group"
        : target === "segment" ? (segQ.data ?? []).find((x) => x.id === segmentId)?.name ?? "Saved audience"
          : byId.get(oneId)?.name ?? "One customer";

  const targetCustomers = targetIds.map((id) => byId.get(id)).filter(Boolean) as AudienceCustomer[];
  const sendableCount = targetCustomers.filter((c) => hasPhone(c) && !isExcluded(c)).length;
  const previewCustomer = byId.get(previewId) ?? targetCustomers[0] ?? customers[0];

  const rendered = previewCustomer
    ? withStopFooter(renderTemplate(body, mergeVars(previewCustomer, "https://camautorentals.lovable.app/api/public/r/…")))
    : withStopFooter(body);
  const stats = smsStats(rendered);

  const oneResults = useMemo(() => {
    const q = oneSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~")).slice(0, 8);
  }, [oneSearch, customers]);

  function insertField(f: string) {
    const el = textRef.current;
    const token = `{{${f}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }

  async function onTest() {
    if (!body.trim()) return toast.error("Write a message first");
    setBusy(true);
    try {
      await testFn({ data: { phone: testPhone, body, sampleCustomerId: previewCustomer?.id ?? null } });
      toast.success("Test text sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally { setBusy(false); }
  }

  async function onReview() {
    if (!body.trim()) return toast.error("Write a message first");
    if (targetIds.length === 0) return toast.error("Choose who to send to");
    if (schedule && !scheduleAt) return toast.error("Pick a date and time");
    setBusy(true);
    try {
      setConfirm(await previewFn({ data: { audienceLabel: targetLabel, customerIds: targetIds } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not prepare");
    } finally { setBusy(false); }
  }

  async function onConfirm() {
    setBusy(true);
    try {
      const res = await createFn({
        data: {
          channel: "sms", body, audienceLabel: targetLabel, customerIds: targetIds,
          scheduleAt: schedule && scheduleAt ? new Date(scheduleAt).toISOString() : null,
        },
      });
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
      if (res.status === "scheduled") {
        toast.success(`Scheduled for ${new Date(scheduleAt).toLocaleString()}`);
        onSent();
        return;
      }
      setProgress(`Sending to ${res.total}…`);
      const r = await kickFn({ data: { id: res.id } });
      toast.success(
        r.stillSending
          ? `Started: ${r.sent} sent so far. The rest go out slowly in the background.`
          : `Done: ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}.`,
      );
      qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally { setBusy(false); setProgress(null); }
  }

  async function onSaveTemplate() {
    const name = window.prompt("Template name?");
    if (!name) return;
    try {
      await saveTplFn({ data: { name, category: "Other", channel, subject: channel === "email" ? subject : null, body: channel === "email" ? emailRef.current?.innerHTML ?? "" : body } });
      toast.success("Template saved");
      qc.invalidateQueries({ queryKey: ["marketing-templates"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }

  const templates = (tplQ.data ?? []).filter((t) => t.channel === channel);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <Button variant={channel === "sms" ? "default" : "outline"} onClick={() => setChannel("sms")}><MessageSquare className="mr-2 h-4 w-4" />Text</Button>
            <Button variant={channel === "email" ? "default" : "outline"} onClick={() => setChannel("email")}><Mail className="mr-2 h-4 w-4" />Email</Button>
            <div className="ml-auto w-56">
              <Select
                value=""
                onValueChange={(id) => {
                  const t = templates.find((x) => x.id === id);
                  if (!t) return;
                  if (channel === "email") { setSubject(t.subject ?? ""); if (emailRef.current) emailRef.current.innerHTML = t.body; }
                  else setBody(t.body);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Use a template…" /></SelectTrigger>
                <SelectContent>
                  {templates.length === 0 && <div className="p-2 text-xs text-muted-foreground">No {channel === "sms" ? "text" : "email"} templates</div>}
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.category} — {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Send to</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="audience">Group from the Audience tab</SelectItem>
                <SelectItem value="segment">Saved audience</SelectItem>
                <SelectItem value="all">All customers</SelectItem>
                <SelectItem value="one">One customer</SelectItem>
              </SelectContent>
            </Select>
            {target === "audience" && !selection && (
              <p className="text-muted-foreground">No group picked yet. <Button variant="link" className="h-auto p-0" onClick={onGoToAudience}>Build one in Audience</Button></p>
            )}
            {target === "segment" && (
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger><SelectValue placeholder="Choose a saved audience" /></SelectTrigger>
                <SelectContent>{(segQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {target === "one" && (
              <div className="space-y-1">
                <Input placeholder="Search name or phone" value={oneSearch} onChange={(e) => setOneSearch(e.target.value)} />
                {oneResults.map((c) => (
                  <button key={c.id} type="button" className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${oneId === c.id ? "bg-muted font-semibold" : ""}`} onClick={() => setOneId(c.id)}>
                    {c.name} · {c.phone || "no phone"}
                  </button>
                ))}
              </div>
            )}
            <p className="font-medium">{sendableCount} will receive it <span className="font-normal text-muted-foreground">({targetLabel})</span></p>
          </CardContent>
        </Card>

        {channel === "sms" ? (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Message</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {MERGE_FIELDS.map((f) => <Button key={f} size="sm" variant="outline" className="h-7 text-xs" onClick={() => insertField(f)}>{`{{${f}}}`}</Button>)}
              </div>
              <Textarea ref={textRef} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {{first_name}}, …" maxLength={1500} />
              <div className="flex flex-wrap justify-between text-xs text-muted-foreground">
                <span>"Reply STOP to opt out." is added to every text automatically.</span>
                <span>{stats.length} characters · {stats.segments} segment{stats.segments === 1 ? "" : "s"} ({stats.encoding})</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <label className="flex items-center gap-2 text-sm"><Switch checked={schedule} onCheckedChange={setSchedule} />Schedule for later</label>
                {schedule && <Input type="datetime-local" className="w-56" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Input className="w-40" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} aria-label="Test phone number" />
                <Button variant="outline" onClick={onTest} disabled={busy}>Send test to myself</Button>
                <Button variant="ghost" onClick={onSaveTemplate} disabled={!body.trim()}>Save as template</Button>
                <Button className="ml-auto" onClick={onReview} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {schedule ? "Review & schedule" : "Review & send"}
                </Button>
              </div>
              {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Email</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Email not connected yet. Add your Resend API key in settings to turn on email sending.
              </div>
              <div className="space-y-1"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" aria-label="Bold" onClick={() => document.execCommand("bold")}><Bold className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label="Italic" onClick={() => document.execCommand("italic")}><Italic className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label="Bullet list" onClick={() => document.execCommand("insertUnorderedList")}><List className="h-4 w-4" /></Button>
              </div>
              <div ref={emailRef} contentEditable suppressContentEditableWarning className="min-h-[180px] rounded-md border bg-background p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onSaveTemplate}>Save as template</Button>
                <Button className="ml-auto" disabled><Send className="mr-2 h-4 w-4" />Send email</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader className="pb-2"><CardTitle className="text-base">Preview</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={previewCustomer?.id ?? ""} onValueChange={setPreviewId}>
            <SelectTrigger><SelectValue placeholder="Preview as…" /></SelectTrigger>
            <SelectContent>
              {(targetCustomers.length ? targetCustomers : customers).slice(0, 50).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {channel === "sms" ? (
            <div className="rounded-2xl rounded-bl-sm bg-muted p-3 text-sm whitespace-pre-wrap">{body.trim() ? rendered : <span className="text-muted-foreground">Your message preview</span>}</div>
          ) : (
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-2 font-semibold">{subject || "(no subject)"}</div>
              <div className="text-muted-foreground">Email preview appears once email is connected.</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{schedule ? "Schedule this text?" : "Send this text now?"}</DialogTitle></DialogHeader>
          {confirm && (
            <div className="space-y-2 text-sm">
              <Row label="Total recipients" value={confirm.total} bold />
              <Row label="Consent unknown (will still be sent)" value={confirm.unknownConsent} />
              <Row label="Skipped (opted out)" value={confirm.skippedOptedOut} />
              {confirm.skippedNoPhone > 0 && <Row label="Skipped (no phone)" value={confirm.skippedNoPhone} />}
              {schedule && scheduleAt && <Row label="Goes out" value={new Date(scheduleAt).toLocaleString()} />}
              <p className="pt-2 text-xs text-muted-foreground">Texts go out about 40 per minute to avoid carrier flags.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button onClick={onConfirm} disabled={busy || !confirm?.total}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number | string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "text-lg font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}
