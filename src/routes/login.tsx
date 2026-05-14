import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo.jpeg";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Camauto Rentals" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { session, signIn, signUp, signInWithGoogle, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) nav({ to: "/" });
  }, [loading, session, nav]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else toast.success("Welcome back");
  }
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) toast.error(error);
    else toast.success("Check your email to confirm your account");
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
          <Button type="button" variant="outline" className="mb-4 w-full" onClick={signInWithGoogle}>
            Continue with Google
          </Button>
          <div className="relative mb-4 text-center text-xs uppercase text-muted-foreground">
            <span className="relative z-10 bg-card px-2">or</span>
            <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-border" />
          </div>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div><Label htmlFor="si-email">Email</Label><Input id="si-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div><Label htmlFor="si-pw">Password</Label><Input id="si-pw" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div><Label htmlFor="su-name">Full name</Label><Input id="su-name" required value={fullName} onChange={e => setFullName(e.target.value)} /></div>
                <div><Label htmlFor="su-email">Email</Label><Input id="su-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div><Label htmlFor="su-pw">Password</Label><Input id="su-pw" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} /></div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
                <p className="text-xs text-muted-foreground">First account becomes admin. Others default to renter — admin can promote later.</p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
