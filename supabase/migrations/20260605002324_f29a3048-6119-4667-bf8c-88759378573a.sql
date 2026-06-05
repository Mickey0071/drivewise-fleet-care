CREATE TABLE public.ezpass_batches (
  id TEXT NOT NULL PRIMARY KEY,
  source_filename TEXT,
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'reviewing',
  total_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.ezpass_batch_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES public.ezpass_batches(id) ON DELETE CASCADE,
  violation_date DATE,
  violation_time TEXT,
  plate TEXT,
  location TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  rental_id TEXT,
  driver_id TEXT,
  vehicle_id TEXT,
  driver_name TEXT,
  candidates JSONB,
  violation_id TEXT,
  affidavit_pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_ezpass_batch_items_batch ON public.ezpass_batch_items(batch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ezpass_batches TO authenticated;
GRANT ALL ON public.ezpass_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ezpass_batch_items TO authenticated;
GRANT ALL ON public.ezpass_batch_items TO service_role;

ALTER TABLE public.ezpass_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ezpass_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ezpass batches"
  ON public.ezpass_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage ezpass batches"
  ON public.ezpass_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can view ezpass items"
  ON public.ezpass_batch_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage ezpass items"
  ON public.ezpass_batch_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ezpass_batches_updated
  BEFORE UPDATE ON public.ezpass_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_ezpass_batch_items_updated
  BEFORE UPDATE ON public.ezpass_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();