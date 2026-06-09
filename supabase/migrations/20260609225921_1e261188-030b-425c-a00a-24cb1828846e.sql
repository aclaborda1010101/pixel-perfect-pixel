
CREATE OR REPLACE FUNCTION public.normalize_pct_propiedad(raw text)
RETURNS TABLE(pct numeric, normalizado boolean, invalido boolean, raw_value text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s text;
  num numeric;
  denom numeric;
  v numeric;
  m text[];
BEGIN
  raw_value := raw;
  IF raw IS NULL THEN
    pct := NULL; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
  s := btrim(raw);
  IF s = '' OR s = '-' THEN
    pct := NULL; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
  IF s = '0' OR s = '0%' OR s = '0,0' OR s = '0.0' THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END IF;

  m := regexp_match(s, '^(\d+)\s*/\s*(\d+)$');
  IF m IS NOT NULL THEN
    num := m[1]::numeric; denom := m[2]::numeric;
    IF denom > 0 AND num <= denom THEN
      pct := round(num/denom*100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
    ELSE
      pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
    END IF;
  END IF;

  s := replace(replace(s, '%', ''), ',', '.');
  m := regexp_match(s, '(-?\d+(?:\.\d+)?)');
  IF m IS NULL THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END IF;
  BEGIN
    v := m[1]::numeric;
  EXCEPTION WHEN OTHERS THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END;

  IF v <= 0 THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  ELSIF v <= 1 THEN
    pct := round(v*100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
  ELSIF v = 100 THEN
    pct := 100; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  ELSIF v > 100 AND v < 10000 THEN
    pct := round(v/100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
  ELSIF v >= 10000 THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  ELSE
    pct := round(v, 2); normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_pct_propiedad(text) TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.v_owner_score CASCADE;

CREATE VIEW public.v_owner_score AS
WITH ns_pct AS (
  SELECT t.owner_id,
         n.building_id,
         avg(np.pct) FILTER (WHERE np.pct IS NOT NULL) AS pct,
         bool_or(np.normalizado) AS normalizado,
         bool_and(np.invalido) AS all_invalid,
         max(np.raw_value) AS raw_value
  FROM nota_simple_titulares t
  JOIN notas_simples n ON n.id = t.nota_simple_id
  CROSS JOIN LATERAL public.normalize_pct_propiedad(t.porcentaje::text) np
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL
  GROUP BY t.owner_id, n.building_id
),
pct_resolved AS (
  SELECT
    bo.owner_id,
    bo.building_id,
    CASE
      WHEN np.pct IS NOT NULL THEN np.pct
      WHEN hs.pct IS NOT NULL THEN hs.pct
      WHEN mp.pct IS NOT NULL THEN mp.pct
    END AS pct_propiedad,
    CASE
      WHEN np.pct IS NOT NULL THEN 'nota_simple'
      WHEN hs.pct IS NOT NULL THEN 'hubspot'
      WHEN mp.pct IS NOT NULL THEN 'metadata'
      ELSE 'desconocido'
    END AS pct_origen,
    CASE
      WHEN np.pct IS NOT NULL THEN COALESCE(np.normalizado, false)
      WHEN hs.pct IS NOT NULL THEN hs.normalizado
      WHEN mp.pct IS NOT NULL THEN mp.normalizado
      ELSE false
    END AS pct_normalizado,
    CASE
      WHEN np.pct IS NULL AND hs.pct IS NULL AND mp.pct IS NULL
       AND (COALESCE(np.all_invalid, false) OR COALESCE(hs.invalido, false) OR COALESCE(mp.invalido, false))
      THEN true ELSE false
    END AS pct_invalido,
    COALESCE(np.raw_value, hs.raw_value, mp.raw_value) AS pct_raw
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id
  LEFT JOIN ns_pct np ON np.owner_id = bo.owner_id AND np.building_id = bo.building_id
  LEFT JOIN LATERAL public.normalize_pct_propiedad(bo.cuota::text) hs ON true
  LEFT JOIN LATERAL public.normalize_pct_propiedad(o.metadatos->>'porcentaje_de_participacion') mp ON true
)
SELECT
  o.id AS owner_id,
  o.nombre,
  o.telefono,
  o.email,
  o.rol,
  bo.building_id,
  bo.subrole,
  bo.rol_notas,
  bo.es_influencer,
  bo.influencer_score,
  bo.influencer_reason,
  o.metadatos,
  pr.pct_propiedad,
  pr.pct_origen,
  pr.pct_normalizado,
  pr.pct_invalido,
  pr.pct_raw,
  COALESCE(lc.calls_count, 0) AS contactos_previos,
  lc.last_call_at,
  round(
    (
      0.30 * CASE WHEN pr.pct_propiedad IS NULL THEN 0
                  ELSE (1.0 - LEAST(1.0, pr.pct_propiedad / 100.0)) END
    + 0.25 * CASE WHEN pr.pct_propiedad IS NULL THEN 0
                  ELSE LEAST(1.0, pr.pct_propiedad / 100.0) END
    + 0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0)::numeric / 5.0)
    + 0.15 * CASE WHEN o.rol = 'desconocido'::owner_role THEN 0 ELSE 1 END::numeric
    + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric
    ) * 100, 1
  ) AS score
FROM owners o
JOIN building_owners bo ON bo.owner_id = o.id
LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
LEFT JOIN v_owner_last_contact lc ON lc.owner_id = o.id;

GRANT SELECT ON public.v_owner_score TO anon, authenticated, service_role;
