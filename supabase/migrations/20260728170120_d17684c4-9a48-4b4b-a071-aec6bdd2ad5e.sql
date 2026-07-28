
INSERT INTO public.authority_addresses (key, name, address_lines, region, is_active)
VALUES
  ('drpa', 'Delaware River Port Authority', E'Delaware River Port Authority\nOne Port Center, 2 Riverside Drive\nCamden, NJ 08101', 'NJ', true),
  ('sjta', 'South Jersey Transportation Authority', E'South Jersey Transportation Authority\nP.O. Box 351\nHammonton, NJ 08037', 'NJ', true)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      address_lines = EXCLUDED.address_lines,
      region = EXCLUDED.region,
      is_active = true;

UPDATE public.authority_addresses
SET address_lines = E'New Jersey Turnpike Authority\nP.O. Box 5042\nWoodbridge, NJ 07095'
WHERE key = 'nj_turnpike' AND (address_lines IS NULL OR address_lines = '');

UPDATE public.authority_addresses
SET address_lines = E'NJ Motor Vehicle Commission\nP.O. Box 160\nTrenton, NJ 08666'
WHERE key = 'nj_mvc' AND (address_lines IS NULL OR address_lines = '');

UPDATE public.authority_addresses
SET address_lines = E'NY E-ZPass Customer Service Center\nP.O. Box 149001\nStaten Island, NY 10314-9001'
WHERE key = 'ny_ezpass' AND (address_lines IS NULL OR address_lines = '');

UPDATE public.authority_addresses
SET address_lines = E'PA Turnpike Violation Processing Center\nP.O. Box 645631\nPittsburgh, PA 15264-5253'
WHERE key = 'pa_turnpike' AND (address_lines IS NULL OR address_lines = '');
