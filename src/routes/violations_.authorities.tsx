import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getAuthorityAddresses,
  upsertAuthorityAddress,
  type AuthorityAddress,
} from "@/lib/liability-transfer.functions";

export const Route = createFileRoute("/violations_/authorities")({
  head: () => ({ meta: [{ title: "Authority Addresses — Camauto Rentals" }] }),
  component: AuthoritiesPage,
});

function AuthoritiesPage() {
  const list = useServerFn(getAuthorityAddresses);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["authority-addresses"],
    queryFn: () => list(),
  });

  return (
    <div>
      <PageHeader
        title="Authority Addresses"
        subtitle="Mailing addresses used on liability-transfer cover letters"
        action={
          <Button variant="outline" asChild>
            <Link to="/violations">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Violations
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((a) => (
            <AuthorityCard key={a.id} authority={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AuthorityCard({ authority }: { authority: AuthorityAddress }) {
  const qc = useQueryClient();
  const save = useServerFn(upsertAuthorityAddress);
  const [name, setName] = useState(authority.name);
  const [lines, setLines] = useState(authority.address_lines ?? "");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          id: authority.id,
          key: authority.key,
          name,
          address_lines: lines,
          region: authority.region,
          is_active: authority.is_active,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["authority-addresses"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">{authority.key}</span>
          {authority.region && (
            <span className="text-xs text-muted-foreground">{authority.region}</span>
          )}
        </div>
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Mailing address (one line per row)</Label>
          <Textarea
            rows={4}
            value={lines}
            placeholder="Authority name&#10;P.O. Box ...&#10;City, ST ZIP"
            onChange={(e) => setLines(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={busy}>
            <Save className="mr-1 h-4 w-4" /> {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}