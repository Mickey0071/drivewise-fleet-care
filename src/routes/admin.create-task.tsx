import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/admin/create-task")({
  head: () => ({ meta: [{ title: "Create Task — Camauto Rentals" }] }),
  component: CreateTaskPage,
});

function CreateTaskPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Create Task" subtitle="Assign work to your team" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-base font-medium text-foreground">
            The new task system is on the way
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            The old runner-assignment workflow has been retired. A new link-based
            task system will be available here shortly — no runner login required.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
