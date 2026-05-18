import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Rabbit } from "lucide-react";

export const Route = createFileRoute("/my-tasks")({
  head: () => ({ meta: [{ title: "My Tasks — Camauto Runner Hub" }] }),
  component: MyTasksPage,
});

function MyTasksPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">My Tasks</h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Rabbit className="h-10 w-10 text-muted-foreground" />
          <p className="text-base font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground">Your assigned tasks will appear here.</p>
        </CardContent>
      </Card>
    </div>
  );
}