import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Phone,
  Plus,
  Trash2,
  Pencil,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendors — Camauto Rentals" }] }),
  component: VendorsPage,
});

type SortDir = "asc" | "desc" | null;
type SortState = { column: "name" | "type"; direction: SortDir };

type Vendor = {
  id: string;
  name: string;
  phone: string;
  service_type: string | null;
  reference_number: string | null;
  address: string | null;
  notes: string | null;
};

const VENDOR_TYPES = [
  "Mechanic",
  "Body Shop",
  "Tow Service",
  "DMV",
  "Parts Supplier",
  "Detail Shop",
  "Insurance",
  "Other",
];

export default function VendorsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ column: "name", direction: "asc" });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formType, setFormType] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, phone, service_type, reference_number, address, notes")
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    setVendors((data ?? []) as Vendor[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const allTypes = useMemo(
    () => Array.from(new Set(vendors.map((v) => v.service_type).filter((t): t is string => !!t))),
    [vendors]
  );

  const filtered = useMemo(() => {
    let rows = vendors.slice();
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.service_type ?? "").toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") {
      rows = rows.filter((v) => v.service_type === typeFilter);
    }
    if (sort.direction) {
      rows.sort((a, b) => {
        const col = sort.column;
        const av = (col === "name" ? a.name : a.service_type ?? "").toLowerCase();
        const bv = (col === "name" ? b.name : b.service_type ?? "").toLowerCase();
        if (av < bv) return sort.direction === "asc" ? -1 : 1;
        if (av > bv) return sort.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [vendors, search, typeFilter, sort]);

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

  const openAdd = () => {
    setEditing(null);
    setFormName("");
    setFormPhone("");
    setFormType("");
    setFormAddress("");
    setFormNotes("");
    setShowForm(true);
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setFormName(v.name);
    setFormPhone(v.phone);
    setFormType(v.service_type ?? "");
    setFormAddress(v.address ?? "");
    setFormNotes(v.notes ?? "");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSave = async () => {
    const name = formName.trim();
    const phone = formPhone.trim();
    if (!name || !phone) {
      toast.error("Name and phone are required");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      phone,
      service_type: formType.trim() || null,
      address: formAddress.trim() || null,
      notes: formNotes.trim() || null,
    };
    if (editing) {
      const { error } = await supabase.from("vendors").update(payload).eq("id", editing.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Vendor updated");
    } else {
      const { error } = await supabase.from("vendors").insert(payload);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Vendor added");
    }
    closeForm();
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("vendors").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor removed");
    setDeleteTarget(null);
    load();
  };

  const toggleSort = (column: "name" | "type") => {
    setSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        if (prev.direction === "desc") return { column, direction: null };
        return { column, direction: "asc" };
      }
      return { column, direction: "asc" };
    });
  };

  const sortIcon = (column: "name" | "type") => {
    if (sort.column !== column || !sort.direction) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sort.direction === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle={`${vendors.length} business contacts`}
        action={
          isAdmin ? (
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add vendor
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {allTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading vendors…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {vendors.length === 0 ? "No vendors yet." : "No vendors match your search."}
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("name")}
                    >
                      <span className="inline-flex items-center">
                        Name {sortIcon("name")}
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("type")}
                    >
                      <span className="inline-flex items-center">
                        Type {sortIcon("type")}
                      </span>
                    </TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="hidden md:table-cell">Address</TableHead>
                    <TableHead className="hidden lg:table-cell">Notes</TableHead>
                    {isAdmin && <TableHead className="w-24 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((v) => (
                    <TableRow
                      key={v.id}
                      className="cursor-pointer"
                      onClick={() => isAdmin && openEdit(v)}
                    >
                      <TableCell>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell>
                        {v.service_type ? (
                          <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {v.service_type}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`tel:${v.phone.replace(/\D/g, "")}`}
                          className="inline-flex items-center gap-1 text-sm hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-3 w-3" />
                          {formatPhone(v.phone)}
                        </a>
                      </TableCell>
                      <TableCell className="hidden md:table-cell max-w-xs truncate text-muted-foreground">
                        {v.address || "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-xs truncate text-muted-foreground">
                        {v.notes || "—"}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(v);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(v);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) closeForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit vendor" : "Add vendor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="v-name">Name *</Label>
              <Input
                id="v-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Mechanic Jr"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="v-phone">Phone *</Label>
              <Input
                id="v-phone"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="856-842-6885"
                maxLength={30}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {VENDOR_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="v-address">Address</Label>
              <Input
                id="v-address"
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="123 Main St, Philadelphia, PA"
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="v-notes">Notes</Label>
              <Textarea
                id="v-notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Special instructions, contact person, hours, etc."
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : editing ? "Update vendor" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vendor?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
