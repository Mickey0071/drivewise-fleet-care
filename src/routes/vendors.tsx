import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@components/app/PageHeader";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/ui/dialog";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendors — Camauto Rentals" }] }),
  component: VendorsPage,
});

type Vendor = {
  id: string;
  name: string;
  phone: string;
  service_type: string | null;
  reference_number: string | null;
};

function VendorsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newService, setNewService] = useState("");
  const [newRef, setNewRef] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, phone, service_type, reference_number")
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    setVendors((data ?? []) as Vendor[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const formatPhone = (raw: string) => {
    const cleaned = raw.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return raw;
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name || !phone) {
      toast.error("Name and phone are required");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("vendors").insert({
      name,
      phone,
      service_type: newService.trim() || null,
      reference_number: newRef.trim() || null,
    });
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor added");
    setNewName("");
    setNewPhone("");
    setNewService("");
    setNewRef("");
    setShowAdd(false);
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("vendors").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor removed");
    load();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <PageHeader
        title="📞 Vendors"
        subtitle="Quick contacts for mechanics, body shops, and parts"
      />

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading vendors…
        </div>
      ) : vendors.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No vendors yet.
        </div>
      ) : (
        <div className="space-y-3">
          {vendors.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold truncate">
                      {v.name}
                    </div>
                    {v.reference_number && (
                      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Pin: {v.reference_number}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {formatPhone(v.phone)}
                    {v.service_type ? ` · ${v.service_type}` : ""}
                  </div>
                </div>
                <a
                  href={`tel:${v.phone.replace(/\D/g, "")}`}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90"
                  aria-label={`Call ${v.name}`}
                >
                  <Phone className="h-4 w-4" />
                </a>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(v.id)}
                    aria-label={`Delete ${v.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isAdmin && (
        <Button
          variant="outline"
          className="h-12 w-full gap-2 text-base font-semibold"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="h-4 w-4" /> Add vendor
        </Button>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="v-name">Name *</Label>
              <Input
                id="v-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Mechanic Jr"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="v-phone">Phone *</Label>
              <Input
                id="v-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="856-842-6885"
                maxLength={30}
              />
            </div>
            <div>
              <Label htmlFor="v-service">Service type (optional)</Label>
              <Input
                id="v-service"
                value={newService}
                onChange={(e) => setNewService(e.target.value)}
                placeholder="e.g. Mechanic, Body shop, Parts"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="v-ref">Reference / store number (optional)</Label>
              <Input
                id="v-ref"
                value={newRef}
                onChange={(e) => setNewRef(e.target.value)}
                placeholder="e.g. 11744473"
                maxLength={60}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button disabled={adding} onClick={handleAdd}>
              {adding ? "Adding…" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
