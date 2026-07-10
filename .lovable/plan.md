## Goal

Let you rearrange the left sidebar — both the category groups (Reservations, Fleet, P&L, Staff, JV) and the links inside each group — by dragging, then **lock** the layout so it stops being draggable. Your custom arrangement is saved to your account so it follows you across devices/browsers. (The Fleet screen's own search bar is left untouched — it stays a fleet filter.)

## How it works for you

1. A small control appears at the top of the sidebar: an **Edit layout** button (pencil/unlock icon).
2. Click **Edit layout** → drag handles appear. You can:
   - Drag whole category groups up/down to reorder them.
   - Drag individual links within a group to reorder them.
3. Click **Lock** → dragging is disabled, the arrangement is frozen, and it's saved.
4. Next time you sign in (any device), the sidebar loads in your saved order and stays locked until you hit Edit layout again.

## What gets built

### 1. Persistence (cross-device) — backend
Create a per-user preferences table so the layout follows your account:

```text
public.user_ui_prefs
  user_id  uuid  (PK, references auth user id)
  sidebar_layout  jsonb   -- { groupOrder: [...], itemOrder: { groupKey: [urls...] }, locked: bool }
  updated_at  timestamptz
```
- RLS: each user can only read/write their own row (`auth.uid() = user_id`).
- GRANTs for `authenticated` + `service_role` in the same migration.

### 2. Load/save layout
- On sidebar mount, read the current user's `sidebar_layout` (via the Supabase client, RLS-scoped).
- Save on **Lock** (and when reordering in edit mode) with an upsert.
- If no saved row exists, fall back to the current default order.

### 3. Sidebar drag-and-drop + lock (`src/components/app/AppSidebar.tsx`)
- Add `editMode`/`locked` state plus an **Edit layout / Lock** toggle button near the top of `SidebarContent`.
- Apply the saved `groupOrder` to reorder `primaryGroups`, and saved `itemOrder` to reorder links within each group before rendering.
- Add drag-and-drop:
  - Group-level reordering of the collapsible groups.
  - Item-level reordering within each group's menu.
  - Drag handles only visible/active in edit mode; disabled when locked.
- Keep existing behavior intact: role filtering, menu search, collapse-to-icons, badges, and the per-group open/closed memory.

## Technical notes

- Drag-and-drop: use `@dnd-kit/core` + `@dnd-kit/sortable` (lightweight, keyboard-accessible). Added via package install.
- Reordering merges saved order with defaults so newly added routes still appear (any group/link not in the saved order is appended at the end).
- Writes go through the RLS-protected table using the browser Supabase client; no service role needed.
- The Fleet page search bar is out of scope and unchanged.

## Out of scope
- No change to the Fleet screen search behavior.
- No change to which links exist or their routes — only their order and the lock state.