import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { AuthProvider, useAuth, type AppRole } from "@/hooks/use-auth";
import { hydrateFromCloud, isStoreHydrated, useStoreVersion } from "@/lib/mock/store";

const ROUTE_ROLES: { prefix: string; roles: AppRole[] }[] = [
  { prefix: "/staff-portal", roles: ["admin", "runner"] },
  { prefix: "/driver-portal", roles: ["admin", "driver"] },
  { prefix: "/runner-reports", roles: ["admin"] },
  { prefix: "/payroll", roles: ["admin"] },
  { prefix: "/pnl", roles: ["admin"] },
  { prefix: "/expenses", roles: ["admin"] },
];
const PUBLIC_ROUTES = ["/login", "/sign", "/rent"];

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Camauto Rentals — Fleet Management" },
      { name: "description", content: "Fleet rental management for rideshare and gig drivers." },
      { name: "author", content: "Camauto Rentals" },
      { property: "og:title", content: "Camauto Rentals — Fleet Management" },
      { property: "og:description", content: "Fleet rental management for rideshare and gig drivers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Camauto Rentals — Fleet Management" },
      { name: "twitter:description", content: "Fleet rental management for rideshare and gig drivers." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2245abd9-6472-43cb-a241-7ca25daec2b5/id-preview-bf100e4e--d41d3e7e-f5b7-4980-b1e7-d2e263f62d74.lovable.app-1778812342388.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2245abd9-6472-43cb-a241-7ca25daec2b5/id-preview-bf100e4e--d41d3e7e-f5b7-4980-b1e7-d2e263f62d74.lovable.app-1778812342388.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/jpeg", href: "/favicon.jpg" },
      { rel: "apple-touch-icon", href: "/favicon.jpg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { session, role, loading } = useAuth();
  useStoreVersion();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const isPublic = PUBLIC_ROUTES.some(p => path.startsWith(p));

  useEffect(() => {
    if (loading || !session) return;
    hydrateFromCloud().catch((error) => {
      console.error(error);
    });
  }, [loading, session]);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) navigate({ to: "/login" });
  }, [loading, session, isPublic, navigate]);

  useEffect(() => {
    if (loading || !session || !role) return;
    const guard = ROUTE_ROLES.find(g => path.startsWith(g.prefix));
    if (guard && !guard.roles.includes(role)) {
      const home = role === "driver" ? "/driver-portal" : role === "runner" ? "/staff-portal" : "/";
      navigate({ to: home });
    }
    // Drivers/runners shouldn't see the admin dashboard
    if (path === "/" && role === "driver") navigate({ to: "/driver-portal" });
    if (path === "/" && role === "runner") navigate({ to: "/staff-portal" });
  }, [loading, session, role, path, navigate]);

  if (loading || (!!session && !isPublic && !isStoreHydrated())) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (isPublic) return <Outlet />;
  if (!session) return null;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success" />
              <span className="text-xs text-muted-foreground">Signed in as {role ?? "—"}</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <GlobalSearch />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}
