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
import { adminCreateUser, adminDeleteUser } from "@/lib/admin-users.functions";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Eye, EyeOff, RefreshCw, Plus, Copy, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Team & Access — Camauto Rentals" }] }),
  component: AdminUsersPage,
});

type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
};

type RoleRow = { user_id: string; role: AppRole };

type RoleOption = AppRole | "none";

function AdminUsersPage() {
  const { role, user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Record<string, AppRole | null>>({});
  const [pending, setPending] = useState<Record<string, RoleOption>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const doDelete = useServerFn(adminDeleteUser);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData, error: pErr }, { data: rData, error: rErr }] = await Promise.all([
      supabase.from("profiles").select("id, email, username, first_name, last_name, full_name, phone, created_at").order("created_at", { ascending: false }),
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

  function handleDelete(profile: Profile) {
    setDeleteTarget(profile);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await doDelete({ data: { user_id: deleteTarget.id } });
      toast.success("User deleted");
      setDeleteOpen(false);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeleteBusy(false);
    }
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
                    <TableHead>Username / Email</TableHead>
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
                        <TableCell>
                          {p.email && p.email.endsWith("@camauto.local")
                            ? (p.username ?? p.email.split("@")[0])
                            : (p.username ?? p.email ?? "—")}
                        </TableCell>
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
                          <div className="flex items-center gap-2">
                            <Button size="sm" disabled={!dirty || saving === p.id} onClick={() => saveRole(p.id)}>
                              {saving === p.id ? "Saving…" : "Save"}
                            </Button>
                            {user?.id === p.id ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-block">
                                      <Button size="sm" variant="destructive" disabled className="cursor-not-allowed">
                                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>You can't delete your own account.</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Button size="sm" variant="destructive" onClick={() => handleDelete(p)}>
                                <Trash2 className="mr-1 h-4 w-4" /> Delete
                              </Button>
                            )}
                          </div>
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
      <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete {deleteTarget?.username ?? deleteTarget?.email ?? "this user"}? This permanently removes their account and all roles. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? "Deleting…" : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function generatePassword(len = 14): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const syms = "!@#$%^&*";
  const all = upper + lower + nums + syms;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const required = [pick(upper), pick(lower), pick(nums), pick(syms)];
  const rest = Array.from({ length: Math.max(0, len - required.length) }, () => pick(all));
  return [...required, ...rest].sort(() => Math.random() - 0.5).join("");
}

function AddUserButton({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const createUser = useServerFn(adminCreateUser);
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [password, setPassword] = useState(() => generatePassword());
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState<AppRole>("driver");
  const [mustReset, setMustReset] = useState(true);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFirstName(""); setLastName(""); setPhone(""); setUsername("");
    setUsernameError(null); setCheckingUsername(false);
    setPassword(generatePassword()); setShowPwd(false);
    setRole("driver"); setMustReset(true);
  }

  function validateUsername(value: string): string | null {
    const v = value.trim();
    if (!v) return "Username is required.";
    if (v.includes("@")) return "No @ symbol allowed.";
    if (v.length < 3) return "Must be at least 3 characters.";
    if (v.length > 30) return "Must be at most 30 characters.";
    if (!/^[a-z0-9._-]+$/.test(v)) return "Only lowercase letters, numbers, dots, underscores, hyphens.";
    return null;
  }

  useEffect(() => {
    const v = username.trim().toLowerCase();
    const syntaxErr = validateUsername(v);
    if (syntaxErr) { setUsernameError(v ? syntaxErr : null); return; }
    setCheckingUsername(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", v)
        .maybeSingle();
      setCheckingUsername(false);
      if (error) { setUsernameError(error.message); return; }
      setUsernameError(data ? "Username already taken." : null);
    }, 300);
    return () => clearTimeout(t);
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const uname = username.trim().toLowerCase();
    const uErr = validateUsername(uname);
    if (uErr) { setUsernameError(uErr); return; }
    if (usernameError) return;
    if (!firstName.trim() || !lastName.trim() || password.length < 8) {
      toast.error("Fill all required fields (password ≥ 8 chars)");
      return;
    }
    setBusy(true);
    try {
      await createUser({ data: {
        username: uname,
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
        role,
        must_reset_password: mustReset,
      }});
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const text = `User created. Send them:\nUsername: ${uname}\nTemp password: ${password}\nLogin at: ${origin}/login`;
      toast.success("User created", {
        description: (
          <div className="space-y-2">
            <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{text}</pre>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}>
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
        ),
        duration: 30000,
      });
      setOpen(false);
      reset();
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }}>
        <Plus className="mr-1 h-4 w-4" /> Add User
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="fn">First name</Label>
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="ln">Last name</Label>
                <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="ph">Phone (optional)</Label>
              <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="un">Username</Label>
              <Input
                id="un"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Runner will log in with this username. No email required.
              </p>
              {usernameError && (
                <p className="mt-1 text-xs text-destructive">{usernameError}</p>
              )}
            </div>
            <div>
              <Label htmlFor="pw">Temporary password</Label>
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <Input
                    id="pw"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} title="Generate">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="runner">Runner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={mustReset} onCheckedChange={(v) => setMustReset(v === true)} />
              Force password reset on first login
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !!usernameError || checkingUsername || !username.trim()}>
                {busy ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
