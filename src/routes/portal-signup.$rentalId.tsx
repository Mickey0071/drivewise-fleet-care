import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRenterPortal } from "@/lib/renter-portal.functions";
import { createPortalAccount } from "@/lib/portal-link.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/portal-signup/$rentalId")({
  head: () => ({ meta: [{ title: "Create your account — Camauto Rentals" }] }),
  component: PortalSignupPage,
});

type Info = Awaited<ReturnType<typeof getRenterPortal>>;

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

function PortalSignupPage() {
  const { rentalId } = Route.useParams();
  const fetchInfo = useServerFn(getRenterPortal);
  const createAccount = useServerFn(createPortalAccount);
  const nav = useNavigate();

  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchInfo({ data: { rentalId } })
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [rentalId, fetchInfo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    setBusy(true);
    try {
      const { email } = await createAccount({ data: { rentalId, password } });
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      setDone(true);
      if (signInErr) {
        toast.success("Account created — please sign in");
        setTimeout(() => nav({ to: "/login" }), 1200);
      } else {
        toast.success("Account created — welcome!");
        setTimeout(() => nav({ to: "/my-rentals" }), 1000);
      }
    } catch (err) {
      toast.error("Could not create account", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="p-6 text-center">
          <p className="font-medium text-destructive">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Please contact Camauto Rentals if you believe this is a mistake.
          </p>
        </Card>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { vehicle, driver, rental } = info;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-center pb-2">
        <img src={logo} alt="Camauto Rentals" className="h-12 object-contain" />
      </header>

      <div className="text-center">
        <h1 className="text-2xl font-semibold">
          Welcome{driver?.full_name ? `, ${driver.full_name.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          Create your account to view your rental anytime.
        </p>
      </div>

      <Card className="overflow-hidden">
        {vehicle?.image_url && (
          <div className="aspect-[16/9] w-full bg-muted">
            <img src={vehicle.image_url} alt="vehicle" className="h-full w-full object-cover" />
          </div>
        )}
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Your vehicle</div>
          <div className="text-lg font-semibold">
            {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">Started {fmtDate(rental.start_date)}</div>
        </CardContent>
      </Card>

      {done ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <p className="font-medium">You're all set!</p>
            <p className="text-sm text-muted-foreground">Taking you to your rentals…</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Create your account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label htmlFor="pw">Choose a password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <Label htmlFor="pw2">Confirm password</Label>
                <Input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Questions? Call us at 1-866-625-5550.
      </p>
    </div>
  );
}
