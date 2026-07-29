-- Shared normalization: strip leading/trailing state code and separators.
UPDATE public.violations
SET license_plate = regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(btrim(license_plate)),
          '^\(?[A-Z]{2}\)?[[:space:]/.\-]+', ''
        ),
        '[[:space:]/.\-]+\(?[A-Z]{2}\)?$', ''
      ),
      '[[:space:]/.\-()]', '', 'g'
    )
WHERE license_plate IS NOT NULL
  AND license_plate <> regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(btrim(license_plate)),
          '^\(?[A-Z]{2}\)?[[:space:]/.\-]+', ''
        ),
        '[[:space:]/.\-]+\(?[A-Z]{2}\)?$', ''
      ),
      '[[:space:]/.\-()]', '', 'g'
    );

UPDATE public.ezpass_batch_items
SET plate = regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(btrim(plate)),
          '^\(?[A-Z]{2}\)?[[:space:]/.\-]+', ''
        ),
        '[[:space:]/.\-]+\(?[A-Z]{2}\)?$', ''
      ),
      '[[:space:]/.\-()]', '', 'g'
    )
WHERE plate IS NOT NULL
  AND plate <> regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(btrim(plate)),
          '^\(?[A-Z]{2}\)?[[:space:]/.\-]+', ''
        ),
        '[[:space:]/.\-]+\(?[A-Z]{2}\)?$', ''
      ),
      '[[:space:]/.\-()]', '', 'g'
    );