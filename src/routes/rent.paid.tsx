import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/rent/paid")({
  head: () => ({ meta: [{ title: "Thank you — Camauto Rentals" }] }),
  component: PaidPage,
});

function PaidPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
        padding: "1.5rem",
      }}
    >
      <h1
        style={{
          color: "#16a34a",
          fontSize: "2rem",
          fontWeight: 600,
          textAlign: "center",
          margin: 0,
        }}
      >
        Thank you for choosing Camauto Rentals
      </h1>
    </div>
  );
}