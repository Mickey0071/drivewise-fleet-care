import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo.jpeg";
import { resolveUsernameToEmail } from "@/lib/login-lookup.functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Camauto Rentals" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { session, role, roleLoading, signIn, loading } = useAuth();
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || roleLoading || !session || !role) return;
    nav({ to: role === "admin" ? "/" : "/checklist" });
  }, [loading, roleLoading, session, role, nav]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const raw = identifier.trim();
    let emailToUse: string;
    if (raw.includes("@")) {
      emailToUse = raw;
    } else {
      const uname = raw.toLowerCase();
      try {
        const { email } = await resolveUsernameToEmail({ data: { username: uname } });
        emailToUse = email ?? `${uname}@camauto.local`;
      } catch {
        emailToUse = `${uname}@camauto.local`;
      }
    }
    const { error } = await signIn(emailToUse, password);
    setBusy(false);
    if (error) toast.error(error);
    else toast.success("Welcome back");
  }


  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 h-12 w-12 overflow-hidden rounded-md bg-white p-1">
            <img src={logo} alt="Camauto Rentals" className="h-full w-full object-contain" />
          </div>
          <CardTitle>Camauto Rentals</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in to manage your fleet</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-3">
            <div><Label htmlFor="si-id">Username or Email</Label><Input id="si-id" type="text" autoComplete="username" required placeholder="e.g. johnrunner or you@email.com" value={identifier} onChange={e => setIdentifier(e.target.value)} /></div>
            <div><Label htmlFor="si-pw">Password</Label><Input id="si-pw" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
            <div className="pt-1 text-xs">
              <Link to="/forgot-password" className="font-medium text-primary hover:underline">Forgot password?</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
