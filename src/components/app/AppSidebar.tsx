import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck, Calendar,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, IdCard, ClipboardList, LogOut, ScrollText, RefreshCw, Shield, MessageSquare, UsersRound, Building2, Undo2, FileSignature, Bell, CalendarPlus, BarChart3, DatabaseBackup, Package, Upload, Database,
  Gauge, ChevronRight, Handshake,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { unreadReportCount, useStoreVersion } from "@/lib/mock/store";
import { rentals } from "@/lib/mock/data";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/camauto-logo.jpeg";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; roles: AppRole[] };
type Group = { key: string; label: string; icon: typeof LayoutDashboard; items: Item[]; defaultOpen?: boolean };

function CollapsibleGroup({
  group, collapsed, items, renderItems,
}: {
  group: Group;
  collapsed: boolean;
  items: Item[];
  renderItems: (items: Item[]) => ReactNode;
}) {
  const storageKey = `sidebar-group:${group.key}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return group.defaultOpen ?? true;
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? (group.defaultOpen ?? true) : stored === "1";
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
  };

  if (collapsed) {
    // Icon-only mode: render items flat so they stay reachable.
    return (
      <SidebarGroup>
        <SidebarGroupContent>{renderItems(items)}</SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={toggle}>
      <SidebarGroup>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
          <group.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left uppercase tracking-wide">{group.label}</span>
          <ChevronRight className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>{renderItems(items)}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

const ALL_ROLES: AppRole[] = ["admin"];

// New top-level collapsible groups (navigation reorganization)
const primaryGroups: Group[] = [
  {
    key: "reservations", label: "Reservations", icon: FileText, defaultOpen: true,
    items: [
      { title: "Active Reservations", url: "/rentals", icon: FileText, roles: ALL_ROLES },
      { title: "Calendar", url: "/calendar", icon: Calendar, roles: ALL_ROLES },
      { title: "Client Portal Activity", url: "/driver-portal", icon: IdCard, roles: ALL_ROLES },
    ],
  },
  {
    key: "fleet", label: "Fleet", icon: Car, defaultOpen: true,
    items: [
      { title: "Vehicles", url: "/fleet", icon: Car, roles: ALL_ROLES },
      { title: "Maintenance/Repairs", url: "/maintenance", icon: Wrench, roles: ALL_ROLES },
      { title: "Parts", url: "/admin/parts", icon: Package, roles: ALL_ROLES },
      { title: "Inspections", url: "/inspections", icon: ClipboardCheck, roles: ALL_ROLES },
      { title: "Violations", url: "/violations", icon: AlertTriangle, roles: ALL_ROLES },
      { title: "Monthly Vehicle Reports", url: "/monthly-vehicle-reports", icon: FileText, roles: ALL_ROLES },
    ],
  },
  {
    key: "pnl", label: "P&L/Expenses", icon: TrendingUp, defaultOpen: true,
    items: [
      { title: "P&L Dashboard", url: "/analytics/pnl-dashboard", icon: TrendingUp, roles: ALL_ROLES },
      { title: "P&L", url: "/pnl", icon: TrendingUp, roles: ALL_ROLES },
      { title: "Expenses", url: "/admin/expenses", icon: Receipt, roles: ALL_ROLES },
      { title: "Vehicle Profitability", url: "/analytics/profitability", icon: BarChart3, roles: ALL_ROLES },
      { title: "Prior Period Adjustment", url: "/analytics/pnl-dashboard#prior-period-adjustment", icon: DollarSign, roles: ALL_ROLES },
      { title: "Analytics", url: "/analytics", icon: BarChart3, roles: ALL_ROLES },
      { title: "Payroll", url: "/payroll", icon: Banknote, roles: ALL_ROLES },
    ],
  },
  {
    key: "staff", label: "Staff", icon: UsersRound, defaultOpen: true,
    items: [
      { title: "Staff Directory", url: "/admin/users", icon: UsersRound, roles: ALL_ROLES },
      { title: "Create Task", url: "/admin/create-task", icon: ClipboardList, roles: ALL_ROLES },
      { title: "Runner Dispatch", url: "/admin/tasks", icon: ClipboardList, roles: ALL_ROLES },
    ],
  },
  {
    key: "jv", label: "JV", icon: Handshake, defaultOpen: true,
    items: [
      { title: "JV Units", url: "/jv-units", icon: Car, roles: ALL_ROLES },
      { title: "JV Contracts", url: "/jv-contracts", icon: FileSignature, roles: ALL_ROLES },
      { title: "JV Payouts", url: "/jv-payouts", icon: Banknote, roles: ALL_ROLES },
    ],
  },
];

// URLs surfaced inside the primary groups — excluded from the "More" lists to avoid duplicates.
const primaryUrls = new Set(
  primaryGroups.flatMap(g => g.items.map(i => i.url.split("#")[0])),
);

const adminItems: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin"] },
  { title: "Fleet Snapshot", url: "/fleet-snapshot", icon: Gauge, roles: ["admin"] },
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
  { title: "Rental Agreement Violation", url: "/self-agreement", icon: FileSignature, roles: ["admin"] },
  { title: "SMS log", url: "/sms-log", icon: MessageSquare, roles: ["admin"] },
  { title: "Analytics", url: "/analytics", icon: BarChart3, roles: ["admin"] },
  { title: "Notifications", url: "/admin/notifications", icon: Bell, roles: ["admin"] },
  { title: "Extension Offers", url: "/admin/extensions", icon: CalendarPlus, roles: ["admin"] },
  { title: "Refund Approvals", url: "/refund-approvals", icon: Undo2, roles: ["admin", "va"] },
  { title: "Backups", url: "/admin/backups", icon: DatabaseBackup, roles: ["admin"] },
];
const financeItems: Item[] = [
  { title: "P&L", url: "/pnl", icon: TrendingUp, roles: ["admin"] },
  { title: "Monthly Vehicle Reports", url: "/monthly-vehicle-reports", icon: FileText, roles: ["admin"] },
  { title: "Expenses", url: "/admin/expenses", icon: Receipt, roles: ["admin"] },
  { title: "Payroll", url: "/payroll", icon: Banknote, roles: ["admin"] },
];
const portalItems: Item[] = [
  { title: "Renter Portal", url: "/driver-portal", icon: IdCard, roles: ["admin", "driver"] },
];
const settingsItems: Item[] = [
  { title: "Team & Access", url: "/admin/users", icon: UsersRound, roles: ["admin"] },
  { title: "Import Data", url: "/admin/import-data", icon: DatabaseBackup, roles: ["admin"] },
  { title: "Import Legacy Rentals", url: "/admin/import-legacy", icon: Upload, roles: ["admin"] },
  { title: "Migrated Reservations", url: "/migrated-reservations", icon: Database, roles: ["admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (rawUrl: string) => {
    const url = rawUrl.split("#")[0];
    return url === "/" ? path === "/" : path.startsWith(url);
  };
  useStoreVersion();
  const unread = unreadReportCount();
  const pendingReviewCount = rentals.filter(r => r.staffReviewStatus === "pending").length;
  const { role, user, signOut } = useAuth();
  const filter = (items: Item[]) => role ? items.filter(i => i.roles.includes(role)) : [];
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const search = (items: Item[]) =>
    q ? items.filter(i => i.title.toLowerCase().includes(q)) : items;

  const renderItems = (items: Item[]) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
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
  );

  const renderCollapsibleGroup = (group: Group) => {
    const items = search(filter(group.items));
    if (items.length === 0) return null;
    return <CollapsibleGroup key={group.key} group={group} collapsed={collapsed} renderItems={renderItems} items={items} />;
  };

  const renderGroup = (label: string, items: Item[]) => items.length === 0 ? null : (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/60">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        {renderItems(items)}
      </SidebarGroupContent>
    </SidebarGroup>
  );

  // Leftover items (not surfaced in the primary groups) stay accessible below.
  const leftover = (items: Item[]) => search(filter(items)).filter(i => !primaryUrls.has(i.url));

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
        {!collapsed && (
          <div className="px-2 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/50" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search menu..."
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        )}
        {renderGroup("Dashboard", search(filter(adminItems).filter(i => i.url === "/")))}
        {primaryGroups.map(renderCollapsibleGroup)}
        {renderGroup("More — Operations", leftover(adminItems).filter(i => i.url !== "/"))}
        {renderGroup("More — Finance", leftover(financeItems))}
        {renderGroup("More — Portals", leftover(portalItems))}
        {renderGroup("More — Settings", leftover(settingsItems))}
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
