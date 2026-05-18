import { createFileRoute } from "@tanstack/react-router";
import logo from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/rent/paid")({
  head: () => ({ meta: [{ title: "Thank you — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    rental_id: typeof s.rental_id === "string" ? s.rental_id : undefined,
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
    canceled: typeof s.canceled === "string" ? s.canceled : undefined,
  }),
  component: PaidPage,
});

function PaidPage() {
  const { canceled } = Route.useSearch();
  const isCanceled = canceled === "1" || canceled === "true";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
        padding: "1.5rem",
        gap: "1.5rem",
      }}
    >
      <img
        src={logo}
        alt="Camauto Rentals"
        style={{ maxWidth: "320px", width: "80%", height: "auto" }}
      />
      <h1
        style={{
          color: isCanceled ? "#52525b" : "#16a34a",
          fontSize: "1.75rem",
          fontWeight: 600,
          textAlign: "center",
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        {isCanceled ? "Payment was not completed" : "Thank you for choosing Camauto"}
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0, textAlign: "center" }}>
        {isCanceled
          ? "You can close this page and request a new payment link from Camauto Rentals."
          : "Your payment has been received. You can close this page."}
      </p>
    </div>
  );
}