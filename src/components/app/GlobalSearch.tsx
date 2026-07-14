import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Car, Users, FileText, DollarSign, Wrench, AlertTriangle, Receipt, Banknote, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { activeVehicles, drivers, rentals } from "@/lib/mock/data";

const navItems = [
  { label: "Dashboard", to: "/", icon: TrendingUp },
  { label: "Fleet", to: "/fleet", icon: Car },
  { label: "Drivers", to: "/drivers", icon: Users },
  { label: "Reservations", to: "/rentals", icon: FileText },
  { label: "Payments", to: "/payments", icon: DollarSign },
  { label: "Maintenance", to: "/maintenance", icon: Wrench },
  { label: "Violations", to: "/violations", icon: AlertTriangle },
  { label: "Expenses", to: "/expenses", icon: Receipt },
  { label: "Payroll", to: "/payroll", icon: Banknote },
  { label: "P&L", to: "/pnl", icon: TrendingUp },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => { setOpen(false); navigate({ to }); };

  return (
    <>
      <Button
        variant="outline" size="sm"
        onClick={() => setOpen(true)}
        className="hidden sm:inline-flex h-8 gap-2 px-2 text-xs text-muted-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        Search…
        <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </Button>
      <Button
        variant="ghost" size="icon"
        onClick={() => setOpen(true)}
        className="sm:hidden"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search vehicles, drivers, reservations, pages…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Pages">
            {navItems.map((i) => (
              <CommandItem key={i.to} onSelect={() => go(i.to)}>
                <i.icon className="mr-2 h-4 w-4" />{i.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Vehicles">
            {activeVehicles().map((v) => (
              <CommandItem
                key={v.id}
                value={`${v.id} ${v.make} ${v.model} ${v.plate}`}
                onSelect={() => go(`/fleet/${v.id}`)}
              >
                <Car className="mr-2 h-4 w-4" />
                {v.year} {v.make} {v.model} · {v.id} · {v.plate}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Drivers">
            {drivers.map((d) => (
              <CommandItem
                key={d.id}
                value={`${d.id} ${d.fullName} ${d.phone}`}
                onSelect={() => go(`/drivers`)}
              >
                <Users className="mr-2 h-4 w-4" />
                {d.fullName} · {d.id}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Reservations">
            {rentals.map((r) => (
              <CommandItem
                key={r.id}
                value={`${r.id} ${r.vehicleId} ${r.driverId}`}
                onSelect={() => go(`/rentals`)}
              >
                <FileText className="mr-2 h-4 w-4" />
                {r.id} · {r.vehicleId} → {r.driverId}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
