import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo.jpeg";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — Camauto Rentals" }] }),
  component: SignupPage,
});

const schema = z.object({
  firstName: z.string().trim().min(1, "First name required").max(80),
  lastName: z.string().trim().min(1, "Last name required").max(80),
  phone: z.string().trim().min(7, "Phone required").max(30),
  email: z.string().trim().email("Valid email required").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

function SignupPage() {
  const nav = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ firstName, lastName, phone, email, password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          phone: phone.trim(),
        },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <CardTitle>Check your email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              We sent a confirmation link to <span className="font-medium">{email}</span>. Click it to verify your account.
            </p>
            <p className="text-muted-foreground">
              Once confirmed, an admin must approve your access before you can use the app.
            </p>
            <Button className="w-full" onClick={() => nav({ to: "/login" })}>Back to sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 h-12 w-12 overflow-hidden rounded-md bg-white p-1">
            <img src={logo} alt="Camauto Rentals" className="h-full w-full object-contain" />
          </div>
          <CardTitle>Create your account</CardTitle>
          <p className="text-sm text-muted-foreground">For Camauto runners and staff</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="su-first">First name</Label><Input id="su-first" required value={firstName} onChange={e => setFirstName(e.target.value)} /></div>
              <div><Label htmlFor="su-last">Last name</Label><Input id="su-last" required value={lastName} onChange={e => setLastName(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="su-phone">Phone</Label><Input id="su-phone" type="tel" required value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div><Label htmlFor="su-email">Email</Label><Input id="su-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div><Label htmlFor="su-pw">Password</Label><Input id="su-pw" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <div><Label htmlFor="su-pw2">Confirm password</Label><Input id="su-pw2" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating account…" : "Sign up"}</Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
