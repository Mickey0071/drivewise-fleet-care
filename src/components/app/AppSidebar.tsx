import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck, Calendar,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, UserCog, IdCard, ClipboardList, LogOut, ScrollText, RefreshCw, Shield,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { unreadReportCount, useStoreVersion } from "@/lib/mock/store";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/camauto-logo.jpeg";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; roles: AppRole[] };
const adminItems: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin"] },
  { title: "Fleet", url: "/fleet", icon: Car, roles: ["admin"] },
  { title: "Customers", url: "/drivers", icon: Users, roles: ["admin"] },
  { title: "Reservations", url: "/rentals", icon: FileText, roles: ["admin"] },
  { title: "Calendar", url: "/calendar", icon: Calendar, roles: ["admin"] },
  { title: "Payments", url: "/payments", icon: DollarSign, roles: ["admin"] },
  { title: "Inspections", url: "/inspections", icon: ClipboardCheck, roles: ["admin"] },
  { title: "Maintenance", url: "/maintenance", icon: Wrench, roles: ["admin"] },
  { title: "Violations", url: "/violations", icon: AlertTriangle, roles: ["admin"] },
  { title: "Insurance", url: "/insurance", icon: Shield, roles: ["admin"] },
  { title: "Runner Reports", url: "/runner-reports", icon: ClipboardList, roles: ["admin"] },
  { title: "Rental Agreement", url: "/rental-agreement", icon: ScrollText, roles: ["admin"] },
];
const financeItems: Item[] = [
  { title: "P&L", url: "/pnl", icon: TrendingUp, roles: ["admin"] },
  { title: "Expenses", url: "/expenses", icon: Receipt, roles: ["admin"] },
  { title: "Payroll", url: "/payroll", icon: Banknote, roles: ["admin"] },
];
const portalItems: Item[] = [
  { title: "Runner Portal", url: "/staff-portal", icon: UserCog, roles: ["admin", "runner"] },
  { title: "Renter Portal", url: "/driver-portal", icon: IdCard, roles: ["admin", "driver"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => url === "/" ? path === "/" : path.startsWith(url);
  useStoreVersion();
  const unread = unreadReportCount();
  const { role, user, signOut } = useAuth();
  const filter = (items: Item[]) => role ? items.filter(i => i.roles.includes(role)) : [];

  const renderGroup = (label: string, items: Item[]) => items.length === 0 ? null : (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/60">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="flex-1">{item.title}</span>}
                  {!collapsed && item.url === "/runner-reports" && unread > 0 && (
                    <Badge variant="default" className="h-5 px-1.5 text-[10px]">{unread}</Badge>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1">
            <img src={logo} alt="Camauto Rentals" className="h-full w-full object-contain" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden rounded bg-white px-2 py-1">
              <img src={logo} alt="Camauto Rentals" className="h-6 w-auto object-contain" />
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Operations", filter(adminItems))}
        {renderGroup("Finance", filter(financeItems))}
        {renderGroup("Portals", filter(portalItems))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && user && (
          <div className="mb-2 min-w-0">
            <div className="truncate text-xs font-medium">{user.email}</div>
            <div className="text-[10px] uppercase text-sidebar-foreground/60">{role ?? "no role"}</div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            title="Refresh page"
          >
            <RefreshCw className="h-4 w-4" /> {!collapsed && <span className="ml-1">Refresh</span>}
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" /> {!collapsed && <span className="ml-1">Sign out</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
