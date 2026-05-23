import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStaffSetupToken, completeStaffSetup } from "@/lib/staff-setup.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/setup/$token")({
  head: () => ({ meta: [{ title: "Account Setup — Camauto Rentals" }] }),
  component: StaffSetupPage,
});

type TokenInfo =
  | { ok: true; email: string; role: string; first_name: string | null; last_name: string | null; phone: string | null }
  | { ok: false; reason: "not_found" | "consumed" | "expired" };

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  runner: "Runner",
  driver: "Driver",
  va: "Virtual Assistant",
};

function StaffSetupPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const getToken = useServerFn(getStaffSetupToken);
  const complete = useServerFn(completeStaffSetup);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getToken({ data: { token } })
      .then((res) => { if (mounted) setInfo(res as TokenInfo); })
      .catch(() => { if (mounted) setInfo({ ok: false, reason: "not_found" }); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [token, getToken]);

  const matches = password.length >= 8 && password === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    try {
      await complete({ data: { token, password } });
      toast.success("Account created — please sign in.");
      navigate({ to: "/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Set up your account</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Validating link…</p>
          ) : !info || !info.ok ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-destructive">
                {info?.reason === "expired" && "This setup link has expired."}
                {info?.reason === "consumed" && "This setup link has already been used."}
                {(!info || info.reason === "not_found") && "This setup link is invalid."}
              </p>
              <p className="text-muted-foreground">Ask an admin to send you a new link.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label>Email</Label>
                <Input value={info.email} readOnly />
              </div>
              <div>
                <Label>Your role</Label>
                <div className="mt-1"><Badge>{ROLE_LABEL[info.role] ?? info.role}</Badge></div>
              </div>
              <div>
                <Label htmlFor="pw">Password (min 8 characters)</Label>
                <Input id="pw" type="password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" value={confirm} minLength={8} onChange={(e) => setConfirm(e.target.value)} required />
                {confirm.length > 0 && password !== confirm && (
                  <p className="mt-1 text-xs text-destructive">Passwords don't match.</p>
                )}
              </div>
              <Button type="submit" disabled={busy || !matches} className="w-full">
                {busy ? "Creating account…" : "Create Account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}