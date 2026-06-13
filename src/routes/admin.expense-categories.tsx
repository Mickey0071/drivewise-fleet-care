import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { expenses } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { useAuth } from "@/hooks/use-auth";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import { Plus, Pencil, Trash2, Check, X, ArrowLeft, Lock } from "lucide-react";

export const Route = createFileRoute("/admin/expense-categories")({
  head: () => ({ meta: [{ title: "Expense Categories — Camauto Rentals" }] }),
  component: ExpenseCategoriesPage,
});

function ExpenseCategoriesPage() {
  useStoreVersion();
  const { role } = useAuth();
  const { categories, reload, ensureCategory } = useExpenseCategories();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return toast.error("Category already exists");
    }
    await ensureCategory(name);
    setNewName("");
    await reload();
    toast.success("Category added");
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    const { error } = await supabase.from("expense_categories").update({ name }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditId(null);
    await reload();
    toast.success("Category renamed");
  }

  async function remove(id: string, name: string) {
    const used = expenses.some((e) => e.category.toLowerCase() === name.toLowerCase());
    if (used) return toast.error("Cannot delete — expenses still use this category");
    if (!confirm(`Delete category "${name}"?`)) return;
    const { error } = await supabase.from("expense_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await reload();
    toast.success("Category deleted");
  }

  if (role !== "admin") {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Expense Categories"
        subtitle="Manage the categories used across the expense system"
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/expenses"><ArrowLeft className="mr-1.5 h-4 w-4" />Back to Expenses</Link>
          </Button>
        }
      />
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Add category</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="New category name" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Button onClick={add}><Plus className="mr-1.5 h-4 w-4" />Add</Button>
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-2xl">
        <CardHeader><CardTitle className="text-base">All categories ({categories.length})</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {categories.map((c) => {
            const used = expenses.some((e) => e.category.toLowerCase() === c.name.toLowerCase());
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 p-3">
                {editId === c.id ? (
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-xs" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(c.id); }} />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.isDefault && <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="h-3 w-3" />Default</Badge>}
                    {used && <span className="text-[11px] text-muted-foreground">in use</span>}
                  </div>
                )}
                <div className="flex gap-1">
                  {editId === c.id ? (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => saveEdit(c.id)}><Check className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditId(c.id); setEditName(c.name); }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                        disabled={c.isDefault || used} onClick={() => remove(c.id, c.name)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}