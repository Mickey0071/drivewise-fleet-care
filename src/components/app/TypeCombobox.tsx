import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  onCreate: (name: string, description: string) => Promise<unknown>;
  placeholder?: string;
  newLabel?: string;
}

export function TypeCombobox({ value, onChange, options, onCreate, placeholder = "Select item", newLabel = "type" }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const trimmed = search.trim();
  const exists = options.some(o => o.toLowerCase() === trimmed.toLowerCase());

  const startCreate = () => {
    setNewName(trimmed);
    setDescription("");
    setCreating(true);
  };

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) return toast.error(`Enter a ${newLabel} name`);
    if (options.some(o => o.toLowerCase() === name.toLowerCase()))
      return toast.error(`That ${newLabel} already exists`);
    setSaving(true);
    try {
      await onCreate(name, description.trim());
      toast.success(`Added "${name}"`);
      onChange(name);
      setCreating(false);
      setSearch("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || `Failed to save ${newLabel}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCreating(false); setSearch(""); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal">
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {!creating ? (
          <Command>
            <CommandInput placeholder="Search or type new..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty className="py-2">
                {trimmed ? (
                  <button type="button" onClick={startCreate}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-primary hover:bg-accent">
                    <Plus className="h-4 w-4" /> Create new: "{trimmed}"
                  </button>
                ) : (
                  <span className="px-3 text-sm text-muted-foreground">No results</span>
                )}
              </CommandEmpty>
              <CommandGroup>
                {options.map(o => (
                  <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false); setSearch(""); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === o ? "opacity-100" : "opacity-0")} />
                    {o}
                  </CommandItem>
                ))}
                {trimmed && !exists && (
                  <CommandItem value={`__create__${trimmed}`} onSelect={startCreate} className="text-primary">
                    <Plus className="mr-2 h-4 w-4" /> Create new: "{trimmed}"
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="grid gap-2 p-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">New {newLabel}</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Battery Replacement" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Add description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Describe this service"
                onKeyDown={e => { if (e.key === "Enter") handleSave(); }} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                <Plus className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Add"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}