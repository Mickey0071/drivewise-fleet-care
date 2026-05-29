import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/routes/rent.portal.$rentalId";

export const Route = createFileRoute("/verify-payment/$rentalId")({
  head: () => ({ meta: [{ title: "Verify & pay — Camauto Rentals" }] }),
  component: PortalPage,
});