import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reservations")({
  beforeLoad: () => {
    throw redirect({ to: "/rentals" });
  },
});
