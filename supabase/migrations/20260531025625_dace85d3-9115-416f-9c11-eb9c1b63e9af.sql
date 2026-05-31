-- Preventive maintenance work orders
CREATE TABLE public.work_orders (
  id TEXT NOT NULL PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  assigned_to TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  completed_date DATE,
  actual_cost NUMERIC,
  parts_used TEXT,
  completion_notes TEXT,
  mechanic_signature TEXT,
  mechanic_signed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by TEXT,
  admin_signature TEXT,
  admin_signed_at TIMESTAMP WITH TIME ZONE,
  signed_doc_url TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read work_orders"
ON public.work_orders FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins insert work_orders"
ON public.work_orders FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Runners insert work_orders"
ON public.work_orders FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins update work_orders"
ON public.work_orders FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Runners update work_orders"
ON public.work_orders FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins delete work_orders"
ON public.work_orders FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER work_orders_touch_updated_at
BEFORE UPDATE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_orders;

-- Private bucket for signed work order documents
INSERT INTO storage.buckets (id, name, public) VALUES ('work-order-docs', 'work-order-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff read work-order-docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'work-order-docs' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));

CREATE POLICY "Staff upload work-order-docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'work-order-docs' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));

CREATE POLICY "Staff update work-order-docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'work-order-docs' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));