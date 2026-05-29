
CREATE OR REPLACE FUNCTION public.count_distinct_owners(p_building_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT
    COALESCE(
      NULLIF(public.normalize_person_name(o.nombre),''),
      NULLIF(upper(o.metadatos->>'nif'),''),
      NULLIF(upper(o.metadatos->>'dni'),''),
      NULLIF(lower(o.email),''),
      o.id::text
    )
  )::integer
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id
  WHERE bo.building_id = p_building_id;
$$;
