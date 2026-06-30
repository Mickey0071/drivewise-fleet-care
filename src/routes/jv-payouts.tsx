import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jv-payouts")({
  head: () => ({
    meta: [
      { title: "JV Payouts — Camauto Rentals" },
      { name: "description", content: "Joint venture payouts overview." },
    ],
  }),
  component: JvPayoutsPage,
});

function JvPayoutsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">JV Payouts</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Joint venture payouts will appear here. This section is coming soon.
      </p>
    </div>
  );
}
