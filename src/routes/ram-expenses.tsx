import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowUpDown, Download, Loader2 } from "lucide-react";
import logoUrl from "@/assets/camauto-logo.jpeg";

export const Route = createFileRoute("/ram-expenses")({
  head: () => ({
    meta: [
      { title: "RAM Auto Expense Tracker" },
      { name: "description", content: "Monthly expense input and analytics dashboard for RAM Auto Group." },
      { property: "og:title", content: "RAM Auto Expense Tracker" },
      { property: "og:description", content: "Monthly expense input and analytics dashboard for RAM Auto Group." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RamExpensesPage,
});

const CATEGORIES = ["Operations", "Inventory", "Marketing", "Utilities", "Maintenance", "Payroll", "Insurance", "Other"] as const;

const CATEGORY_STYLE: Record<string, { badge: string; accent: string }> = {
  Operations: { badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400", accent: "border-l-blue-500" },
  Inventory: { badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400", accent: "border-l-violet-500" },
  Marketing: { badge: "bg-pink-500/10 text-pink-600 dark:text-pink-400", accent: "border-l-pink-500" },
  Utilities: { badge: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", accent: "border-l-cyan-500" },
  Maintenance: { badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400", accent: "border-l-amber-500" },
  Payroll: { badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", accent: "border-l-emerald-500" },
  Insurance: { badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", accent: "border-l-indigo-500" },
  Other: { badge: "bg-muted text-muted-foreground", accent: "border-l-muted-foreground/40" },
};

interface RamExpense {
  id: string;
  expense_date: string;
  name: string;
  category: string;
  amount: number;
  paid_by: string;
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type SortKey = "date" | "amount";

function RamExpensesPage() {
  const [rows, setRows] = useState<RamExpense[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [saving, setSaving] = useState(false);

  // list state
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // edit modal
  const [editing, setEditing] = useState<RamExpense | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPaidBy, setEditPaidBy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ram_expenses")
      .select("id, expense_date, name, category, amount, paid_by")
      .order("expense_date", { ascending: false });
    if (error) toast.error("Couldn't load expenses");
    else setRows((data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setName(""); setCategory(""); setAmount(""); setPaidBy("");
    setDate(new Date().toISOString().slice(0, 10));
  }

  async function handleAdd() {
    const amt = parseFloat(amount);
    if (!date) return toast.error("Date is required");
    if (!name.trim()) return toast.error("Expense name is required");
    if (!category) return toast.error("Pick a category");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!paidBy.trim()) return toast.error("Paid by is required");
    setSaving(true);
    const { error } = await supabase.from("ram_expenses").insert({
      expense_date: date,
      name: name.trim(),
      category,
      amount: amt,
      paid_by: paidBy.trim(),
    });
    setSaving(false);
    if (error) return toast.error("Failed to save expense");
    toast.success("Expense saved");
    resetForm();
    load();
  }

  function openEdit(e: RamExpense) {
    setEditing(e);
    setEditDate(e.expense_date);
    setEditName(e.name);
    setEditCategory(e.category);
    setEditAmount(String(e.amount));
    setEditPaidBy(e.paid_by);
  }

  async function handleEditSave() {
    if (!editing) return;
    const amt = parseFloat(editAmount);
    if (!editDate || !editName.trim() || !editCategory || !amt || amt <= 0 || !editPaidBy.trim()) {
      return toast.error("All fields are required with a valid amount");
    }
    const { error } = await supabase.from("ram_expenses").update({
      expense_date: editDate,
      name: editName.trim(),
      category: editCategory,
      amount: amt,
      paid_by: editPaidBy.trim(),
    }).eq("id", editing.id);
    if (error) return toast.error("Failed to update expense");
    toast.success("Expense updated");
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    const { error } = await supabase.from("ram_expenses").delete().eq("id", id);
    if (error) return toast.error("Failed to delete expense");
    toast.success("Expense deleted");
    load();
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthRows = useMemo(() => rows.filter((r) => r.expense_date >= monthStart), [rows, monthStart]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const r of monthRows) {
      const cur = map.get(r.category) ?? { total: 0, count: 0 };
      cur.total += r.amount;
      cur.count += 1;
      map.set(r.category, cur);
    }
    return CATEGORIES.map((c) => ({ category: c, ...(map.get(c) ?? { total: 0, count: 0 }) }));
  }, [monthRows]);

  const monthTotal = monthRows.reduce((s, r) => s + r.amount, 0);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => !categoryFilter || r.category === categoryFilter);
    list.sort((a, b) => {
      const cmp = sortKey === "date"
        ? a.expense_date.localeCompare(b.expense_date)
        : a.amount - b.amount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, categoryFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function exportCsv() {
    const header = ["Date", "Expense Name", "Category", "Amount", "Paid By"];
    const lines = filtered.map((r) =>
      [r.expense_date, r.name, r.category, r.amount.toFixed(2), r.paid_by]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ram-auto-expenses.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const badge = (cat: string) =>
    `rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[cat]?.badge ?? "bg-muted text-muted-foreground"}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Dark branded header */}
      <header className="rounded-xl bg-zinc-950 px-6 py-8 text-zinc-50">
        <div className="flex items-center gap-4">
          <img src={logoUrl} alt="RAM Auto Group logo" className="h-12 w-12 rounded-md object-cover" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RAM Auto Group</h1>
            <p className="text-sm text-zinc-400">Monthly expense input &amp; analytics</p>
          </div>
        </div>
      </header>

      <main className="space-y-6">
        {/* Input form */}
        <Card>
          <CardHeader><CardTitle className="text-base">Add expense</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label className="mb-1.5 block text-xs">Date *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Expense name *</Label>
                <Input placeholder="e.g. Shop supplies" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Category *</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Amount paid *</Label>
                <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                  value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Paid by *</Label>
                <Input placeholder="e.g. Mike" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} />
              </div>
            </div>
            <Button className="mt-4" onClick={handleAdd} disabled={saving}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><Plus className="mr-2 h-4 w-4" />Add expense</>}
            </Button>
          </CardContent>
        </Card>

        {/* Category breakdown — this month */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })} breakdown by category
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {byCategory.map(({ category: c, total, count }) => (
              <Card key={c} className={`border-l-4 ${CATEGORY_STYLE[c].accent}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className={badge(c)}>{c}</span>
                    <span className="text-xs text-muted-foreground">{count} {count === 1 ? "entry" : "entries"}</span>
                  </div>
                  <div className="mt-2 text-xl font-bold">{fmtMoney(total)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Expense list */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">All expenses ({filtered.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-1.5 h-4 w-4" />CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button className="flex items-center gap-1" onClick={() => toggleSort("date")}>Date <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                  <TableHead>Expense Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right"><button className="ml-auto flex items-center gap-1" onClick={() => toggleSort("amount")}>Amount <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                  <TableHead>Paid By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No expenses yet — add your first one above.</TableCell></TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap">{fmtDate(r.expense_date)}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><span className={badge(r.category)}>{r.category}</span></TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(r.amount)}</TableCell>
                    <TableCell className="text-sm">{r.paid_by}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(r.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Grand totals */}
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total expenses — {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
              <p className="text-3xl font-bold">{fmtMoney(monthTotal)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entries this month</p>
              <p className="text-3xl font-bold">{monthRows.length}</p>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Edit modal */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Expense name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Category</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Amount paid</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Paid by</Label>
              <Input value={editPaidBy} onChange={(e) => setEditPaidBy(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleEditSave}>Save changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
