import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/analytics/profitability")({
  head: () => ({ meta: [{ title: "Profitability — Analytics — Camauto Rentals" }] }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader title="📊 Profitability" subtitle="Detailed analytics" />
      <Card>
        <CardContent className="flex min-h-[240px] flex-col items-center justify-center text-center">
          <p class_="text-lg font-semibold text-foreground">Coming soon</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This detailed breakdown is being built next. Check back shortly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
