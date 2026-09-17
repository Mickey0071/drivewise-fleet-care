import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  allCategories,
  addCustomCategory,
  PROBLEM_CATEGORIES_EVENT,
} from "@/lib/problem-categories";
import { maintenance } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

/**
 * Shared dropdown for repair problem-categories. Merges the defaults with any
 * admin-added custom categories and any category already saved on a record,
 * and lets the admin create a brand-new category inline ("+ Add new…").
 */
export function ProblemCategorySelect({ value, onChange, placeholder = "Select a category", id, className }: Props) {
  useStoreVersion(); // re-render if categories-in-use change with maintenance data
  const [, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(PROBLEM_CATEGORIES_EVENT, bump);
    return () => window.removeEventListener(PROBLEM_CATEGORIES_EVENT, bump);
  }, []);

  const inUse = maintenance.map((m) => m.problemCategory);
  const options = allCategories([...inUse, value]);

  function commitNew() {
    const created = addCustomCategory(newName);
    if (!created) {
      toast.error("Enter a category name (2–60 characters)");
      return;
    }
    onChange(created);
    setNewName("");
    setAdding(false);
    toast.success(`Category "${created}" added`);
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
        <div className="border-t p-1.5">
          {adding ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitNew(); }
                  if (e.key === "Escape") { setAdding(false); setNewName(""); }
                }}
                placeholder="New category name"
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8" onClick={commitNew}>Add</Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-primary hover:bg-muted"
              onClick={(e) => { e.preventDefault(); setAdding(true); }}
            >
              <Plus className="h-3.5 w-3.5" /> Add new category…
            </button>
          )}
        </div>
      </SelectContent>
    </Select>
  );
}
