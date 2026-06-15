import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/backfill-plates")({
  head: () => ({ meta: [{ title: "Plate Backfill Preview — Camauto Rentals" }] }),
  component: BackfillPlatesPage,
});

// ---------------------------------------------------------------------------
// Reference mapping: CUSTOMER | PICKUP (MM/DD/YYYY) | RETURN (MM/DD/YYYY) | PLATE
// READ-ONLY preview. Nothing here writes to the database.
// ---------------------------------------------------------------------------
const RAW_MAPPING = `
Nicole Campbell | 05/24/2026 | 05/31/2026 | XPRX21
Janai Allen | 05/23/2026 | 06/06/2026 | S80WST
Cheyenne Roberts | 05/21/2026 | 05/28/2026 | AB1234
Larry Purvis | 05/18/2026 | 06/01/2026 | A26WXY
Nicole Campbell | 05/15/2026 | 05/22/2026 | S92WST
Erik Miller | 02/07/2026 | 02/10/2026 | F13UJV
Tory Sanders | 05/11/2026 | 06/01/2026 | XPSD76
Quran Holmes | 10/31/2025 | 01/31/2026 | XPSD74
Marshaan Campbell | 05/06/2026 | 05/22/2026 | XPRX21
Hermel Quinde | 05/02/2026 | 05/04/2026 | S92WST
Qwamir Jenkins | 09/12/2025 | 09/26/2025 | MWC2448
Bruce Tony | 05/01/2026 | 06/05/2026 | G97WLV
Rhafi Robinson | 12/18/2025 | 05/07/2026 | S63WED
Kassan Crutchfield | 04/25/2026 | 06/06/2026 | N90VCG
Rodney Brown | 12/13/2025 | 01/10/2026 | C77WCP
Nathan Foster | 12/12/2025 | 01/02/2026 | S62WED
Shawn Martin | 04/24/2026 | 05/01/2026 | S92WST
Calieb Bey | 04/23/2026 | 05/28/2026 | A87VGU
Luther Bunting | 04/19/2026 | 05/31/2026 | S62WED
Jaden Richards | 04/18/2026 | 04/28/2026 | A26WXY
Qwamir Jenkins | 11/26/2025 | 12/03/2025 | XPRX21
Brandon Alston | 04/18/2026 | 04/25/2026 | XPSD76
Patricia McIntyre | 04/13/2026 | 05/16/2026 | MWC2448
Quran Holmes | 04/12/2026 | 06/21/2026 | XPSD74
Jaden Richards | 11/21/2025 | 12/12/2025 | S62WED
Luquisha Bunting | 04/11/2026 | 05/30/2026 | S80WST
Liz Perez | 11/16/2025 | 01/25/2026 | MVP8071
Jaden Richards | 11/12/2025 | 11/20/2025 | XPRX21
Dante Crowder | 11/01/2025 | 11/15/2025 | S62WED
Marshaan Campbell | 03/19/2026 | 04/02/2026 | XPSD76
Tyrese Goldsboro | 11/05/2025 | 11/19/2025 | N90VCG
Paul Weber | 03/19/2026 | 04/04/2026 | MWC2448
Markida Reevey | 03/15/2026 | 03/29/2026 | F13UJV
Qwamir Jenkins | 10/31/2025 | 11/14/2025 | MVP8071
Quran Holmes | 10/31/2025 | 01/02/2026 | XPSD74
Charles White | 10/24/2025 | 12/19/2025 | MWC2448
Avra Gross | 10/21/2025 | 12/09/2025 | C77WCP
Jazmyne Graves | 02/20/2026 | 03/13/2026 | MWC2448
Marvens Joseph | 10/17/2025 | 10/31/2025 | N90VCG
Chassadi Gonzalez | 10/17/2025 | 12/27/2025 | F13UJV
Markida Reevey | 02/25/2026 | 03/18/2026 | XPSD76
Jean Alexis | 02/17/2026 | 03/24/2026 | G97WLV
Qwamir Jenkins | 02/16/2026 | 02/18/2026 | MWC2448
Quran Holmes | 02/15/2026 | 04/01/2026 | XPSD74
Aazaad Moore | 02/05/2026 | 03/05/2026 | XPSD76
David Dewee | 07/07/2025 | 12/08/2025 | M42WAY
Amber Murray | 01/13/2026 | 02/03/2026 | N90VCG
Tyrese Goldsboro | 09/28/2025 | 10/05/2025 | MWC2448
Danielle McAleer | 01/08/2026 | 01/15/2026 | S63WED
Nathan Foster | 01/04/2026 | 04/12/2026 | S62WED
Nafeez Battle | 01/03/2026 | 01/10/2026 | F13UJV
Qwamir Jenkins | 09/17/2025 | 09/24/2025 | MWC2448
Erik Winborne | 09/13/2025 | 11/08/2025 | A87VGU
Donald Crisdon | 09/13/2025 | 11/08/2025 | S63WED
Derek Rivera | 11/12/2025 | 12/31/2025 | S63WED
Alimah Brown | 09/05/2025 | 10/10/2025 | XPRX21
Qwamir Jenkins | 08/30/2025 | 09/13/2025 | MWC2448
Nafisah Jefferson | 10/09/2025 | 10/30/2025 | MWC2448
Rasheem Hall | 08/29/2025 | 11/07/2025 | XPRX21
Liz Marie | 08/21/2025 | 09/18/2025 | M42WAY
Tyree Kearney | 08/13/2025 | 10/12/2025 | MVP8071
Patricia McIntyre | 08/08/2025 | 08/22/2025 | A87VGU
Tayion Ceasar | 08/04/2025 | 10/13/2025 | A87VGU
Charmaine Ford | 07/30/2025 | 08/06/2025 | N90VCG
Charles Stubs | 07/12/2025 | 07/19/2025 | F13UJV
Mike Cubbage | 07/10/2025 | 07/24/2025 | MVP8071
Khadijah Thomas | 06/25/2025 | 07/02/2025 | N90VCG
Mike Cubbage | 06/12/2025 | 07/23/2025 | MVP8071
Peter Jamieson | 06/12/2025 | 07/31/2025 | XPRX21
Mike Simpson | 06/08/2025 | 08/17/2025 | XPSD74
Vilain Varlens | 06/07/2025 | 06/14/2025 | N90VCG
Deleon Floyd | 05/09/2025 | 06/28/2025 | F13UJV
Krystal Brown | 05/06/2025 | 06/04/2025 | N90VCG
Terri Tillmon | 04/29/2025 | 05/27/2025 | XPRX21
Charles Stubs | 04/25/2025 | 06/20/2025 | M42WAY
Shaheen Myers | 04/26/2025 | 05/10/2025 | AB1234
Kiya Bates | 03/26/2025 | 04/19/2026 | A87VGU
Mike Cubbage | 03/24/2025 | 06/24/2025 | MVP8071
Maya Turner | 03/20/2025 | 07/10/2025 | MWC2448
Caron Reed | 03/19/2025 | 04/02/2025 | AB1234
Stacey Gates | 03/17/2025 | 03/24/2025 | MVP8071
Brielle Cocchi | 03/12/2025 | 04/23/2025 | M42WAY
Nicole Campbell | 03/11/2025 | 04/22/2025 | XPSD76
Quran Holmes | 02/27/2025 | 03/11/2025 | XPSD76
Mike Simpson | 01/25/2025 | 06/13/2025 | XPSD74
Coron Rush | 02/05/2025 | 03/27/2025 | F13UJV
Nicole Spratley | 12/19/2024 | 01/09/2025 | F13UJV
Amber Terrell | 12/25/2024 | 01/10/2025 | A87VGU
Kayla Offer | 12/10/2024 | 03/04/2025 | AB1234
Yolanda Payne | 11/29/2024 | 12/20/2024 | XPSD74
Brielle Cocchi | 11/28/2024 | 02/17/2025 | XPRX21
Sterling McPleasant | 12/07/2024 | 12/14/2024 | A87VGU
Aquila Thrower | 11/27/2024 | 12/21/2024 | F13UJV
`;

