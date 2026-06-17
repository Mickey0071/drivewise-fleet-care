ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS source_work_order_id text;
CREATE INDEX IF NOT EXISTS maintenance_source_work_order_id_idx ON public.maintenance (source_work_order_id);