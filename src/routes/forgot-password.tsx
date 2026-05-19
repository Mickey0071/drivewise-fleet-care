import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Phone, ChevronDown } from "lucide-react";

// TODO: Admin — update this phone number to your real Camauto support line.
const ADMIN_PHONE_DISPLAY = "(555) 555-5555";
const ADMIN_PHONE_TEL = "+15555555555";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password — Camauto Rentals" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { toast.error("Enter your email"); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle>Forgot your password?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Contact your admin to reset your password. They can issue a new temp password from the Team &amp; Access page.
          </p>

          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin contact</p>
            <a
              href={`tel:${ADMIN_PHONE_TEL}`}
              className="mt-1 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
            >
              <Phone className="h-4 w-4" />
              {ADMIN_PHONE_DISPLAY}
            </a>
          </div>

          <Button asChild className="w-full">
            <Link to="/login">Back to Login</Link>
          </Button>

          <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50">
              <span>Have an email on file?</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-3 py-3">
              {sent ? (
                <p className="text-sm text-muted-foreground">
                  If an account exists with that email, you'll receive a reset link.
                </p>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <Label htmlFor="fp-email">Email</Label>
                    <Input
                      id="fp-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Sending…" : "Send Reset Link"}
                  </Button>
                </form>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}