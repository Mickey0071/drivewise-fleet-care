import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Car, Users, FileText, DollarSign, ClipboardCheck, Calendar,
  Wrench, AlertTriangle, TrendingUp, Receipt, Banknote, IdCard, ClipboardList,
  LogOut, ScrollText, RefreshCw, Shield, MessageSquare, UsersRound, Building2,
  Undo2, FileSignature, Bell, CalendarPlus, BarChart3, DatabaseBackup, Package,
  Upload, Database, Gauge, Handshake, GripVertical, Star, RotateCcw, Search,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { unreadReportCount, useStoreVersion } from "@/lib/mock/store";
import { rentals } from "@/lib/mock/data";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { countNewWaitlistEntries } from "@/lib/waitlist.functions";
import logo from "@/assets/camauto-logo.jpeg";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
  useSortable, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavLayout, applyOrder } from "@/hooks/use-nav-layout";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import type { LucideIcon } from "lucide-react";

type Role = AppRole;
type NavItem = {
  key: string; // stable id (== url)
  url: string;
  title: string;
  icon: LucideIcon;
  roles: Role[];
  sectionKey: string;
  sectionLabel: string;
  sectionIcon: LucideIcon;
};

const ALL: Role[] = ["admin"];

/**
 * Default sidebar composition. The user can re-order any item across sections;
 * the section labels below are only defaults used to group items on first load
 * and as visual dividers when consecutive items share the same default section.
 */
