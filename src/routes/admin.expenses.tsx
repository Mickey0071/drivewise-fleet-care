import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { expenses, vehicleById, fmtMoney, fmtDate, type Expense } from "@/lib/mock/data";
import { deleteExpense, useStoreVersion } from "@/lib/mock/store";
import { useAuth } from "@/hooks/use-auth";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import { ExpenseDialog } from "@/components/app/ExpenseDialog";
import { ExpenseReportDialog } from "@/components/app/ExpenseReportDialog";
import { Plus, FileText, Pencil, Trash2, Settings2, ArrowUpDown } from "lucide-react";

export const Route = createFileRoute("/admin/expenses")({
  head: () => ({ meta: [{ title: "Expense Tracker — Camauto Rentals" }] }),
  component: ExpensesAdminPage,
});

type RangeTab = "all" | "month" | "year" | "custom";
type SortKey = "date" | "amount" | "category";

function ExpensesAdminPage() {
  useStoreVersion();
  const { role } = useAuth();
  const { categories } = useExpenseCategories();
  const [rangeTab, setRangeTab] = useState<RangeTab>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const yearStart = `${now.getFullYear()}-01-01`;

  const inRange = (d: string) => {
    if (rangeTab === "month") return d >= monthStart;
    if (rangeTab === "year") return d >= yearStart;
    if (rangeTab === "custom") {
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = expenses.filter((e) => {
      if (!inRange(e.date)) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (q) {
        const hay = `${e.vendor ?? ""} ${e.notes ?? ""} ${e.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "amount") cmp = a.amount - b.amount;
      else cmp = a.category.localeCompare(b.category);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter, rangeTab, from, to, sortKey, sortDir]);

  const stats = useMemo(() => {
    const thisMonth = expenses.filter((e) => e.date >= monthStart);
    const monthTotal = thisMonth.reduce((s, e) => s + e.amount, 0);
    const byCat = new Map<string, number>();
    for (const e of thisMonth) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
    let topCat = "—"; let topVal = 0;
    for (const [c, v] of byCat) if (v > topVal) { topVal = v; topCat = c; }
    const vehTied = thisMonth.filter((e) => e.vehicleId).reduce((s, e) => s + e.amount, 0);
    return { monthTotal, topCat, topVal, vehTied, general: monthTotal - vehTied };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.length, rangeTab]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (role !== "admin") {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Expense Tracker"
        subtitle="Log, categorize, and report every business expense"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/expense-categories"><Settings2 className="mr-1.5 h-4 w-4" />Categories</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
              <FileText className="mr-1.5 h-4 w-4" />Generate Report
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Add Expense
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">This Month Expenses</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{fmtMoney(stats.monthTotal)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Top Category</CardTitle></CardHeader>
          <CardContent><span className="text-lg font-bold">{stats.topCat}</span> <span className="text-sm text-muted-foreground">({fmtMoney(stats.topVal)})</span></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Vehicle-Tied / General</CardTitle></CardHeader>
          <CardContent className="text-sm"><span className="font-bold">{fmtMoney(stats.vehTied)}</span> tied · <span className="font-bold">{fmtMoney(stats.general)}</span> general</CardContent></Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <Tabs value={rangeTab} onValueChange={(v) => setRangeTab(v as RangeTab)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
              <TabsTrigger value="year">This Year</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            {rangeTab === "custom" && (
              <>
                <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <Input placeholder="Search vendor / description…" className="w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><button className="flex items-center gap-1" onClick={() => toggleSort("date")}>Date <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead><button className="flex items-center gap-1" onClick={() => toggleSort("category")}>Category <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead className="text-right"><button className="flex items-center gap-1" onClick={() => toggleSort("amount")}>Amount <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No expenses found.</TableCell></TableRow>
              )}
              {filtered.map((e) => {
                const v = e.vehicleId ? vehicleById(e.vehicleId) : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                    <TableCell><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{e.category}</span></TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(e.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {v ? <Link to="/fleet/$vehicleId" params={{ vehicleId: v.id }} className="text-primary hover:underline">{v.plate}</Link> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{e.vendor ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{e.notes ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(e); setDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => { if (confirm("Delete this expense?")) deleteExpense(e.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ExpenseDialog open={dialogOpen} onOpenChange={setDialogOpen} expense={editing} />
      <ExpenseReportDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}