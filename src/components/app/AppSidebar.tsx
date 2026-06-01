import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck, Calendar,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, UserCog, IdCard, ClipboardList, LogOut, ScrollText, RefreshCw, Shield, MessageSquare, ListChecks, Truck, ChevronDown, UsersRound, ClipboardPlus, Building2, Undo2, FileSignature,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { unreadReportCount, useStoreVersion } from "@/lib/mock/store";
import { rentals } from "@/lib/mock/data";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/camauto-logo.jpeg";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; roles: AppRole[] };
const adminItems: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin", "runner"] },
  { title: "Fleet", url: "/fleet", icon: Car, roles: ["admin", "runner"] },
  { title: "Customers", url: "/drivers", icon: Users, roles: ["admin", "runner"] },
  { title: "Reservations", url: "/rentals", icon: FileText, roles: ["admin", "runner"] },
  { title: "Pending Agreements", url: "/pending-agreements", icon: FileSignature, roles: ["admin", "runner", "va"] },
  { title: "Calendar", url: "/calendar", icon: Calendar, roles: ["admin", "runner"] },
  { title: "Payments", url: "/payments", icon: DollarSign, roles: ["admin"] },
  { title: "Maintenance", url: "/maintenance", icon: Wrench, roles: ["admin", "runner"] },
  { title: "Vendors", url: "/vendors", icon: Building2, roles: ["admin"] },
  { title: "Violations", url: "/violations", icon: AlertTriangle, roles: ["admin", "runner"] },
  { title: "Insurance", url: "/insurance", icon: Shield, roles: ["admin"] },
  { title: "Runner Reports", url: "/runner-reports", icon: ClipboardList, roles: ["admin", "runner"] },
  { title: "Rental Agreement", url: "/rental-agreement", icon: ScrollText, roles: ["admin"] },
  { title: "SMS log", url: "/sms-log", icon: MessageSquare, roles: ["admin"] },
  { title: "Refund Approvals", url: "/refund-approvals", icon: Undo2, roles: ["admin", "va"] },
];
const runnersItems: Item[] = [
  { title: "New Inspection", url: "/checklist", icon: ListChecks, roles: ["admin"] },
  { title: "Inspection History", url: "/inspections", icon: ClipboardCheck, roles: ["admin"] },
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
const settingsItems: Item[] = [
  { title: "Team & Access", url: "/admin/users", icon: UsersRound, roles: ["admin"] },
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
  const visibleRunners = filter(runnersItems);
  const runnersActive = visibleRunners.some(i => isActive(i.url));
  const [runnersOpen, setRunnersOpen] = useState(runnersActive);

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
        {visibleRunners.length > 0 && (
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/60">Runners</SidebarGroupLabel>}
            <SidebarGroupContent>
              <Collapsible open={collapsed ? true : runnersOpen} onOpenChange={setRunnersOpen}>
                <SidebarMenu>
                  {!collapsed && (
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={runnersActive} className="w-full">
                          <Truck className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">Runners</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${runnersOpen ? "rotate-180" : ""}`} />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                    </SidebarMenuItem>
                  )}
                  <CollapsibleContent>
                    {visibleRunners.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-8"}>
                          <Link to={item.url} className="flex items-center gap-3">
                            <item.icon className="h-4 w-4 shrink-0" />
                            {!collapsed && <span>{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </CollapsibleContent>
                </SidebarMenu>
              </Collapsible>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
