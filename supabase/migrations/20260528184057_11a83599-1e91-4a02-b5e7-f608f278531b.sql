
ALTER TABLE public.violations ADD COLUMN IF NOT EXISTS extracted_confidence numeric;

INSERT INTO storage.buckets (id, name, public)
VALUES ('violation-photos', 'violation-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read violation photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'violation-photos' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));

CREATE POLICY "Admins upload violation photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'violation-photos' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));
