import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { adminCreateUser } from "@/lib/admin-users.functions";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, RefreshCw, Plus, Copy } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Team & Access — Camauto Rentals" }] }),
  component: AdminUsersPage,
});

type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
};

type RoleRow = { user_id: string; role: AppRole };

type RoleOption = AppRole | "none";

function AdminUsersPage() {
  const { role } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Record<string, AppRole | null>>({});
  const [pending, setPending] = useState<Record<string, RoleOption>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData, error: pErr }, { data: rData, error: rErr }] = await Promise.all([
      supabase.from("profiles").select("id, email, first_name, last_name, full_name, phone, created_at").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (pErr) toast.error(pErr.message);
    if (rErr) toast.error(rErr.message);
    const rMap: Record<string, AppRole | null> = {};
    (rData as RoleRow[] | null)?.forEach(r => {
      const current = rMap[r.user_id];
      // priority admin > runner > driver
      const rank = (x: AppRole) => x === "admin" ? 3 : x === "runner" ? 2 : 1;
      if (!current || rank(r.role) > rank(current)) rMap[r.user_id] = r.role;
    });
    setProfiles((pData ?? []) as Profile[]);
    setRoles(rMap);
    setPending({});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <h1 className="text-xl font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">You don't have access to this page.</p>
      </div>
    );
  }

  async function saveRole(userId: string) {
    const desired = pending[userId];
    if (!desired) return;
    setSaving(userId);
    // Wipe existing roles then insert the new one (or leave empty for "none")
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (delErr) { setSaving(null); toast.error(delErr.message); return; }
    if (desired !== "none") {
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role: desired });
      if (insErr) { setSaving(null); toast.error(insErr.message); return; }
    }
    setRoles(prev => ({ ...prev, [userId]: desired === "none" ? null : desired }));
    setPending(prev => { const n = { ...prev }; delete n[userId]; return n; });
    setSaving(null);
    toast.success("Role updated");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team & Access</h1>
          <p className="text-sm text-muted-foreground">Approve new sign-ups and manage roles for runners, drivers, and admins.</p>
        </div>
        <AddUserButton onCreated={load} />
      </div>
      <Card>
        <CardHeader><CardTitle>All users</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Signed up</TableHead>
                    <TableHead>Current role</TableHead>
                    <TableHead>Assign role</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map(p => {
                    const current = roles[p.id] ?? null;
                    const selected = pending[p.id] ?? (current ?? "none");
                    const dirty = pending[p.id] !== undefined && pending[p.id] !== (current ?? "none");
                    const displayName = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || "—";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{displayName}</TableCell>
                        <TableCell>{p.email ?? "—"}</TableCell>
                        <TableCell>{p.phone ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {current ? <Badge variant={current === "admin" ? "default" : "secondary"}>{current}</Badge> : <Badge variant="outline">pending</Badge>}
                        </TableCell>
                        <TableCell>
                          <Select value={selected} onValueChange={(v) => setPending(prev => ({ ...prev, [p.id]: v as RoleOption }))}>
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              <SelectItem value="driver">Driver</SelectItem>
                              <SelectItem value="runner">Runner</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" disabled={!dirty || saving === p.id} onClick={() => saveRole(p.id)}>
                            {saving === p.id ? "Saving…" : "Save"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
