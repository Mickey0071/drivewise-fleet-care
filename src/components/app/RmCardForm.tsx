import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Car, Gauge, CalendarClock, AlertTriangle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RmFormItem {
  type: string;
  customId?: string;
  label: string;
  due?: string;
  status: "Pass" | "Fail" | "";
  notes: string;
}

export function RmCardForm({
  vehicleLabel,
  plate,
  mileage,
  lastRmText,
  items,
  onStatus,
  onNotes,
  inspectorName,
  inspectorPhone,
  setInspectorName,
  setInspectorPhone,
  inspectorReadOnly,
  overallNotes,
  setOverallNotes,
}: {
  vehicleLabel: string;
  plate?: string;
  mileage?: number | null;
  lastRmText: string;
  items: RmFormItem[];
  onStatus: (idx: number, status: "Pass" | "Fail") => void;
  onNotes: (idx: number, notes: string) => void;
  inspectorName: string;
  inspectorPhone: string;
  setInspectorName: (v: string) => void;
  setInspectorPhone: (v: string) => void;
  inspectorReadOnly?: boolean;
  overallNotes: string;
  setOverallNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Vehicle info bar */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <div className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{mileage != null ? `${Number(mileage).toLocaleString()} mi` : "—"}</span>
        </div>
        <div className="col-span-2 flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lastRmText}</span>
        </div>
      </div>

      {/* Scheduled items */}
      <div className="space-y-3">
        {items.map((it, idx) => (
          <div key={`${it.type}-${it.customId ?? idx}`} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{it.label}</div>
                {it.due && <div className="text-xs text-muted-foreground">{it.due}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={it.status === "Pass" ? "default" : "outline"}
                  className={cn("h-8 px-3", it.status === "Pass" && "bg-green-600 hover:bg-green-600/90")}
                  onClick={() => onStatus(idx, "Pass")}
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Pass
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={it.status === "Fail" ? "destructive" : "outline"}
                  className="h-8 px-3"
                  onClick={() => onStatus(idx, "Fail")}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Fail
                </Button>
              </div>
            </div>
            <Input
              className="mt-2 h-8 text-xs"
              placeholder="Notes (optional)"
              value={it.notes}
              maxLength={500}
              onChange={(e) => onNotes(idx, e.target.value)}
            />
            {it.status === "Fail" && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Will create repair issue on submit
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No scheduled maintenance items configured for this vehicle.
          </p>
        )}
      </div>

      {/* Inspector */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Inspector name</Label>
          <Input
            className="mt-1 h-8"
            value={inspectorName}
            readOnly={inspectorReadOnly}
            onChange={(e) => setInspectorName(e.target.value)}
            placeholder="e.g. John Smith"
          />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input
            className="mt-1 h-8"
            type="tel"
            value={inspectorPhone}
            readOnly={inspectorReadOnly}
            onChange={(e) => setInspectorPhone(e.target.value)}
            placeholder="(267) 555-1234"
          />
        </div>
      </div>

      {/* Overall notes */}
      <div>
        <Label className="text-xs">Additional observations</Label>
        <Textarea
          className="mt-1 min-h-[60px] text-sm"
          value={overallNotes}
          maxLength={2000}
          onChange={(e) => setOverallNotes(e.target.value)}
          placeholder="Overall notes…"
        />
      </div>
    </div>
  );
}