const DEFAULT_ITEMS: NavItem[] = [
  // Dashboard
  { key: "/", url: "/", title: "Dashboard", icon: LayoutDashboard, roles: ["admin"], sectionKey: "dashboard", sectionLabel: "Dashboard", sectionIcon: LayoutDashboard },
  { key: "/fleet-snapshot", url: "/fleet-snapshot", title: "Fleet Snapshot", icon: Gauge, roles: ["admin"], sectionKey: "dashboard", sectionLabel: "Dashboard", sectionIcon: LayoutDashboard },

  // Reservations
  { key: "/rentals", url: "/rentals", title: "Active Reservations", icon: FileText, roles: ALL, sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },
  { key: "/admin/waitlist", url: "/admin/waitlist", title: "Waitlist", icon: ClipboardList, roles: ALL, sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },
  { key: "/calendar", url: "/calendar", title: "Calendar", icon: Calendar, roles: ALL, sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },
  { key: "/driver-portal", url: "/driver-portal", title: "Client Portal Activity", icon: IdCard, roles: ALL, sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },
  { key: "/pending-agreements", url: "/pending-agreements", title: "Pending Agreements", icon: FileSignature, roles: ["admin", "va"], sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },
  { key: "/admin/historic-reservation", url: "/admin/historic-reservation", title: "+ Add Historic Rental", icon: CalendarPlus, roles: ["admin", "va"], sectionKey: "reservations", sectionLabel: "Reservations", sectionIcon: FileText },

  // Historic (standalone, top-level link)
  { key: "historic:/admin/historic-reservation", url: "/admin/historic-reservation", title: "Historic Rental", icon: CalendarPlus, roles: ["admin", "va"], sectionKey: "historic", sectionLabel: "Historic", sectionIcon: CalendarPlus },

  // Fleet
  { key: "/fleet", url: "/fleet", title: "Vehicles", icon: Car, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/maintenance", url: "/maintenance", title: "Maintenance", icon: Wrench, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/repairs", url: "/repairs", title: "Repairs", icon: Wrench, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/admin/parts", url: "/admin/parts", title: "Parts", icon: Package, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/inspections", url: "/inspections", title: "Inspections", icon: ClipboardCheck, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/violations", url: "/violations", title: "Violations", icon: AlertTriangle, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/admin/packet-settings", url: "/admin/packet-settings", title: "Transfer Packet Settings", icon: FileSignature, roles: ["admin"], sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/violations/authorities", url: "/violations/authorities", title: "Violation Authorities", icon: Building2, roles: ["admin"], sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/monthly-vehicle-reports", url: "/monthly-vehicle-reports", title: "Monthly Vehicle Reports", icon: FileText, roles: ALL, sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/insurance", url: "/insurance", title: "Insurance", icon: Shield, roles: ["admin"], sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },
  { key: "/vendors", url: "/vendors", title: "Vendors", icon: Building2, roles: ["admin"], sectionKey: "fleet", sectionLabel: "Fleet", sectionIcon: Car },

  // Customers & Payments
  { key: "/drivers", url: "/drivers", title: "Customers", icon: Users, roles: ["admin"], sectionKey: "customers", sectionLabel: "Customers & Payments", sectionIcon: Users },
  { key: "/payments", url: "/payments", title: "Payments", icon: DollarSign, roles: ["admin"], sectionKey: "customers", sectionLabel: "Customers & Payments", sectionIcon: Users },
  { key: "/refund-approvals", url: "/refund-approvals", title: "Refund Approvals", icon: Undo2, roles: ["admin", "va"], sectionKey: "customers", sectionLabel: "Customers & Payments", sectionIcon: Users },

  // P&L / Finance
  { key: "/analytics/pnl-dashboard", url: "/analytics/pnl-dashboard", title: "P&L Dashboard", icon: TrendingUp, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },
  { key: "/pnl", url: "/pnl", title: "P&L", icon: TrendingUp, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },
  { key: "/admin/expenses", url: "/admin/expenses", title: "Expenses", icon: Receipt, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },
  { key: "/analytics/profitability", url: "/analytics/profitability", title: "Vehicle Profitability", icon: BarChart3, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },
  { key: "/analytics", url: "/analytics", title: "Analytics", icon: BarChart3, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },
  { key: "/payroll", url: "/payroll", title: "Payroll", icon: Banknote, roles: ALL, sectionKey: "pnl", sectionLabel: "P&L / Finance", sectionIcon: TrendingUp },

  // Staff & Tasks
  { key: "/admin/users", url: "/admin/users", title: "Staff Directory", icon: UsersRound, roles: ALL, sectionKey: "staff", sectionLabel: "Staff & Tasks", sectionIcon: UsersRound },
  { key: "/admin/create-task", url: "/admin/create-task", title: "Create Task", icon: ClipboardList, roles: ALL, sectionKey: "staff", sectionLabel: "Staff & Tasks", sectionIcon: UsersRound },
  { key: "/admin/tasks", url: "/admin/tasks", title: "Runner Dispatch", icon: ClipboardList, roles: ALL, sectionKey: "staff", sectionLabel: "Staff & Tasks", sectionIcon: UsersRound },
  { key: "/admin/mechanics", url: "/admin/mechanics", title: "Mechanics", icon: Wrench, roles: ALL, sectionKey: "staff", sectionLabel: "Staff & Tasks", sectionIcon: UsersRound },
  { key: "/runner-reports", url: "/runner-reports", title: "Runner Reports", icon: ClipboardList, roles: ["admin"], sectionKey: "staff", sectionLabel: "Staff & Tasks", sectionIcon: UsersRound },

  // JV
  { key: "/jv-units", url: "/jv-units", title: "JV Units", icon: Car, roles: ALL, sectionKey: "jv", sectionLabel: "JV", sectionIcon: Handshake },
  { key: "/jv-contracts", url: "/jv-contracts", title: "JV Contracts", icon: FileSignature, roles: ALL, sectionKey: "jv", sectionLabel: "JV", sectionIcon: Handshake },
  { key: "/jv-payouts", url: "/jv-payouts", title: "JV Payouts", icon: Banknote, roles: ALL, sectionKey: "jv", sectionLabel: "JV", sectionIcon: Handshake },

  // Other
  { key: "/rental-agreement", url: "/rental-agreement", title: "Rental Agreement", icon: ScrollText, roles: ["admin"], sectionKey: "other", sectionLabel: "Other", sectionIcon: FileText },
  { key: "/self-agreement", url: "/self-agreement", title: "Rental Agreement Violation", icon: FileSignature, roles: ["admin"], sectionKey: "other", sectionLabel: "Other", sectionIcon: FileText },
  { key: "/sms-log", url: "/sms-log", title: "SMS log", icon: MessageSquare, roles: ["admin"], sectionKey: "other", sectionLabel: "Other", sectionIcon: FileText },
  { key: "/admin/notifications", url: "/admin/notifications", title: "Notifications", icon: Bell, roles: ["admin"], sectionKey: "other", sectionLabel: "Other", sectionIcon: FileText },
  { key: "/admin/extensions", url: "/admin/extensions", title: "Extension Offers", icon: CalendarPlus, roles: ["admin"], sectionKey: "other", sectionLabel: "Other", sectionIcon: FileText },

  // Settings
  { key: "/admin/import-data", url: "/admin/import-data", title: "Import Data", icon: DatabaseBackup, roles: ["admin"], sectionKey: "settings", sectionLabel: "Settings", sectionIcon: DatabaseBackup },
  { key: "/admin/import-legacy", url: "/admin/import-legacy", title: "Import Legacy Rentals", icon: Upload, roles: ["admin"], sectionKey: "settings", sectionLabel: "Settings", sectionIcon: DatabaseBackup },
  { key: "/migrated-reservations", url: "/migrated-reservations", title: "Migrated Reservations", icon: Database, roles: ["admin"], sectionKey: "settings", sectionLabel: "Settings", sectionIcon: DatabaseBackup },
  { key: "/admin/backups", url: "/admin/backups", title: "Backups", icon: DatabaseBackup, roles: ["admin"], sectionKey: "settings", sectionLabel: "Settings", sectionIcon: DatabaseBackup },
];

function NavRow({
  item, isActive, badges, collapsed, isMobile, isStarred, onToggleStar,
  dragHandleRef, dragAttributes, dragListeners,
}: {
  item: NavItem;
  isActive: (url: string) => boolean;
  badges: { unread: number; pendingReview: number; waitlistNew: number };
  collapsed: boolean;
  isMobile: boolean;
  isStarred: boolean;
  onToggleStar: (key: string) => void;
  dragHandleRef?: (el: HTMLButtonElement | null) => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}) {
  const active = isActive(item.url);
  const Icon = item.icon;
  const showGripAlways = isMobile;
  return (
    <div
      className={`group/nav relative flex items-center gap-1 rounded-md ${
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
      }`}
    >
      {!collapsed && (
        <button
          ref={dragHandleRef as never}
          type="button"
          aria-label={`Reorder ${item.title}`}
          className={`cursor-grab touch-none px-1 text-sidebar-foreground/40 hover:text-sidebar-foreground ${
            showGripAlways ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100"
          }`}
          {...(dragAttributes ?? {})}
          {...(dragListeners ?? {})}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <Link
        to={item.url}
        className="flex flex-1 items-center gap-2 py-2 pr-8 text-sm"
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
        {!collapsed && item.url === "/runner-reports" && badges.unread > 0 && (
          <Badge variant="default" className="h-5 px-1.5 text-[10px]">{badges.unread}</Badge>
        )}
        {!collapsed && item.url === "/pending-agreements" && badges.pendingReview > 0 && (
          <Badge className="h-5 bg-amber-500 px-1.5 text-[10px] text-white hover:bg-amber-500">{badges.pendingReview}</Badge>
        )}
        {!collapsed && item.url === "/admin/waitlist" && badges.waitlistNew > 0 && (
          <Badge className="h-5 bg-primary px-1.5 text-[10px] text-primary-foreground">{badges.waitlistNew}</Badge>
        )}
      </Link>
      {!collapsed && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleStar(item.key); }}
          aria-label={isStarred ? `Remove ${item.title} shortcut` : `Add ${item.title} shortcut to top`}
          title={isStarred ? "Remove from top shortcuts" : "Pin to top shortcuts"}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-sidebar-foreground/60 opacity-100 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Star className={`h-3.5 w-3.5 ${isStarred ? "fill-current text-amber-500" : ""}`} />
        </button>
      )}
    </div>
  );
}

