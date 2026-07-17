ALTER TABLE public.packet_settings
  ADD COLUMN IF NOT EXISTS default_packet_layout jsonb NOT NULL DEFAULT '["cover","agreement"]'::jsonb;