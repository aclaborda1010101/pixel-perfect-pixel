
CREATE OR REPLACE VIEW public.v_dashboard_call_heatmap AS
SELECT EXTRACT(DOW FROM fecha)::int AS dow,
       EXTRACT(HOUR FROM fecha)::int AS hr,
       COUNT(*)::int AS calls
FROM public.calls
WHERE fecha > now() - interval '180 days'
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_dashboard_city_conversion AS
SELECT b.ciudad,
       COUNT(*)::int AS total,
       COUNT(DISTINCT bo.building_id)::int AS trabajados
FROM public.buildings b
LEFT JOIN public.building_owners bo ON bo.building_id = b.id
GROUP BY b.ciudad;

CREATE OR REPLACE VIEW public.v_dashboard_buildings_worked AS
SELECT (SELECT COUNT(*) FROM public.buildings)::int AS total,
       (SELECT COUNT(DISTINCT building_id) FROM public.building_owners)::int AS con_propietarios,
       (SELECT COUNT(DISTINCT building_id) FROM public.notas_simples WHERE building_id IS NOT NULL)::int AS con_nota_simple;

GRANT SELECT ON public.v_dashboard_call_heatmap TO anon, authenticated;
GRANT SELECT ON public.v_dashboard_city_conversion TO anon, authenticated;
GRANT SELECT ON public.v_dashboard_buildings_worked TO anon, authenticated;
