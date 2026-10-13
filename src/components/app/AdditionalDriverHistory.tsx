import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAdditionalDriverHistoryByLicense } from "@/lib/additional-drivers.functions";

/** Links a renter to past additional-driver records by license number. */
export function AdditionalDriverHistory({ licenseNumber }: { licenseNumber: string }) {
  const fn = useServerFn(listAdditionalDriverHistoryByLicense);
  const { data } = useQuery({
    queryKey: ["ad-history", licenseNumber],
    queryFn: () => fn({ data: { licenseNumber } }),
    enabled: licenseNumber.trim().length >= 3,
  });
  if (!data?.length) return null;
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <h3 className="text-[13px] font-medium text-foreground">History as an additional driver</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {data.map((r) => (
          <li key={r.id} className="flex justify-between gap-2">
            <span>Rental {r.rentalId}</span>
            <span className="text-xs capitalize text-muted-foreground">{r.status}{r.submittedAt ? ` · ${new Date(r.submittedAt).toLocaleDateString()}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
