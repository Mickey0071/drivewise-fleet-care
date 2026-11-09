import { createFileRoute } from "@tanstack/react-router";
import { RtoWorkspace } from "@/components/app/RtoWorkspace";

export const Route = createFileRoute("/rent-to-own")({
  head: () => ({ meta: [
    { title: "Rent To Own — Camauto Rentals" },
    { name: "description", content: "Create, send, sign and collect payments on rent-to-own agreements." },
    { property: "og:title", content: "Rent To Own — Camauto Rentals" },
    { property: "og:description", content: "Create, send, sign and collect payments on rent-to-own agreements." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: RtoWorkspace,
});

