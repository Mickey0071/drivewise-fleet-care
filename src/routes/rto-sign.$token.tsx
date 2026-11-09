import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRtoByToken, signRto } from "@/lib/rto.functions";
import { RtoContractDocument } from "@/components/app/RtoContractDocument";
import { SignaturePad } from "@/components/app/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Printer } from "lucide-react";

export const Route = createFileRoute("/rto-sign/$token")({
  head: () => ({ meta: [
    { title: "Sign Rent-To-Own Agreement — CAM Auto Rentals" },
    { name: "description", content: "Review and sign your CAM Auto Rent-To-Own agreement." },
    { property: "og:title", content: "Sign Rent-To-Own Agreement — CAM Auto Rentals" },
    { property: "og:description", content: "Review and sign your CAM Auto Rent-To-Own agreement." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: SignPage,
});

function SignPage() {
  const { token } = Route.useParams();
  const load = useServerFn(getRtoByToken);
  const sign = useServerFn(signRto);
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load({ data: { token } }).then((r) => { setC(r); setName(r.customer_name || ""); if (r.signed_at) setDone(true); }).catch((e) => setErr(e.message)); }, [token]);

  if (err) return <div className="p-8 text-center text-destructive">{err}</div>;
  if (!c) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  const terms = { agreementDate: c.agreement_date, firstDueDate: c.first_due_date, downPayment: Number(c.down_payment), weeklyAmount: Number(c.weekly_amount), numPayments: c.num_payments, lateFeePerDay: Number(c.late_fee_per_day) };

  async function submit() {
    if (!sig) { setErr(null); alert("Please sign in the box"); return; }
    setBusy(true);
    try { await sign({ data: { token, name, signature: sig } }); const updated = await load({ data: { token } }); setC(updated); setDone(true); }
    catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function printCurrent() {
    const popup = window.open("", "_blank");
    if (!popup) return;
    setBusy(true);
    try {
      const updated = await load({ data: { token } });
      setC(updated);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!documentRef.current) { popup.close(); return; }
      popup.document.write(`<html><head><title>CAM Auto Rent-To-Own Contract</title>${Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(el => el.outerHTML).join("")}<style>body{padding:24px}.rto-break{break-before:page}</style></head><body>${documentRef.current.innerHTML}</body></html>`);
      popup.document.close();
      await Promise.all(Array.from(popup.document.images).map(img => img.decode().catch(() => {})));
      popup.focus(); popup.print();
    } catch { popup.close(); alert("Could not load current payments. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {done && <Button variant="outline" disabled={busy} onClick={printCurrent}><Printer className="h-4 w-4" />Print contract to date</Button>}
      <div ref={documentRef} className="p-4"><RtoContractDocument c={c} terms={terms} payments={c.payments ?? []} showChecklist={done} /></div>
      {done ? (
        <Card className="p-6 text-center"><div className="text-lg font-semibold">✅ Signed — thank you!</div><p className="text-sm text-muted-foreground">CAM Auto Rentals has been notified. We'll text you your payment link.</p></Card>
      ) : (
        <Card className="space-y-3 p-4">
          <label className="text-sm font-medium">Type your full legal name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-sm font-medium">Sign below</label>
          <SignaturePad value={sig ?? undefined} onChange={setSig} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read and agree to this Rent-To-Own Agreement, including the as-is, no-repairs, 3-day termination, late fee, repossession and forfeiture terms.</label>
          <Button className="w-full" disabled={!agree || !name.trim() || busy} onClick={submit}>{busy ? "Saving…" : "Sign Agreement"}</Button>
        </Card>
      )}
    </div>
  );
}