type MapLine = { customer: string; pickup: string; ret: string; plate: string };

// MM/DD/YYYY -> YYYY-MM-DD (calendar date, no timezone math)
function toISODate(mdy: string): string {
  const [mm, dd, yyyy] = mdy.trim().split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// timestamptz ISO string -> UTC calendar date (matches Postgres ::date used in verification)
function tsToISODate(ts: string | null): string | null {
  if (!ts) return null;
  return ts.slice(0, 10);
}

function normName(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

const MAPPING: MapLine[] = RAW_MAPPING.split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [customer, pickup, ret, plate] = l.split("|").map((p) => p.trim());
    return { customer, pickup: toISODate(pickup), ret: toISODate(ret), plate };
  });

type LegacyRow = {
  id: string;
  renter_name: string | null;
  vehicle: string | null;
  plate: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
};

type Status = "WILL UPDATE" | "ALREADY SET" | "NO TABLE ROW FOUND" | "MULTIPLE MATCHES";

type PreviewRow = {
  key: string;
  rowId: string | null;
  customer: string;
  pickup: string;
  ret: string;
  vehicle: string | null;
  currentPlate: string | null;
  proposedPlate: string;
  status: Status;
};

function statusBadge(status: Status) {
  switch (status) {
    case "WILL UPDATE":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">WILL UPDATE</Badge>;
    case "ALREADY SET":
      return <Badge variant="secondary">ALREADY SET</Badge>;
    case "MULTIPLE MATCHES":
      return <Badge className="bg-amber-500 hover:bg-amber-500">MULTIPLE MATCHES</Badge>;
    case "NO TABLE ROW FOUND":
      return <Badge variant="destructive">NO TABLE ROW FOUND</Badge>;
  }
}

function BackfillPlatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["legacy-rentals-plate-preview"],
    queryFn: async (): Promise<LegacyRow[]> => {
      const { data, error } = await supabase
        .from("legacy_rentals")
        .select("id, renter_name, vehicle, plate, start_datetime, end_datetime");
      if (error) throw new Error(error.message);
      return (data ?? []) as LegacyRow[];
    },
  });

  const { previewRows, counts, remainingNull } = useMemo(() => {
    const rows = data ?? [];
    const matchedIds = new Set<string>();

    const previewRows: PreviewRow[] = MAPPING.map((m, i) => {
      const matches = rows.filter(
        (r) =>
          normName(r.renter_name) === normName(m.customer) &&
          tsToISODate(r.start_datetime) === m.pickup &&
          tsToISODate(r.end_datetime) === m.ret,
      );

      if (matches.length === 0) {
        return {
          key: `m-${i}`,
          rowId: null,
          customer: m.customer,
          pickup: m.pickup,
          ret: m.ret,
          vehicle: null,
          currentPlate: null,
          proposedPlate: m.plate,
          status: "NO TABLE ROW FOUND" as Status,
        };
      }

      const multi = matches.length > 1;
      return matches.map((r) => {
        matchedIds.add(r.id);
        const status: Status = multi
          ? "MULTIPLE MATCHES"
          : r.plate
            ? "ALREADY SET"
            : "WILL UPDATE";
        return {
          key: `m-${i}-${r.id}`,
          rowId: r.id,
          customer: r.renter_name ?? m.customer,
          pickup: m.pickup,
          ret: m.ret,
          vehicle: r.vehicle,
          currentPlate: r.plate,
          proposedPlate: m.plate,
          status,
        };
      });
    }).flat();

    const counts = {
      willUpdate: previewRows.filter((r) => r.status === "WILL UPDATE").length,
      alreadySet: previewRows.filter((r) => r.status === "ALREADY SET").length,
      noRow: previewRows.filter((r) => r.status === "NO TABLE ROW FOUND").length,
      multiple: previewRows.filter((r) => r.status === "MULTIPLE MATCHES").length,
    };

    // Rows that stay null: currently null AND not flagged WILL UPDATE in this pass.
    const willUpdateIds = new Set(
      previewRows.filter((r) => r.status === "WILL UPDATE" && r.rowId).map((r) => r.rowId as string),
    );
    const remainingNull = rows
      .filter((r) => !r.plate && !willUpdateIds.has(r.id))
      .sort((a, b) => (b.start_datetime ?? "").localeCompare(a.start_datetime ?? ""));

    return { previewRows, counts, remainingNull };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Plate Backfill Preview"
        subtitle="Read-only — confirm these pairings. No data is written in this step."
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading legacy rentals…
        </div>
      )}

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load: {error instanceof Error ? error.message : String(error)}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Will update</p>
                <p className="text-2xl font-bold text-emerald-600">{counts.willUpdate}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Already set</p>
                <p className="text-2xl font-bold">{counts.alreadySet}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">No table row found</p>
                <p className="text-2xl font-bold text-destructive">{counts.noRow}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Multiple matches</p>
                <p className="text-2xl font-bold text-amber-600">{counts.multiple}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-6">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Pickup</TableHead>
                    <TableHead>Return</TableHead>
                    <TableHead>Vehicle (stored)</TableHead>
                    <TableHead>Current plate</TableHead>
                    <TableHead>Proposed plate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-mono text-xs">
                        {r.rowId ? r.rowId.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell>{r.customer}</TableCell>
                      <TableCell>{r.pickup}</TableCell>
                      <TableCell>{r.ret}</TableCell>
                      <TableCell>{r.vehicle ?? "—"}</TableCell>
                      <TableCell className="font-mono">{r.currentPlate ?? "—"}</TableCell>
                      <TableCell className="font-mono font-semibold">{r.proposedPlate}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mb-3">
            <h2 className="text-lg font-semibold">
              Rows that will remain with a null plate ({remainingNull.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Legacy rentals not covered by the mapping — left unmatched for now.
            </p>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Pickup</TableHead>
                    <TableHead>Return</TableHead>
                    <TableHead>Vehicle (stored)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remainingNull.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                      <TableCell>{r.renter_name ?? "—"}</TableCell>
                      <TableCell>{tsToISODate(r.start_datetime) ?? "—"}</TableCell>
                      <TableCell>{tsToISODate(r.end_datetime) ?? "—"}</TableCell>
                      <TableCell>{r.vehicle ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}