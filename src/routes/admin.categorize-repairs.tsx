import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { maintenance, vehicleById } from "@/lib/mock/data";
import { useStoreVersion, updateMaintenance } from "@/lib/mock/store";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/admin/categorize-repairs")({
  head: () => ({ meta: [{ title: "Categorize Repairs — Camauto Rentals" }] }),
  component: CategorizeRepairsPage,
});

function CategorizeRepairsPage() {
  useStoreVersion();
  const { role } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (role !== "admin") {
    return (
      <div>
        <PageHeader title="Categorize Repairs" subtitle="Admin only" />
        <p className="text-sm text-muted-foreground">You need admin access to use this page.</p>
      </div>
    );
  }

  const uncategorized = maintenance
    .filter((m) => !m.problemCategory)
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));

  function save(id: string) {
    const cat = drafts[id];
    if (!cat) return toast.error("Pick a category first");
    updateMaintenance(id, { problemCategory: cat });
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    toast.success("Category assigned");
  }

  return (
    <div>
      <PageHeader
        title="Categorize Repairs"
        subtitle={`${uncategorized.length} uncategorized record${uncategorized.length === 1 ? "" : "s"} — assign a problem category to each`}
      />

      {uncategorized.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            All maintenance records have a problem category.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {uncategorized.map((m) => {
            const v = vehicleById(m.vehicleId);
            const name = v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : m.vehicleId;
            const detail = m.issueDescription ?? m.serviceType;
            return (
              <Card key={m.id}>
                <CardContent className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {name}
                      <Badge variant="secondary" className="text-[10px]">{m.id}</Badge>
                      {m.status && <Badge variant="outline" className="text-[10px]">{m.status}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{detail}</div>
                  </div>
                  <div className="flex items-center gap-2 md:w-80">
                    <div className="flex-1">
                      <ProblemCategorySelect
                        value={drafts[m.id] ?? ""}
                        onChange={(val) => setDrafts((d) => ({ ...d, [m.id]: val }))}
                      />
                    </div>
                    <Button size="sm" onClick={() => save(m.id)} disabled={!drafts[m.id]}>Save</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
