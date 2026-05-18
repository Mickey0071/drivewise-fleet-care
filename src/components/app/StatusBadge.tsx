import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const toneClasses: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/20 text-warning-foreground border-warning/40",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
};

const map: Record<string, Tone> = {
  available: "success", paid: "success", current: "success", active: "success", sent: "success",
  rented: "info", "check-in": "info", "check-out": "info",
  maintenance: "warning", late: "warning", pending: "warning", contested: "warning", draft: "warning", inspection: "warning",
  impound: "danger", missed: "danger", defaulted: "danger", suspended: "danger", failed: "danger",
  inactive: "muted", approved: "info",
};

const labelOverrides: Record<string, string> = {
  inspection: "Inspection Pending",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const key = status.toLowerCase();
  const tone = map[key] ?? "muted";
  const label = labelOverrides[key] ?? status;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", toneClasses[tone], className)}>
      {label}
    </span>
  );
}
