import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CHECKLIST = [
  "Exterior wash & dry",
  "Interior vacuum",
  "Wipe down dash, console, doors",
  "Trash removed",
  "Fuel tank ≥ 3/4 full",
  "Tire pressure all 4 (32–35 PSI)",
  "All fluids topped (oil, washer, coolant)",
  "Wipers + lights working",
  "Registration & insurance card in glovebox",
  "Phone charger cable in console",
  "Two key fobs ready",
  "Walkaround photos uploaded",
];

export function PreRentalChecklist() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const allDone = done.size === CHECKLIST.length;

  function toggle(i: number) {
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" /> Runner pre-rental checklist
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Complete every item before the vehicle is handed off. {done.size}/{CHECKLIST.length} done.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {CHECKLIST.map((item, i) => {
          const checked = done.has(i);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition",
                checked ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {checked && <Check className="h-3.5 w-3.5" />}
              </div>
              <span className={cn(checked && "text-muted-foreground line-through")}>{item}</span>
            </button>
          );
        })}
        <Button
          className="w-full"
          disabled={!allDone}
          onClick={() => {
            toast.success("Vehicle ready for handoff");
            setDone(new Set());
          }}
        >
          Mark vehicle ready
        </Button>
      </CardContent>
    </Card>
  );
}
