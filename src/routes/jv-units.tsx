import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jv-units")({
  head: () => ({
    meta: [
      { title: "JV Units — Camauto Rentals" },
      { name: "description", content: "Joint venture units overview." },
    ],
  }),
  component: JvUnitsPage,
});

function JvUnitsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">JV Units</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Joint venture units will appear here. This section is coming soon.
      </p>
    </div>
  );
}
