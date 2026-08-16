import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { drivers } from "@/lib/mock/data";
import { RenterProfileDialog } from "@/components/app/RenterProfileDialog";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare } from "lucide-react";

type Ctx = {
  openById: (driverId: string | null | undefined) => void;
  openByName: (name: string | null | undefined) => void;
  unreadByDriver: Record<string, number>;
  refreshUnread: () => void;
};

const RenterProfileCtx = createContext<Ctx | null>(null);

export function RenterProfileProvider({ children }: { children: ReactNode }) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [unreadByDriver, setUnread] = useState<Record<string, number>>({});

  const refreshUnread = useCallback(() => {
    void (async () => {
      const { data } = await supabase
        .from("renter_messages")
        .select("driver_id")
        .eq("direction", "received")
        .eq("read", false)
        .limit(1000);
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.driver_id) counts[row.driver_id] = (counts[row.driver_id] ?? 0) + 1;
      }
      setUnread(counts);
    })();
  }, []);

  useEffect(() => {
    refreshUnread();
    const id = setInterval(refreshUnread, 60_000);
    return () => clearInterval(id);
  }, [refreshUnread]);

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
      unreadByDriver,
      refreshUnread,
    }),
    [unreadByDriver, refreshUnread],
  );
  return (
    <RenterProfileCtx.Provider value={value}>
      {children}
      <RenterProfileDialog
        driverId={driverId}
        onClose={() => {
          setDriverId(null);
          refreshUnread();
        }}
      />
    </RenterProfileCtx.Provider>
  );
}

export function useRenterProfile(): Ctx {
  const ctx = useContext(RenterProfileCtx);
  if (!ctx) {
    // No-op fallback so components outside the provider (e.g. public routes)
    // stay renderable without wiring up the dialog.
    return { openById: () => {}, openByName: () => {}, unreadByDriver: {}, refreshUnread: () => {} };
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
  const { openById, openByName, unreadByDriver } = useRenterProfile();
  const label = children ?? name ?? driverId ?? "—";
  const resolvedId =
    driverId ??
    (name ? drivers.find((d) => d.fullName.toLowerCase() === name.trim().toLowerCase())?.id : undefined);
  const unread = resolvedId ? (unreadByDriver[resolvedId] ?? 0) : 0;
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
      {unread > 0 && (
        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 align-middle text-[10px] font-semibold text-primary-foreground">
          <MessageSquare className="h-2.5 w-2.5" />
          {unread}
        </span>
      )}
    </button>
  );
}