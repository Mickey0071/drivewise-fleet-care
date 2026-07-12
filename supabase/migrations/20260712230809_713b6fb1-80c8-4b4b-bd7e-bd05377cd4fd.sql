CREATE TABLE public.card_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL,
  rental_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  completed_at TIMESTAMP WITH TIME ZONE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_requests TO authenticated;
GRANT ALL ON public.card_requests TO service_role;

ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view card requests"
  ON public.card_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_card_requests_token ON public.card_requests(token);