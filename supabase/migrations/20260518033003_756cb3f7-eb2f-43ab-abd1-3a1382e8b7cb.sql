
-- building_assignments
CREATE TABLE IF NOT EXISTS public.building_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (building_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_building_assignments_user ON public.building_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_building_assignments_building ON public.building_assignments(building_id);

ALTER TABLE public.building_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments_admin_all" ON public.building_assignments;
CREATE POLICY "assignments_admin_all" ON public.building_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "assignments_user_select_own" ON public.building_assignments;
CREATE POLICY "assignments_user_select_own" ON public.building_assignments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- current_user_role()
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin'::public.app_role THEN 1
    WHEN 'comercial_zona'::public.app_role THEN 2
    WHEN 'captacion'::public.app_role THEN 3
    WHEN 'prevalificacion'::public.app_role THEN 4
    WHEN 'viewer'::public.app_role THEN 5
    ELSE 9
  END
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;

-- v_owner_last_contact
CREATE OR REPLACE VIEW public.v_owner_last_contact AS
SELECT o.id AS owner_id,
       (SELECT MAX(c.fecha) FROM public.calls c WHERE c.owner_id = o.id) AS last_call_at,
       (SELECT COUNT(*) FROM public.calls c WHERE c.owner_id = o.id)::int AS calls_count
FROM public.owners o;

GRANT SELECT ON public.v_owner_last_contact TO authenticated, anon;

-- v_building_score
CREATE OR REPLACE VIEW public.v_building_score AS
WITH agg AS (
  SELECT b.id,
         b.direccion, b.ciudad, b.division_horizontal, b.metadatos, b.numero_propietarios,
         NULLIF(b.metadatos->>'m2_total','')::numeric AS m2_total,
         COALESCE(NULLIF(b.metadatos->>'num_viviendas','')::int, b.numero_propietarios) AS num_viviendas,
         (SELECT COUNT(*) FROM public.building_owners bo WHERE bo.building_id = b.id)::int AS owners_count
  FROM public.buildings b
)
SELECT id, direccion, ciudad, division_horizontal,
       m2_total, num_viviendas, owners_count,
       LEAST(1.0, COALESCE(num_viviendas, 0) / 40.0) AS s_viviendas,
       LEAST(1.0, COALESCE(m2_total, 0) / 4000.0) AS s_m2,
       CASE WHEN num_viviendas > 0 AND m2_total IS NOT NULL
            THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, (m2_total / NULLIF(num_viviendas,0)) / 150.0))
            ELSE 0 END AS s_ratio,
       LEAST(1.0, owners_count / 30.0) AS s_owners,
       CASE WHEN division_horizontal IS FALSE THEN 1.0 ELSE 0 END AS s_no_dh,
       ROUND((
         0.30 * LEAST(1.0, COALESCE(num_viviendas, 0) / 40.0) +
         0.20 * LEAST(1.0, COALESCE(m2_total, 0) / 4000.0) +
         0.20 * CASE WHEN num_viviendas > 0 AND m2_total IS NOT NULL
                     THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, (m2_total / NULLIF(num_viviendas,0)) / 150.0))
                     ELSE 0 END +
         0.20 * LEAST(1.0, owners_count / 30.0) +
         0.10 * CASE WHEN division_horizontal IS FALSE THEN 1.0 ELSE 0 END
       ) * 100, 1) AS score
FROM agg;

GRANT SELECT ON public.v_building_score TO authenticated, anon;

-- v_owner_score
CREATE OR REPLACE VIEW public.v_owner_score AS
SELECT
  o.id AS owner_id,
  o.nombre, o.telefono, o.email, o.rol,
  bo.building_id,
  bo.cuota AS pct_propiedad,
  COALESCE(lc.calls_count, 0) AS contactos_previos,
  lc.last_call_at,
  ROUND((
    0.45 * LEAST(1.0, COALESCE(bo.cuota, 0) / 100.0) +
    0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0) / 5.0) +
    0.20 * CASE WHEN o.rol = 'desconocido' THEN 0 ELSE 1 END +
    0.15 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END
  ) * 100, 1) AS score
FROM public.owners o
LEFT JOIN public.building_owners bo ON bo.owner_id = o.id
LEFT JOIN public.v_owner_last_contact lc ON lc.owner_id = o.id;

GRANT SELECT ON public.v_owner_score TO authenticated, anon;
