import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — Camauto Runner Hub" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, role, signOut } = useAuth();
  const savedName = typeof window !== "undefined" ? localStorage.getItem("inspector_name") || "" : "";
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Profile</h1>
      <Card>
        <CardContent className="space-y-4 py-6">
          <Row label="Name" value={savedName || "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row label="Role" value={role ?? "—"} />
          <div className="pt-2">
            <Button variant="outline" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}