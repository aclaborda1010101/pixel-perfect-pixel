-- Dedupe calls promoted from HubSpot (keep oldest per hs id)
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY substring(resumen from '\[hs:([^\]]+)\]') ORDER BY created_at) AS rn
  FROM public.calls
  WHERE resumen LIKE '[hs:%'
)
DELETE FROM public.calls
USING d
WHERE public.calls.id = d.id AND d.rn > 1;

-- Mark 9 orphan companies as seed
UPDATE public.companies
SET metadatos = metadatos || '{"seed":true}'::jsonb
WHERE id IN (
  '0a446b53-4e3b-441b-9c41-626ca461c512',
  'c0b6dff8-70d8-4c2a-ac09-943e4f74c662',
  'af1639dc-59a3-4c2a-bfd8-3d76186ca413',
  '76bb8603-1a73-4dd9-9c55-469b725da455',
  'd77b2fe6-706e-425a-967f-76cedc028245',
  '5079c515-40c9-49b2-ab01-32d0d998a1e4',
  '2386a174-1c7c-4721-8cac-bdb2ac1d44ad',
  'ae5b7cc1-2cd9-473d-b639-72bc8aea0a50',
  'ebbd39a4-d8c1-492b-8e45-cba4bbcf3f87'
);