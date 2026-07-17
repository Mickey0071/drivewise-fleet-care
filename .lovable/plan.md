## Add a "Shortcuts" group at the top of the sidebar

Every item in the left sidebar (nav links across all groups) becomes pinnable. Pinned items appear in a new "⭐ Shortcuts" group rendered above every other group.

### UX
- Hovering any sidebar link shows a small pin icon on the right (⭐ outline). Click to pin/unpin. When pinned, the icon is filled.
- Right-click on a sidebar link also opens a mini menu with "Pin to Shortcuts" / "Unpin".
- The **Shortcuts** group renders at the very top of the sidebar (above Overview/Operations/etc). It only appears when at least one shortcut is pinned. Items inside are reorderable via the existing dnd-kit drag handle pattern already used by groups.
- Collapsed (icon-only) sidebar shows shortcut icons at the top as usual.
- Empty state hint (only shown once, dismissible): "Hover any link and click the ⭐ to pin it here."

### Storage — per-user, client-side
Store the ordered list of pinned URLs in `localStorage` under `sidebar-shortcuts:v1` (array of `{url, title, iconKey}`). Per-user answer + no server round trip = instant pin/unpin. Keyed by user id so multiple admins on the same browser don't share (`sidebar-shortcuts:v1:<userId>`).

We already use localStorage for sidebar group open/close and `useSidebarLayout` for order, so this matches the existing pattern. No migration needed.

### Icon resolution
Each pinned entry saves an `iconKey` string (the lucide component name already imported in `AppSidebar.tsx`). A tiny map `{ LayoutDashboard, Car, ... } as Record<string, LucideIcon>` resolves the icon at render time. If an icon is missing (e.g. removed later), fall back to a generic `Star`.

### Files to touch
- **New**: `src/hooks/use-sidebar-shortcuts.ts` — hook exposing `shortcuts`, `isPinned(url)`, `togglePin(item)`, `reorder(from,to)`, `remove(url)`. Reads/writes localStorage; broadcasts changes via a small event so both the pin buttons and the Shortcuts group stay in sync.
- **Edit**: `src/components/app/AppSidebar.tsx`
  - Add `SHORTCUTS` group rendered at the top when `shortcuts.length > 0`, using the same `CollapsibleGroup` + sortable pattern.
  - In the shared link renderer (the one used inside every group's `renderItems`), add a hover-only pin toggle button on the right of each row (hidden when collapsed).
  - Wire right-click context menu (shadcn `ContextMenu`) to the same toggle.
  - Build an icon registry from the icons already imported at the top of the file so `iconKey → Icon` works without extra bundle cost.
- No DB / no server function / no schema change.

### Out of scope
- Pinning arbitrary URLs from outside the sidebar (e.g. a specific task row on `/admin/tasks`). Answer was "any option on the bars" = any sidebar item, which this covers. If you later want to pin an individual task/record, we'd move storage to `user_ui_prefs` and add a "Pin this task" action on those pages — say the word and I'll extend it.

Ready to build?
