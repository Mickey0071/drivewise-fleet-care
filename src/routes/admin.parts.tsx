import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Send, CheckCircle2 } from "lucide-react";
import {
  listPartsSuppliers, addPartsSupplier, createPartInquiry,
  listPartInquiries, closePartInquiry,
} from "@/lib/parts.functions";

export const Route = createFileRoute("/admin/parts")({
  head: () => ({ meta: [{ title: "Parts — Camauto Rentals" }] }),
  component: PartsPage,
});

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-US") : "—";
}

const availabilityLabel: Record<string, string> = {
  in_stock: "In stock",
  order: "Can order",
  unavailable: "Not available",
};

function statusBadge(status: string) {
  if (status === "quoted") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Quoted</Badge>;
  if (status === "closed") return <Badge variant="outline">Closed</Badge>;
  return <Badge variant="secondary">Awaiting price</Badge>;
}

function PartsPage() {
  return (
    <div>
      <PageHeader title="Parts" subtitle="Send a part to a supplier and get a price back — no login needed for them" />
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <NewInquiry />
        <InquiryList />
      </div>
    </div>
  );
}

function NewInquiry() {
  const qc = useQueryClient();
  const fetchSuppliers = useServerFn(listPartsSuppliers);
  const addSupplierFn = useServerFn(addPartsSupplier);
  const createFn = useServerFn(createPartInquiry);

  const { data } = useQuery({ queryKey: ["parts-suppliers"], queryFn: () => fetchSuppliers() });
  const suppliers = data?.suppliers ?? [];

  const [supplierId, setSupplierId] = useState("");
  const [partName, setPartName] = useState("");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [subModel, setSubModel] = useState("");
  const [notes, setNotes] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const addSupplier = useMutation({
    mutationFn: () => addSupplierFn({ data: { name: newName.trim(), phone: newPhone.trim() } }),
    onSuccess: (res) => {
      toast.success("Supplier added");
      setNewName(""); setNewPhone(""); setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["parts-suppliers"] });
      if (res?.supplier?.id) setSupplierId(res.supplier.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add supplier"),
  });

  const create = useMutation({
    mutationFn: () => createFn({ data: {
      supplierId, partName: partName.trim(),
      vin: vin.trim() || undefined, plate: plate.trim() || undefined,
      year: year.trim() || undefined, make: make.trim() || undefined,
      model: model.trim() || undefined, subModel: subModel.trim() || undefined,
      notes: notes.trim() || undefined,
    } }),
    onSuccess: () => {
      toast.success("Text sent to supplier");
      setPartName(""); setVin(""); setPlate(""); setYear(""); setMake(""); setModel(""); setSubModel(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["part-inquiries"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not send"),
  });

  const canSend = supplierId && partName.trim();

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">New Parts Inquiry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Select a supplier…" /></SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name} — {s.phone}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!showAdd ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowAdd(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add supplier
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!newName.trim() || !newPhone.trim() || addSupplier.isPending} onClick={() => addSupplier.mutate()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Part needed *</Label>
          <Input placeholder="e.g. Front bumper, alternator…" value={partName} onChange={(e) => setPartName(e.target.value)} />
        </div>

        <p className="text-xs text-muted-foreground">Vehicle details (all optional, but help the supplier):</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label className="text-xs">Year</Label><Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Make</Label><Input value={make} onChange={(e) => setMake(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Model</Label><Input value={model} onChange={(e) => setModel(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">Sub-model</Label><Input value={subModel} onChange={(e) => setSubModel(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">VIN</Label><Input value={vin} onChange={(e) => setVin(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">License plate</Label><Input value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else for the supplier…" />
        </div>

        <Button className="w-full" disabled={!canSend || create.isPending} onClick={() => create.mutate()}>
          <Send className="mr-2 h-4 w-4" /> {create.isPending ? "Sending…" : "Send to Supplier"}
        </Button>
      </CardContent>
    </Card>
  );
}

function InquiryList() {
  const qc = useQueryClient();
  const fetchInquiries = useServerFn(listPartInquiries);
  const closeFn = useServerFn(closePartInquiry);
  const { data, isLoading } = useQuery({ queryKey: ["part-inquiries"], queryFn: () => fetchInquiries() });
  const items = data?.items ?? [];

  const close = useMutation({
    mutationFn: (id: string) => closeFn({ data: { id } }),
    onSuccess: () => { toast.success("Closed"); qc.invalidateQueries({ queryKey: ["part-inquiries"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  if (items.length === 0) return <div className="py-12 text-center text-muted-foreground">No parts inquiries yet.</div>;

  return (
    <div className="space-y-3">
      {items.map((it) => {
        const vehicle = [it.year, it.make, it.model, it.sub_model].filter(Boolean).join(" ");
        return (
          <Card key={it.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{it.part_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {it.supplier_name}{vehicle ? ` · ${vehicle}` : ""} · sent {fmt(it.link_sent_at)}
                  </div>
                </div>
                {statusBadge(it.status)}
              </div>
              {(it.vin || it.plate || it.notes) && (
                <div className="text-xs text-muted-foreground">
                  {it.vin && <span className="mr-3">VIN: {it.vin}</span>}
                  {it.plate && <span className="mr-3">Plate: {it.plate}</span>}
                  {it.notes && <span>{it.notes}</span>}
                </div>
              )}
              {it.status === "quoted" && (
                <div className="rounded-md bg-emerald-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> ${Number(it.quote_price).toFixed(2)}
                    {it.quote_availability && (
                      <span className="font-normal text-emerald-600">· {availabilityLabel[it.quote_availability] ?? it.quote_availability}</span>
                    )}
                  </div>
                  {it.quote_notes && <div className="mt-1 text-muted-foreground">{it.quote_notes}</div>}
                </div>
              )}
              {it.status !== "closed" && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => close.mutate(it.id)}>
                  Close
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}