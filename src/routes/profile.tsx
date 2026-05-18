import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, KeyRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — Camauto Runner Hub" }] }),
  component: ProfilePage,
});

type Profile = {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
};

function ProfilePage() {
  const { user, role, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [changing, setChanging] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles")
        .select("first_name, last_name, full_name, phone, email")
        .eq("id", user.id).maybeSingle();
      if (!cancelled) setProfile((data as Profile) ?? null);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.full_name || "—"
    : "—";

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pw !== pw2) { toast.error("Passwords do not match"); return; }
    setChanging(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setChanging(false);
    if (error) { toast.error(error.message); return; }
    setPw(""); setPw2(""); setShowPw(false);
    toast.success("Password updated");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Profile</h1>
      <Card>
        <CardContent className="space-y-4 py-6">
          <Row label="Name" value={displayName} />
          <Row label="Email" value={profile?.email ?? user?.email ?? "—"} />
          <Row label="Phone" value={profile?.phone ?? "—"} />
          <Row label="Role" value={role ?? "—"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Security</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!showPw ? (
            <Button variant="outline" onClick={() => setShowPw(true)}>
              <KeyRound className="mr-2 h-4 w-4" /> Change password
            </Button>
          ) : (
            <form onSubmit={changePassword} className="space-y-3">
              <div><Label htmlFor="pw-new">New password</Label><Input id="pw-new" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></div>
              <div><Label htmlFor="pw-conf">Confirm password</Label><Input id="pw-conf" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" /></div>
              <div className="flex gap-2">
                <Button type="submit" disabled={changing}>{changing ? "Saving…" : "Update password"}</Button>
                <Button type="button" variant="ghost" onClick={() => { setShowPw(false); setPw(""); setPw2(""); }}>Cancel</Button>
              </div>
            </form>
          )}
          <div className="pt-2">
            <Button variant="outline" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
