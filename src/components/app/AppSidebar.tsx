import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck, Calendar,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, IdCard, ClipboardList, LogOut, ScrollText, RefreshCw, Shield, MessageSquare, UsersRound, Building2, Undo2, FileSignature, Bell, CalendarPlus, BarChart3, DatabaseBackup, Package, Upload,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { unreadReportCount, useStoreVersion } from "@/lib/mock/store";
import { rentals } from "@/lib/mock/data";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/camauto-logo.jpeg";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; roles: AppRole[] };
const adminItems: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin"] },
  { title: "Reservations", url: "/rentals", icon: FileText, roles: ["admin"] },
  { title: "Fleet", url: "/fleet", icon: Car, roles: ["admin"] },
  { title: "Maintenance", url: "/maintenance", icon: Wrench, roles: ["admin"] },
  { title: "Create Task", url: "/admin/create-task", icon: ClipboardList, roles: ["admin"] },
  { title: "Runner Tasks", url: "/admin/tasks", icon: ClipboardList, roles: ["admin"] },
  { title: "Violations", url: "/violations", icon: AlertTriangle, roles: ["admin"] },
  { title: "Customers", url: "/drivers", icon: Users, roles: ["admin"] },
  { title: "Pending Agreements", url: "/pending-agreements", icon: FileSignature, roles: ["admin", "va"] },
  { title: "Calendar", url: "/calendar", icon: Calendar, roles: ["admin"] },
  { title: "Payments", url: "/payments", icon: DollarSign, roles: ["admin"] },
  { title: "Inspections", url: "/inspections", icon: ClipboardCheck, roles: ["admin"] },
  { title: "Vendors", url: "/vendors", icon: Building2, roles: ["admin"] },
  { title: "Parts", url: "/admin/parts", icon: Package, roles: ["admin"] },
  { title: "Insurance", url: "/insurance", icon: Shield, roles: ["admin"] },
  { title: "Runner Reports", url: "/runner-reports", icon: ClipboardList, roles: ["admin"] },
  { title: "Rental Agreement", url: "/rental-agreement", icon: ScrollText, roles: ["admin"] },
  { title: "SMS log", url: "/sms-log", icon: MessageSquare, roles: ["admin"] },
  { title: "Analytics", url: "/analytics", icon: BarChart3, roles: ["admin"] },
  { title: "Notifications", url: "/admin/notifications", icon: Bell, roles: ["admin"] },
  { title: "Extension Offers", url: "/admin/extensions", icon: CalendarPlus, roles: ["admin"] },
  { title: "Refund Approvals", url: "/refund-approvals", icon: Undo2, roles: ["admin", "va"] },
  { title: "Backups", url: "/admin/backups", icon: DatabaseBackup, roles: ["admin"] },
];
const financeItems: Item[] = [
  { title: "P&L", url: "/pnl", icon: TrendingUp, roles: ["admin"] },
  { title: "Expenses", url: "/expenses", icon: Receipt, roles: ["admin"] },
  { title: "Payroll", url: "/payroll", icon: Banknote, roles: ["admin"] },
];
const portalItems: Item[] = [
  { title: "Renter Portal", url: "/driver-portal", icon: IdCard, roles: ["admin", "driver"] },
];
const settingsItems: Item[] = [
  { title: "Team & Access", url: "/admin/users", icon: UsersRound, roles: ["admin"] },
  { title: "Import Data", url: "/admin/import-data", icon: DatabaseBackup, roles: ["admin"] },
  { title: "Import Legacy Rentals", url: "/admin/import-legacy", icon: Upload, roles: ["admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => url === "/" ? path === "/" : path.startsWith(url);
  useStoreVersion();
  const unread = unreadReportCount();
  const pendingReviewCount = rentals.filter(r => r.staffReviewStatus === "pending").length;
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
                  {!collapsed && item.url === "/pending-agreements" && pendingReviewCount > 0 && (
                    <Badge className="h-5 bg-amber-500 px-1.5 text-[10px] text-white hover:bg-amber-500">{pendingReviewCount}</Badge>
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
        {renderGroup("Settings", filter(settingsItems))}
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
