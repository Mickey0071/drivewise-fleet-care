import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LinkIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row { reservation_id: string; created_at: string }

/** If a maintenance ticket was created from a reservation incident,
 *  show a banner linking back to that reservation. */
export function MaintenanceReservationBanner({ maintenanceId }: { maintenanceId: string }) {
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("reservation_log")
        .select("reservation_id, created_at")
        .eq("maintenance_id", maintenanceId)
        .limit(1)
        .maybeSingle();
      if (alive) setRow((data as Row) ?? null);
    })();
    return () => { alive = false; };
  }, [maintenanceId]);

  if (!row) return null;
  return (
    <div className="flex items-center justify-between rounded-md border border-yellow-400/50 bg-yellow-500/10 px-2 py-1.5 text-[11px]">
      <span className="flex items-center gap-1 text-yellow-800 dark:text-yellow-200">
        <LinkIcon className="h-3 w-3" />
        Reported from reservation <span className="font-semibold">{row.reservation_id}</span> on{" "}
        {new Date(row.created_at).toLocaleString()}
      </span>
      <Link to="/rentals" className="text-yellow-800 underline dark:text-yellow-200">
        Open reservation
      </Link>
    </div>
  );
}