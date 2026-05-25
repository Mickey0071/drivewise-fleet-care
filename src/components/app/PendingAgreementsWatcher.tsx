import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getPendingAgreementAlerts } from "@/lib/pending-agreements-watch.functions";
import { refreshStoreFromCloud } from "@/lib/mock/store";
import { useAuth } from "@/hooks/use-auth";

type Alert = { rentalId: string; driverName: string; vehicleLabel: string; signedAt: string | null };

const SEEN_KEY = "agreement-alert-seen-ids";
const REMIND_KEY = "agreement-alert-remind-later-ids";

function readSet(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function writeSet(key: string, set: Set<string>) {
  try { sessionStorage.setItem(key, JSON.stringify(Array.from(set))); } catch {}
}

export function PendingAgreementsWatcher() {
  const { session, role } = useAuth();
  const enabled = !!session && (role === "admin" || role === "runner" || role === "va");

  const fetchFn = useServerFn(getPendingAgreementAlerts);
  const { data } = useQuery({
    queryKey: ["pending-agreement-alerts"],
    queryFn: () => fetchFn(),
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const items: Alert[] = data?.items ?? [];
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();

  const [activeId, setActiveId] = useState<string | null>(null);
  const lastIdsRef = useRef<string>("");

  // Detect newly-arrived pending agreements and surface a popup + toast.
  useEffect(() => {
    if (!enabled) return;
    const idsKey = items.map((i) => i.rentalId).sort().join(",");
    if (idsKey === lastIdsRef.current) return;
    const prevHadIds = lastIdsRef.current.length > 0;
    lastIdsRef.current = idsKey;

    const seen = readSet(SEEN_KEY);
    const reminded = readSet(REMIND_KEY);
    const fresh = items.filter((i) => !seen.has(i.rentalId) && !reminded.has(i.rentalId));

    if (fresh.length === 0) return;
    // Pull latest rentals into the in-memory store so the dashboard banner + counts update.
    refreshStoreFromCloud().catch(() => { /* non-fatal */ });

    // Toast + popup only if this wasn't the initial load OR if we genuinely just appeared.
    // (Always toast — admin missed it if they were elsewhere.)
    const first = fresh[0];
    if (prevHadIds || fresh.length > 0) {
      toast.message("New rental agreement signed", {
        description: `${first.driverName} · ${first.vehicleLabel}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ""}`,
        action: { label: "Review", onClick: () => navigate({ to: "/pending-agreements" }) },
        duration: 10000,
      });
    }
    if (!activeId) setActiveId(first.rentalId);
    // Mark them as seen so we don't re-toast on every poll.
    fresh.forEach((f) => seen.add(f.rentalId));
    writeSet(SEEN_KEY, seen);
  }, [items, enabled, activeId, navigate]);

  const active = useMemo(() => items.find((i) => i.rentalId === activeId) ?? null, [items, activeId]);
  const count = items.length;

  const closeModal = useCallback(() => setActiveId(null), []);
  const remindLater = useCallback(() => {
    if (active) {
      const reminded = readSet(REMIND_KEY);
      reminded.add(active.rentalId);
      writeSet(REMIND_KEY, reminded);
    }
    setActiveId(null);
  }, [active]);
  const reviewNow = useCallback(() => {
    setActiveId(null);
    navigate({ to: "/pending-agreements" });
  }, [navigate]);

  if (!enabled) return null;

  const showFloating = count > 0 && path !== "/" && path !== "/pending-agreements";

  return (
    <>
      {showFloating && (
        <button
          type="button"
          onClick={() => navigate({ to: "/pending-agreements" })}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-amber-500/60 bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:bg-amber-600"
          aria-label={`${count} agreements pending review`}
        >
          <Bell className="h-4 w-4" />
          {count} pending review
        </button>
      )}

      <Dialog open={!!active} onOpenChange={(o) => { if (!o) closeModal(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-amber-500" />
              New Rental Agreement — Review Required
            </DialogTitle>
            <DialogDescription>
              A new agreement from <strong>{active?.driverName}</strong> is awaiting your review.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div><span className="text-muted-foreground">Renter:</span> {active?.driverName}</div>
            <div><span className="text-muted-foreground">Vehicle:</span> {active?.vehicleLabel}</div>
            {active?.signedAt && (
              <div><span className="text-muted-foreground">Signed:</span> {new Date(active.signedAt).toLocaleString()}</div>
            )}
            {count > 1 && (
              <div className="mt-2 text-xs text-amber-600">+{count - 1} more pending review</div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={remindLater}>Remind Later</Button>
            <Button onClick={reviewNow}>Review Now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}