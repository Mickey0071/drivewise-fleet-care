import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getChecklistByToken,
  saveChecklistItem,
  submitChecklist,
  type PublicChecklistItem,
} from "@/lib/prerental-checklist-public.functions";

export const Route = createFileRoute("/runner/checklist/$token")({
  head: () => ({
    meta: [
      { title: "Pre-Rental Checklist — Camauto Rentals" },
      { name: "description", content: "Complete the pre-rental vehicle inspection checklist." },
      { property: "og:title", content: "Pre-Rental Checklist — Camauto Rentals" },
      { property: "og:description", content: "Complete the pre-rental vehicle inspection checklist." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunnerChecklistPage,
});

const STATUSES: { value: "pass" | "fail" | "n/a"; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "n/a", label: "N/A" },
];

function RunnerChecklistPage() {
  const { token } = Route.useParams();
  const load = useServerFn(getChecklistByToken);
  const saveItem = useServerFn(saveChecklistItem);
  const submit = useServerFn(submitChecklist);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["public-checklist", token],
    queryFn: () => load({ data: { token } }),
  });

  const [items, setItems] = useState<PublicChecklistItem[]>([]);
  const [runnerName, setRunnerName] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ passed: number; failed: number; na: number } | null>(null);

  useEffect(() => {
    if (data?.checklist) {
      setItems(data.checklist.items);
      if (data.checklist.runnerName && !runnerName) setRunnerName(data.checklist.runnerName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.checklist?.id]);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicChecklistItem[]>();
    for (const i of items) {
      const list = map.get(i.category) ?? [];
      list.push(i);
      map.set(i.category, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const counts = useMemo(() => ({
    pass: items.filter((i) => i.status === "pass").length,
    fail: items.filter((i) => i.status === "fail").length,
    na: items.filter((i) => i.status === "n/a").length,
    pending: items.filter((i) => i.status === "pending").length,
  }), [items]);

  async function setStatus(item: PublicChecklistItem, status: "pass" | "fail" | "n/a") {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try {
      await saveItem({ data: { token, itemId: item.id, status } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function saveNotes(item: PublicChecklistItem, value: string) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, notes: value } : i)));
    try {
      await saveItem({ data: { token, itemId: item.id, notes: value } });
    } catch {
      /* keep local value; will retry on next change */
    }
  }

  async function handleSubmit() {
    if (!runnerName.trim()) {
      toast.error("Enter your name");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submit({ data: { token, runnerName, signature, notes } });
      setDone({ passed: res.passed, failed: res.failed, na: res.na });
      toast.success("Checklist submitted");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading checklist…</div>;
  }
  if (!data || data.state === "invalid") {
    return <Centered title="Link not valid" text="This checklist link is not recognized. Ask the office to resend it." />;
  }
  if (data.state === "expired") {
    return <Centered title="Link expired" text="This checklist link has expired. Ask the office to resend it." />;
  }
  if (done || data.state === "completed") {
    const c = done ?? { passed: 0, failed: 0, na: 0 };
    return (
      <Centered
        title="Checklist complete"
        text={
          done
            ? `${c.passed} passed · ${c.failed} failed · ${c.na} N/A. The office has been notified.`
            : `Submitted by ${data.checklist?.completedByName ?? "runner"}. Nothing else to do.`
        }
        ok
      />
    );
  }

  const cl = data.checklist!;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Pre-Rental Checklist</h1>
        <p className="text-sm text-muted-foreground">
          {cl.vehicleLabel} · {cl.plate}
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-4 py-3 text-sm">
          <span className="text-success">{counts.pass} passed</span>
          <span className="font-semibold text-destructive">{counts.fail} failed</span>
          <span className="text-muted-foreground">{counts.na} N/A</span>
          <span className="text-muted-foreground">{counts.pending} left</span>
        </CardContent>
      </Card>

      <div className="space-y-5">
        {grouped.map(([category, list]) => (
          <div key={category}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h2>
            <div className="space-y-2">
              {list.map((item) => (
                <Card key={item.id} className={cn(item.status === "fail" && "border-destructive")}>
                  <CardContent className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={cn("text-sm", item.status === "fail" && "font-bold text-destructive")}>
                        {item.itemName}
                      </span>
                      <div className="flex gap-1">
                        {STATUSES.map((s) => (
                          <Button
                            key={s.value}
                            size="sm"
                            variant={item.status === s.value ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => setStatus(item, s.value)}
                          >
                            {s.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Textarea
                      rows={item.status === "fail" ? 2 : 1}
                      placeholder={item.status === "fail" ? "Notes required — what's wrong?" : "Notes (optional)"}
                      value={item.notes ?? ""}
                      onChange={(e) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, notes: e.target.value } : i)))}
                      onBlur={(e) => saveNotes(item, e.target.value)}
                      className="text-sm"
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Card className="mt-6">
        <CardContent className="space-y-3 py-4">
          <div>
            <Label>Your name *</Label>
            <Input value={runnerName} onChange={(e) => setRunnerName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label>Signature (type your name)</Label>
            <Input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Sign here" />
          </div>
          <div>
            <Label>Overall notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {counts.fail > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Add notes for every failed item before submitting.
            </p>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit checklist"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Centered({ title, text, ok }: { title: string; text: string; ok?: boolean }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {ok ? (
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
      ) : (
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-warning" />
      )}
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
