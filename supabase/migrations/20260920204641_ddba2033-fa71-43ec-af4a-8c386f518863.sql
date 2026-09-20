CREATE TABLE public.vehicle_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  assigned_runner_id uuid REFERENCES public.runners(id) ON DELETE SET NULL,
  assigned_runner_name text,
  assigned_runner_phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed')),
  completed_at timestamptz,
  completed_by_runner_id uuid,
  completed_by_name text,
  signature text,
  notes text,
  vehicle_can_list boolean NOT NULL DEFAULT false,
  token text UNIQUE,
  token_expires_at timestamptz,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_checklists TO authenticated;
GRANT ALL ON public.vehicle_checklists TO service_role;
ALTER TABLE public.vehicle_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage vehicle checklists" ON public.vehicle_checklists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.vehicle_checklists(id) ON DELETE CASCADE,
  category text NOT NULL,
  item_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pass','fail','n/a')),
  notes text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_items TO authenticated;
GRANT ALL ON public.checklist_items TO service_role;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage checklist items" ON public.checklist_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.tracker_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  tracker_type text NOT NULL CHECK (tracker_type IN ('oil_change','tire_replacement','brake_service','battery','filter_replacement','suspension_service','light_repair','other')),
  description text,
  parts_installed text,
  installed_date date NOT NULL DEFAULT current_date,
  installed_by text,
  cost numeric(10,2),
  next_service_due date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracker_items TO authenticated;
GRANT ALL ON public.tracker_items TO service_role;
ALTER TABLE public.tracker_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage tracker items" ON public.tracker_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_vehicle_checklists_vehicle ON public.vehicle_checklists(vehicle_id);
CREATE INDEX idx_checklist_items_checklist ON public.checklist_items(checklist_id);
CREATE INDEX idx_tracker_items_vehicle ON public.tracker_items(vehicle_id);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS checklist_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checklist_status text,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS purchase_date date;

CREATE TRIGGER trg_vehicle_checklists_updated_at BEFORE UPDATE ON public.vehicle_checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tracker_items_updated_at BEFORE UPDATE ON public.tracker_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_vehicle_checklist_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.vehicle_can_list := true;
    IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  END IF;
  UPDATE public.vehicles SET checklist_status = NEW.status WHERE id = NEW.vehicle_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vehicle_checklists_sync
  BEFORE INSERT OR UPDATE OF status ON public.vehicle_checklists
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_checklist_status();