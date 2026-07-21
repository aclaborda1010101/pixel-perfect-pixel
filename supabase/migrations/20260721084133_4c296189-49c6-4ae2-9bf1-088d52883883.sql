
CREATE OR REPLACE FUNCTION public.build_score_summary(p_building_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_activo numeric; v_prop numeric; v_total numeric; br jsonb;
  m2 numeric; viv numeric; m2_com numeric; m2_ofi numeric;
  bits text[] := ARRAY[]::text[];
  parts text[] := ARRAY[]::text[];
  fecha text; frag text;
BEGIN
  SELECT score_activo, score_propietarios, score_total, coalesce(score_propietarios_breakdown,'{}'::jsonb)
    INTO v_activo, v_prop, v_total, br
    FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT vs.m2_total, vs.num_viviendas, vs.m2_comercio_x, vs.m2_oficina_x
    INTO m2, viv, m2_com, m2_ofi
    FROM public.v_building_score vs WHERE vs.id = p_building_id;

  IF m2 IS NOT NULL THEN bits := array_append(bits, round(m2)::int::text || ' m²'); END IF;
  IF viv IS NOT NULL THEN bits := array_append(bits, round(viv)::int::text || ' viv'); END IF;
  IF m2 IS NOT NULL AND viv IS NOT NULL AND viv > 0 THEN
    bits := array_append(bits, round(m2/viv)::int::text || ' m²/viv');
  END IF;
  IF m2 IS NOT NULL AND m2 > 0 THEN
    bits := array_append(bits, round(100*(coalesce(m2_com,0)+coalesce(m2_ofi,0))/m2)::int::text || '% terciario');
  END IF;

  IF v_activo IS NOT NULL THEN
    parts := array_append(parts, format('Activo %s%s', round(v_activo)::int::text,
      CASE WHEN array_length(bits,1)>0 THEN ' ('||array_to_string(bits,', ')||')' ELSE '' END));
  END IF;

  IF v_prop IS NOT NULL THEN
    bits := ARRAY[]::text[];
    IF (br->>'n_owners') IS NOT NULL THEN bits := array_append(bits, (br->>'n_owners')::text || ' propietarios'); END IF;
    fecha := NULL;
    IF (br->>'last_call_at') IS NOT NULL THEN fecha := to_char((br->>'last_call_at')::timestamptz,'DD/MM'); END IF;
    IF coalesce((br->>'mayoria_vendedora')::boolean,false) THEN
      bits := array_append(bits, 'mayoría con intención de venta declarada'||coalesce(' —cita '||fecha,''));
    END IF;
    IF coalesce((br->>'oferta_previa_edificio')::boolean,false) THEN
      bits := array_append(bits, 'oferta previa discutida');
    END IF;
    IF coalesce((br->>'impulsor_edificio')::boolean,false) OR coalesce((br->>'n_impulsor')::int,0) > 0 THEN
      bits := array_append(bits, 'impulsor identificado');
    END IF;
    IF coalesce((br->>'n_positivos')::int,0) > 0 THEN
      bits := array_append(bits, (br->>'n_positivos')::text || ' con predisposición explícita a vender');
    END IF;
    IF coalesce((br->>'n_bloqueados')::int,0) > 0 THEN
      bits := array_append(bits, CASE WHEN (br->>'n_bloqueados')::int=1 THEN '1 bloqueador identificado'
                                      ELSE (br->>'n_bloqueados')::text||' bloqueadores' END);
    END IF;
    IF (br->>'n_contactados') IS NOT NULL AND (br->>'n_owners') IS NOT NULL THEN
      bits := array_append(bits, (br->>'n_contactados')::text || '/' || (br->>'n_owners')::text || ' contactados');
    END IF;
    parts := array_append(parts, format('Propietarios %s%s', round(v_prop)::int::text,
      CASE WHEN array_length(bits,1)>0 THEN ' ('||array_to_string(bits,'; ')||')' ELSE '' END));
  END IF;

  frag := array_to_string(parts, ' × ');
  IF v_total IS NOT NULL THEN
    frag := frag || format(' → Total %s (media ponderada 60%% activo · 40%% propietarios).', round(v_total)::int::text);
  END IF;
  RETURN frag;
END $function$;

DO $$
DECLARE r record; res jsonb; new_total numeric;
BEGIN
  FOR r IN
    SELECT DISTINCT b.id, b.score_activo
      FROM public.buildings b
      LEFT JOIN public.building_owners bo ON bo.building_id = b.id
      LEFT JOIN public.owner_call_prep_cache c ON c.owner_id = bo.owner_id
      LEFT JOIN public.call_sessions cs ON cs.building_id = b.id AND cs.voss_post IS NOT NULL
     WHERE c.owner_id IS NOT NULL OR cs.id IS NOT NULL
  LOOP
    res := public.compute_owner_score(r.id);
    new_total := CASE WHEN r.score_activo IS NOT NULL AND (res->>'score') IS NOT NULL
                      THEN round(0.6 * r.score_activo + 0.4 * (res->>'score')::numeric, 1)
                      ELSE r.score_activo END;
    UPDATE public.buildings
       SET score_propietarios = (res->>'score')::numeric,
           score_propietarios_breakdown = res->'breakdown',
           score_total = new_total,
           score_propietarios_updated_at = now(),
           updated_at = now()
     WHERE id = r.id;
    UPDATE public.buildings SET score_summary = public.build_score_summary(r.id) WHERE id = r.id;
  END LOOP;
END $$;
