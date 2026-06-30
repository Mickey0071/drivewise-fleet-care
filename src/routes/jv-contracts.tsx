import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jv-contracts")({
  head: () => ({
    meta: [
      { title: "JV Contracts — Camauto Rentals" },
      { name: "description", content: "Joint venture contracts overview." },
    ],
  }),
  component: JvContractsPage,
});

function JvContractsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">JV Contracts</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Joint venture contracts will appear here. This section is coming soon.
      </p>
    </div>
  );
}
