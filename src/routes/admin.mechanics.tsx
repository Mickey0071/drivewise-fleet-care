import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  listMechanics,
  saveMechanic,
  deleteMechanic,
  type SavedMechanic,
} from "@/lib/mechanics.functions";

export const Route = createFileRoute("/admin/mechanics")({
  head: () => ({ meta: [{ title: "Mechanics — Camauto Rentals" }] }),
  component: MechanicsAdminPage,
});

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function MechanicsAdminPage() {
  const listFn = useServerFn(listMechanics);
  const saveFn = useServerFn(saveMechanic);
  const deleteFn = useServerFn(deleteMechanic);
  const [rows, setRows] = useState<SavedMechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listFn());
    } catch (e: any) {
      toast.error(e?.message || "Failed to load mechanics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addMechanic() {
    if (!name.trim()) { toast.error("Enter a mechanic name"); return; }
    if (phone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid phone"); return; }
    setBusy(true);
    try {
      await saveFn({ data: { name: name.trim(), phone: phone.trim(), shop: shop.trim() || undefined } });
      toast.success("Mechanic saved");
      setName(""); setPhone(""); setShop("");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(m: SavedMechanic, active: boolean) {
    try {
      await saveFn({ data: { id: m.id, name: m.name, phone: m.phone, shop: m.shop ?? undefined, isActive: active } });
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    }
  }

  async function remove(m: SavedMechanic) {
    if (!confirm(`Remove ${m.name}?`)) return;
    try {
      await deleteFn({ data: { id: m.id } });
      toast.success("Removed");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Mechanics" subtitle="Saved mechanics appear in the Create-Task Mechanic dropdown" />

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add mechanic</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mike's Auto" />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input className="mt-1" type="tel" value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(267) 555-1234" />
            </div>
            <div>
              <Label>Shop (optional)</Label>
              <Input className="mt-1" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="Northeast Auto Repair" />
            </div>
          </div>
          <Button size="sm" onClick={addMechanic} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> Save</>}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" /> Saved mechanics ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mechanics saved yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{m.name}{!m.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</div>
                    <div className="text-xs text-muted-foreground truncate">{formatPhone(m.phone)}{m.shop ? ` · ${m.shop}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                      Active <Switch checked={m.isActive} onCheckedChange={(v) => toggleActive(m, v)} />
                    </label>
                    <Button size="icon" variant="ghost" onClick={() => remove(m)} title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}