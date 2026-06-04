import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listMyRentals } from "@/lib/my-rentals.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ChevronRight, Car } from "lucide-react";

export const Route = createFileRoute("/my-rentals")({
  head: () => ({ meta: [{ title: "My rentals — Camauto Rentals" }] }),
  component: MyRentalsPage,
});

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

function MyRentalsPage() {
  const fetchList = useServerFn(listMyRentals);
  const [data, setData] = useState<Awaited<ReturnType<typeof listMyRentals>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchList()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [fetchList]);

  if (err) {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center">
        <p className="text-sm text-destructive">{err}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">My rentals</h1>
        <p className="text-sm text-muted-foreground">Tap any rental to see documents, billing, and inspection history.</p>
      </div>

      {data.rentals.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No rentals on file yet.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {data.rentals.map((r: any) => {
          const v = r.vehicle;
          const isReturned = !!r.returned_at || r.reservation_status === "completed";
          return (
            <Link
              key={r.id}
              to="/my-rentals/$rentalId"
              params={{ rentalId: r.id }}
              className="block"
            >
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                    {v?.image_url ? (
                      <img src={v.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Car className="h-5 w-5" /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {v ? `${v.year} ${v.make} ${v.model}` : "Vehicle"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : "—"}
                      {v?.plate ? ` · Plate ${v.plate}` : ""}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isReturned ? "bg-zinc-100 text-zinc-700" :
                    r.reservation_status === "active" ? "bg-emerald-100 text-emerald-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>
                    {isReturned ? "Completed" : (r.reservation_status ?? "pending")}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}