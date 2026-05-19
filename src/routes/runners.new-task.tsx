import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { NewTaskDialog } from "@/components/app/NewTaskDialog";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/runners/new-task")({
  head: () => ({ meta: [{ title: "New Task — Camauto Rentals" }] }),
  component: NewTaskPage,
});

function NewTaskPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Task" subtitle="Dispatch a task to a runner" />
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-6">
          <p className="text-sm text-muted-foreground">Fill in the task details and send it to a runner.</p>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Open dispatch form</Button>
        </CardContent>
      </Card>
      <NewTaskDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) navigate({ to: "/runners/tasks" });
        }}
        onCreated={() => navigate({ to: "/runners/tasks" })}
      />
    </div>
  );
}