import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
  const { rental_id: rentalId } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!rentalId) return;
    const t = setTimeout(() => {
      navigate({ to: "/rent/portal/$rentalId", params: { rentalId } });
    }, 5000);
    return () => clearTimeout(t);
  }, [rentalId, navigate]);

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
          color: "#16a34a",
          fontSize: "1.75rem",
          fontWeight: 600,
          textAlign: "center",
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        Thank you for choosing Camauto Rentals
      </h1>
      {rentalId && (
        <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0, textAlign: "center" }}>
          Taking you to your reservation…
        </p>
      )}
    </div>
  );
}