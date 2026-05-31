import { useEffect, useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Vendor {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function VendorCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, phone, address")
      .order("name", { ascending: true });
    if (error) return;
    setVendors((data ?? []) as Vendor[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const names = vendors.map(v => v.name);
  const trimmed = search.trim();
  const exists = names.some(o => o.toLowerCase() === trimmed.toLowerCase());

  const startCreate = () => {
    setNewName(trimmed);
    setNewAddress("");
    setNewPhone("");
    setCreating(true);
  };

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) return toast.error("Enter a vendor name");
    if (names.some(o => o.toLowerCase() === name.toLowerCase()))
      return toast.error("That vendor already exists");
    setSaving(true);
    const { error } = await supabase.from("vendors").insert({
      name,
      phone: newPhone.trim() || null,
      address: newAddress.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Added "${name}"`);
    await load();
    onChange(name);
    setCreating(false);
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCreating(false); setSearch(""); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal">
          {value || "Select vendor"}
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
                  <span className="px-3 text-sm text-muted-foreground">No vendors</span>
                )}
              </CommandEmpty>
              <CommandGroup>
                {names.map(o => (
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
              <Label className="text-xs">Vendor name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. XYZ Auto Repair" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Address</Label>
              <Input value={newAddress} onChange={e => setNewAddress(e.target.value)} placeholder="123 Main St" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="856-842-6885"
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