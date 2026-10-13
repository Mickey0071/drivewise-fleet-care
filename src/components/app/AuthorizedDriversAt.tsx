import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { listAuthorizedDriversAt } from "@/lib/additional-drivers.functions";

/** Approved additional drivers authorized on a rental on a given date. */
export function AuthorizedDriversAt({ rentalId, date }: { rentalId: string; date: string }) {
  const fn = useServerFn(listAuthorizedDriversAt);
  const { data } = useQuery({
    queryKey: ["authorized-drivers", rentalId, date],
    queryFn: () => fn({ data: { rentalId, date: date || undefined } }),
    enabled: !!rentalId && !rentalId.startsWith("LEGACY:"),
  });
  if (!data?.length) return null;
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> Also authorized to drive on this date
      </div>
      {data.map((d) => (
        <div key={d.id}>
          <span className="font-medium">{d.fullName}</span>
          <span className="text-xs text-muted-foreground"> · {d.phone || "no phone"} · {d.license || "no license"}{d.status === "revoked" ? " · since revoked" : ""}</span>
        </div>
      ))}
      <p className="mt-1 text-xs text-muted-foreground">Additional driver addendum will be included in the dispute packet.</p>
    </div>
  );
}
