CREATE OR REPLACE FUNCTION public.match_owner_by_phone(p_phone text)
RETURNS TABLE(owner_id uuid, owner_nombre text, match_status text, buildings jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_count int;
  v_owner_id uuid;
  v_owner_nombre text;
  v_buildings jsonb;
BEGIN
  v_norm := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9);
  IF v_norm IS NULL OR length(v_norm) < 9 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'none'::text, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT count(*), min(o.id)
    INTO v_count, v_owner_id
  FROM public.owners o
  WHERE o.telefono IS NOT NULL
    AND right(regexp_replace(o.telefono, '\D', '', 'g'), 9) = v_norm
    AND o.merged_into IS NULL;

  IF v_count = 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'none'::text, '[]'::jsonb;
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'ambiguous'::text, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT nombre INTO v_owner_nombre FROM public.owners WHERE id = v_owner_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'building_id', b.id,
    'direccion', b.direccion,
    'cuota', bo.cuota
  ) ORDER BY bo.cuota DESC NULLS LAST), '[]'::jsonb)
    INTO v_buildings
  FROM public.building_owners bo
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE bo.owner_id = v_owner_id;

  RETURN QUERY SELECT v_owner_id, v_owner_nombre, 'matched'::text, v_buildings;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_owner_by_phone(text) TO authenticated, service_role;