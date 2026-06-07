import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/camauto-logo.jpeg";

const driverTabs = [
  { to: "/my-rentals", label: "My Rentals", emoji: "🚗" },
  { to: "/profile", label: "Profile", emoji: "👤" },
] as const;

// Customer (driver) bottom-nav portal. The old runner/login portal has been removed.
export function RunnerLayout() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { signOut } = useAuth();
  const tabs = driverTabs;
  const title = "My Account";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-white p-1">
          <img src={logo} alt="Camauto" className="h-full w-full object-contain" />
        </div>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 pb-24 sm:px-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
        <ul className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => {
            const active = path === t.to || path.startsWith(t.to + "/");
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-lg leading-none">{t.emoji}</span>
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