function SortableNavRow(props: React.ComponentProps<typeof NavRow> & { id: string }) {
  const { id, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <NavRow
        {...rest}
        dragAttributes={attributes as unknown as Record<string, unknown>}
        dragListeners={listeners as unknown as Record<string, unknown>}
      />
    </div>
  );
}

function SectionHeader({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <div className="mt-3 flex items-center gap-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (rawUrl: string) => {
    const url = rawUrl.split("#")[0];
    return url === "/" ? path === "/" : path.startsWith(url);
  };

  useStoreVersion();
  const unread = unreadReportCount();
  const pendingReviewCount = rentals.filter(r => r.staffReviewStatus === "pending").length;
  const countNewWl = useServerFn(countNewWaitlistEntries);
  const { data: wlNewData } = useQuery({
    queryKey: ["waitlist-new-count"],
    queryFn: () => countNewWl(),
    refetchInterval: 60_000,
  });
  const waitlistNew = wlNewData?.count ?? 0;
  const badges = { unread, pendingReview: pendingReviewCount, waitlistNew };

  const { role, user, signOut } = useAuth();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const { layout, setNavOrder, setShortcuts, toggleStar, isStarred, reset } = useNavLayout();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Filter by role, then apply user's saved order.
  const orderedNav = useMemo<NavItem[]>(() => {
    const filtered = DEFAULT_ITEMS.filter(i => role ? i.roles.includes(role) : false);
    return applyOrder(filtered, (i) => i.key, layout.navOrder);
  }, [role, layout.navOrder]);

  const searched = useMemo<NavItem[]>(() => {
    if (!q) return orderedNav;
    return orderedNav.filter(i => i.title.toLowerCase().includes(q));
  }, [orderedNav, q]);

  // Shortcut rows: preserve saved order, resolve items from master list.
  const shortcutItems = useMemo<NavItem[]>(() => {
    const byKey = new Map(DEFAULT_ITEMS.map(i => [i.key, i]));
    const list = layout.shortcuts
      .map(k => byKey.get(k))
      .filter((i): i is NavItem => !!i && (role ? i.roles.includes(role) : false));
    if (!q) return list;
    return list.filter(i => i.title.toLowerCase().includes(q));
  }, [layout.shortcuts, role, q]);

  const handleNavDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Reorder against the full nav list (not the searched subset).
    const fullKeys = orderedNav.map(i => i.key);
    const from = fullKeys.indexOf(String(active.id));
    const to = fullKeys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void setNavOrder(arrayMove(fullKeys, from, to));
  };

  const handleShortcutDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const keys = layout.shortcuts.slice();
    const activeKey = String(active.id).replace(/^sc:/, "");
    const overKey = String(over.id).replace(/^sc:/, "");
    const from = keys.indexOf(activeKey);
    const to = keys.indexOf(overKey);
    if (from < 0 || to < 0) return;
    void setShortcuts(arrayMove(keys, from, to));
  };

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

        {/* Starred shortcuts — always at the very top, above everything */}
        {!collapsed && shortcutItems.length === 0 && (
          <div className="mx-2 mt-2 rounded-md border border-dashed border-sidebar-border px-3 py-2 text-[11px] leading-snug text-sidebar-foreground/60">
            <div className="mb-0.5 flex items-center gap-1.5 font-medium uppercase tracking-wide text-amber-600/80 dark:text-amber-400/80">
              <Star className="h-3.5 w-3.5" /> Shortcuts
            </div>
            Tap the <Star className="mx-0.5 inline h-3 w-3" /> next to any item below to pin just that single row up here.
          </div>
        )}
        {shortcutItems.length > 0 && (
          <div className="px-2 pt-2">
            {!collapsed && (
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-600/80 dark:text-amber-400/80">
                <Star className="h-3.5 w-3.5 fill-current" />
                <span>Shortcuts</span>
              </div>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleShortcutDragEnd}>
              <SortableContext items={shortcutItems.map(i => `sc:${i.key}`)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-0.5">
                  {shortcutItems.map((item) => (
                    <SortableNavRow
                      key={`sc:${item.key}`}
                      id={`sc:${item.key}`}
                      item={item}
                      isActive={isActive}
                      badges={badges}
                      collapsed={collapsed}
                      isMobile={isMobile}
                      isStarred={true}
                      onToggleStar={toggleStar}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="my-2 border-t border-sidebar-border" />
          </div>
        )}

        {/* Main nav — flat, cross-section drag-and-drop */}
        <div className="px-2 pb-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleNavDragEnd}>
            <SortableContext items={searched.map(i => i.key)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-0.5">
                {searched.map((item, idx) => {
                  const prev = idx > 0 ? searched[idx - 1] : undefined;
                  const showHeader = !collapsed && !q && (!prev || prev.sectionKey !== item.sectionKey);
                  return (
                    <div key={item.key}>
                      {showHeader && (
                        <SectionHeader label={item.sectionLabel} icon={item.sectionIcon} />
                      )}
                      <SortableNavRow
                        id={item.key}
                        item={item}
                        isActive={isActive}
                        badges={badges}
                        collapsed={collapsed}
                        isMobile={isMobile}
                        isStarred={isStarred(item.key)}
                        onToggleStar={toggleStar}
                      />
                    </div>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Reset layout */}
        {!collapsed && (
          <div className="mt-auto px-2 pb-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-sidebar-foreground/70">
                  <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset layout
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset sidebar layout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This restores the default order and removes every pinned shortcut. Only your account is affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void reset()}>Reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
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