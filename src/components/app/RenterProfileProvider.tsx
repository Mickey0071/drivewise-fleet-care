import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { drivers } from "@/lib/mock/data";
import { RenterProfileDialog } from "@/components/app/RenterProfileDialog";

type Ctx = {
  openById: (driverId: string | null | undefined) => void;
  openByName: (name: string | null | undefined) => void;
};

const RenterProfileCtx = createContext<Ctx | null>(null);

export function RenterProfileProvider({ children }: { children: ReactNode }) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      openById: (id) => id && setDriverId(id),
      openByName: (name) => {
        if (!name) return;
        const needle = name.trim().toLowerCase();
        if (!needle) return;
        const hit = drivers.find((d) => d.fullName.toLowerCase() === needle);
        if (hit) setDriverId(hit.id);
      },
    }),
    [],
  );
  return (
    <RenterProfileCtx.Provider value={value}>
      {children}
      <RenterProfileDialog driverId={driverId} onClose={() => setDriverId(null)} />
    </RenterProfileCtx.Provider>
  );
}

export function useRenterProfile(): Ctx {
  const ctx = useContext(RenterProfileCtx);
  if (!ctx) {
    // No-op fallback so components outside the provider (e.g. public routes)
    // stay renderable without wiring up the dialog.
    return { openById: () => {}, openByName: () => {} };
  }
  return ctx;
}

/**
 * Clickable renter name that opens the shared profile dialog.
 * Stops event propagation so it can safely sit inside larger clickable rows.
 */
export function RenterName({
  driverId,
  name,
  className,
  children,
}: {
  driverId?: string | null;
  name?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const { openById, openByName } = useRenterProfile();
  const label = children ?? name ?? driverId ?? "—";
  const handle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (driverId) openById(driverId);
      else if (name) openByName(name);
    },
    [driverId, name, openById, openByName],
  );
  return (
    <button
      type="button"
      onClick={handle}
      className={
        className ??
        "cursor-pointer text-left font-medium text-foreground underline-offset-2 hover:underline"
      }
    >
      {label}
    </button>
  );
}