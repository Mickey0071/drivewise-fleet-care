CREATE TABLE public.dispute_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  renter_id text,
  renter_name text,
  dispute_type text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'DRAFT',
  plate text,
  violation_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  date_from date,
  date_to date,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispute_packets TO authenticated;
GRANT ALL ON public.dispute_packets TO service_role;

ALTER TABLE public.dispute_packets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage dispute packets"
ON public.dispute_packets FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_dispute_packets_updated_at
BEFORE UPDATE ON public.dispute_packets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();