import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { X, MapPin } from "lucide-react";

export interface DamageReport {
  id: string;
  // Position as % of image (so it's responsive)
  x: number;
  y: number;
  area: string;
  description: string;
  reportedAt: string;
}

// Friendly area name from click coordinates (% of car silhouette box)
function areaFromXY(x: number, y: number): string {
  const top = y < 33;
  const bottom = y > 66;
  const left = x < 33;
  const right = x > 66;
  if (top && left) return "Front-left bumper / fender";
  if (top && right) return "Front-right bumper / fender";
  if (top) return "Hood / front";
  if (bottom && left) return "Rear-left bumper / quarter panel";
  if (bottom && right) return "Rear-right bumper / quarter panel";
  if (bottom) return "Trunk / rear";
  if (left) return "Driver-side door / panel";
  if (right) return "Passenger-side door / panel";
  return "Roof / center";
}

export function DamageMap({ vehicleLabel }: { vehicleLabel: string }) {
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [pending, setPending] = useState<{ x: number; y: number; area: string } | null>(null);
  const [desc, setDesc] = useState("");

  function onMapClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPending({ x, y, area: areaFromXY(x, y) });
    setDesc("");
  }

  function save() {
    if (!pending) return;
    if (!desc.trim()) {
      toast.error("Please describe what you see");
      return;
    }
    setReports(r => [
      ...r,
      {
        id: `DMG-${Date.now()}`,
        x: pending.x,
        y: pending.y,
        area: pending.area,
        description: desc.trim(),
        reportedAt: new Date().toISOString(),
      },
    ]);
    toast.success("Damage logged", { description: pending.area });
    setPending(null);
    setDesc("");
  }

  function remove(id: string) {
    setReports(r => r.filter(x => x.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Damage check-in</CardTitle>
        <p className="text-xs text-muted-foreground">
          Tap the spot on {vehicleLabel} where you see damage, then describe it. This protects you — anything not logged here is treated as pre-existing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onClick={onMapClick}
          className="relative mx-auto aspect-[16/9] w-full max-w-xl cursor-crosshair select-none rounded-lg border-2 border-dashed border-border bg-muted/40"
        >
          {/* Top-down car silhouette */}
          <CarTopView />
          {reports.map((r, i) => (
            <Marker key={r.id} x={r.x} y={r.y} index={i + 1} variant="saved" />
          ))}
          {pending && <Marker x={pending.x} y={pending.y} index={reports.length + 1} variant="pending" />}
        </div>

        {pending && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-medium">{pending.area}</span>
            </div>
            <Textarea
              rows={3}
              placeholder="Describe what you see (scratch, dent, crack, color/size)…"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Save spot</Button>
              <Button size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {reports.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Logged ({reports.length})</div>
            {reports.map((r, i) => (
              <div key={r.id} className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.area}</div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </div>
                <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Button
          className="w-full"
          disabled={reports.length === 0}
          onClick={() => toast.success("Damage report submitted", { description: `${reports.length} spot${reports.length === 1 ? "" : "s"} sent to operations` })}
        >
          Submit damage report
        </Button>
      </CardContent>
    </Card>
  );
}

function Marker({ x, y, index, variant }: { x: number; y: number; index: number; variant: "saved" | "pending" }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div
        className={
          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-primary-foreground shadow-lg ring-2 ring-background " +
          (variant === "saved" ? "bg-primary" : "animate-pulse bg-destructive")
        }
      >
        {index}
      </div>
    </div>
  );
}

function CarTopView() {
  return (
    <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full p-6 text-muted-foreground/40">
      {/* body */}
      <rect x="60" y="20" width="200" height="140" rx="30" ry="40" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" />
      {/* hood line */}
      <line x1="60" y1="55" x2="260" y2="55" stroke="currentColor" strokeWidth="1.5" />
      {/* windshield */}
      <path d="M80 55 L100 80 L220 80 L240 55 Z" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1" />
      {/* roof */}
      <rect x="100" y="80" width="120" height="20" fill="currentColor" opacity="0.12" />
      {/* rear window */}
      <path d="M80 125 L100 100 L220 100 L240 125 Z" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1" />
      {/* trunk line */}
      <line x1="60" y1="125" x2="260" y2="125" stroke="currentColor" strokeWidth="1.5" />
      {/* wheels */}
      <rect x="50" y="35" width="14" height="25" rx="3" fill="currentColor" opacity="0.4" />
      <rect x="256" y="35" width="14" height="25" rx="3" fill="currentColor" opacity="0.4" />
      <rect x="50" y="120" width="14" height="25" rx="3" fill="currentColor" opacity="0.4" />
      <rect x="256" y="120" width="14" height="25" rx="3" fill="currentColor" opacity="0.4" />
      {/* labels */}
      <text x="160" y="15" textAnchor="middle" fontSize="9" fill="currentColor">FRONT</text>
      <text x="160" y="175" textAnchor="middle" fontSize="9" fill="currentColor">REAR</text>
    </svg>
  );
}
