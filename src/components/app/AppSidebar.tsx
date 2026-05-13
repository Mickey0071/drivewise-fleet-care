import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, UserCog, IdCard,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import logo from "@/assets/camauto-logo.jpeg";

const adminItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Fleet", url: "/fleet", icon: Car },
  { title: "Drivers", url: "/drivers", icon: Users },
  { title: "Reservations", url: "/rentals", icon: FileText },
  { title: "Payments", url: "/payments", icon: DollarSign },
  { title: "Inspections", url: "/inspections", icon: ClipboardCheck },
  { title: "Maintenance", url: "/maintenance", icon: Wrench },
  { title: "Violations", url: "/violations", icon: AlertTriangle },
];
const financeItems = [
  { title: "P&L", url: "/pnl", icon: TrendingUp },
  { title: "Expenses", url: "/expenses", icon: Receipt },
  { title: "Payroll", url: "/payroll", icon: Banknote },
];
const portalItems = [
  { title: "Runner Portal", url: "/staff-portal", icon: UserCog },
  { title: "Driver Portal", url: "/driver-portal", icon: IdCard },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => url === "/" ? path === "/" : path.startsWith(url);

  const renderGroup = (label: string, items: typeof adminItems) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/60">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
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
        {renderGroup("Operations", adminItems)}
        {renderGroup("Finance", financeItems)}
        {renderGroup("Portals", portalItems)}
      </SidebarContent>
    </Sidebar>
  );
}
