import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getRmCardPublic, submitRmCardByToken, type RmItem } from "@/lib/rm-cards.functions";
import { RmCardForm, type RmFormItem } from "@/components/app/RmCardForm";

export const Route = createFileRoute("/rm-card/$token")({
  head: () => ({ meta: [{ title: "Routine Maintenance — Camauto Rentals" }] }),
  ssr: false,
  component: RmCardPublicPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="flex items-center justify-center gap-2 text-center">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Routine Maintenance Card</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function Msg({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </Card>
  );
}

type Loaded = Awaited<ReturnType<typeof getRmCardPublic>>;

function RmCardPublicPage() {
  const { token } = Route.useParams();
  const fetchFn = useServerFn(getRmCardPublic);
  const submitFn = useServerFn(submitRmCardByToken);

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [items, setItems] = useState<RmFormItem[]>([]);
  const [inspectorName, setInspectorName] = useState("");
  const [inspectorPhone, setInspectorPhone] = useState("");
  const [overallNotes, setOverallNotes] = useState("");
  const [lastRmText, setLastRmText] = useState("No prior RM inspection");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { token } });
        if (cancelled) return;
        setData(r);
        if (r.state === "ok") {
          setItems(
            (r.card.items as RmItem[]).map((it) => ({
              type: it.type,
              customId: it.customId,
              label: it.label,
              due: it.due,
              status: "",
              notes: "",
            })),
          );
          setInspectorName(r.card.inspectorName ?? "");
          if (r.vehicle.lastRmDate) {
            const days = Math.round((Date.now() - new Date(r.vehicle.lastRmDate).getTime()) / 86400_000);
            setLastRmText(`Last RM ${r.vehicle.lastRmDate.slice(0, 10)} · ${days} day${days === 1 ? "" : "s"} ago`);
          }
        }
      } catch {
        if (!cancelled) setData({ state: "invalid" } as Loaded);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, fetchFn]);

  function setStatus(idx: number, status: "Pass" | "Fail") {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status } : it)));
  }
  function setNotes(idx: number, notes: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, notes } : it)));
  }

  async function handleSubmit() {
    if (items.some((i) => i.status !== "Pass" && i.status !== "Fail")) {
      toast.error("Mark Pass or Fail for every item");
      return;
    }
    setBusy(true);
    try {
      await submitFn({ data: { token, items, overallNotes: overallNotes.trim() || undefined } });
      setDone(true);
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Shell><Card className="flex items-center justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card></Shell>;
  }
  if (done) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <h2 className="mt-3 text-lg font-semibold">RM Card submitted</h2>
          <p className="mt-1 text-sm text-muted-foreground">Thank you. Your results are pending admin approval before the vehicle is updated.</p>
        </Card>
      </Shell>
    );
  }
  if (!data || data.state === "invalid") return <Shell><Msg title="Invalid link" body="This routine maintenance link is not valid." /></Shell>;
  if (data.state === "submitted") return <Shell><Msg title="Already completed" body="This RM Card has already been submitted." /></Shell>;
  if (data.state === "cancelled") return <Shell><Msg title="Cancelled" body="This RM Card has been cancelled." /></Shell>;
  if (data.state === "expired") return <Shell><Msg title="Link expired" body="This RM Card link has expired." /></Shell>;

  return (
    <Shell>
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">{data.vehicle.label} — {data.vehicle.plate}</p>
        <RmCardForm
          vehicleLabel={data.vehicle.label}
          plate={data.vehicle.plate}
          mileage={data.card.mileage}
          lastRmText={lastRmText}
          items={items}
          onStatus={setStatus}
          onNotes={setNotes}
          inspectorName={inspectorName}
          inspectorPhone={inspectorPhone}
          setInspectorName={setInspectorName}
          setInspectorPhone={setInspectorPhone}
          inspectorReadOnly
          overallNotes={overallNotes}
          setOverallNotes={setOverallNotes}
        />
        <Button className="mt-4 w-full" disabled={busy} onClick={handleSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit RM Card"}
        </Button>
      </Card>
    </Shell>
  );
}
