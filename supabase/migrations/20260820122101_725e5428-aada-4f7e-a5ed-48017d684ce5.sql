DROP FUNCTION IF EXISTS public.edificios_sin_propietarios_con_deal(int, boolean);
CREATE OR REPLACE FUNCTION public.edificios_sin_propietarios_con_deal(p_limit int DEFAULT 25, p_solo_verificados boolean DEFAULT false, p_offset int DEFAULT 0)
RETURNS TABLE(id uuid, direccion text, hs_deal_id text, porcentajes_estado text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.direccion, b.hs_deal_id::text, b.porcentajes_estado
  FROM public.buildings b
  WHERE b.hs_deal_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = b.id)
    AND (NOT p_solo_verificados OR b.porcentajes_estado IN ('verificado','verificado_pendiente_matching','sin_propietarios'))
  ORDER BY (b.porcentajes_estado = 'verificado') DESC, b.direccion, b.id
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.edificios_sin_propietarios_con_deal(int, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edificios_sin_propietarios_con_deal(int, boolean, int) TO authenticated, service_role;