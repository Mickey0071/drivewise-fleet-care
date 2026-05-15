## What you want

Two things on the **vehicle Profile/Overview** page:

1. **Edit info** — already there from the last change (the **Edit** button in the page header opens a dialog where you can change make/model/plate/VIN/mileage/rates/risk tier/status/notes/service date and replace the cover photo). Confirm that's what you wanted, or tell me what's missing.
2. **Add additional photos** — currently each vehicle has only ONE photo (the cover). You want a **photo gallery** so you can add multiple photos per vehicle (e.g. interior, damage, dashboard, walkaround) and view/delete them later.

## Plan for the photo gallery

### Database (1 migration)

New table `public.vehicle_photos`:
- `id` text PK
- `vehicle_id` text (matches `vehicles.id`)
- `url` text — public URL from the existing `vehicle-photos` storage bucket
- `caption` text (optional, e.g. "front damage")
- `sort_order` int default 0
- `created_at` timestamptz default `now()`
- `created_by` uuid (from `auth.uid()`)
- RLS: authenticated users can read/write (matches your existing fleet pattern)
- Index on `vehicle_id`

The existing `vehicle-photos` storage bucket is reused — no new bucket needed. Files saved to `gallery/{vehicleId}/{timestamp}.{ext}`.

The vehicle's main `image_url` stays as the cover photo (used on cards and as the hero on the profile page). The gallery is separate.

### Code

**Store** (`src/lib/mock/store.ts`):
- `vehiclePhotos: VehiclePhoto[]` array, loaded from Supabase on init alongside vehicles
- `addVehiclePhoto(vehicleId, file, caption?)` → uploads to bucket, inserts row, returns the photo
- `deleteVehiclePhoto(photoId)` → deletes the storage object + the row
- `updateVehiclePhotoCaption(photoId, caption)` (small extra)

**UI** — new section on `src/routes/fleet.$vehicleId.tsx` (between the hero image and the tabs), titled **"Gallery"**:
- Grid of thumbnail cards (3-4 per row)
- Each thumbnail has: image, optional caption, hover overlay with **Delete** + **Set as cover** buttons
- "**+ Add photo**" tile at the end → opens a file picker (multi-select supported); each file uploads with a progress toast
- Click a thumbnail → opens a lightbox (full-size) with prev/next arrows
- "Set as cover" copies that photo's URL into `vehicles.image_url` so it becomes the hero/card image

### Files touched

- New migration creating `vehicle_photos` + RLS
- `src/lib/mock/store.ts` — load + add/delete/setCover helpers
- `src/lib/mock/data.ts` — `VehiclePhoto` type
- `src/routes/fleet.$vehicleId.tsx` — render the Gallery section + lightbox
- `src/components/app/VehicleGallery.tsx` (new) — keeps the route file tidy

## Out of scope

- Reordering by drag-and-drop (skip — keep `sort_order` field for later)
- Auto-resize/compress on upload (skip)
- EXIF stripping (skip)

## Build sequence

1. Run the migration (you approve)
2. Build the gallery UI
3. You publish to push live

Confirm and I'll start. If the **Edit** button I added isn't doing what you expected, tell me what info you can't change — I'll add it.
