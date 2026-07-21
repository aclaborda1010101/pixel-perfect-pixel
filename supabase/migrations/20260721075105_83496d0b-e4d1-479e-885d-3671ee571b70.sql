
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS score_activo numeric,
  ADD COLUMN IF NOT EXISTS score_propietarios numeric,
  ADD COLUMN IF NOT EXISTS score_propietarios_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS score_total numeric,
  ADD COLUMN IF NOT EXISTS score_propietarios_updated_at timestamptz;

UPDATE public.buildings
   SET score_activo = COALESCE(score_activo, score)
 WHERE score IS NOT NULL AND score_activo IS NULL;

CREATE OR REPLACE FUNCTION public.compute_owner_score(p_building_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score numeric := 50;
  v_signals jsonb := '[]'::jsonb;
  v_owner record;
  v_kpis jsonb;
  v_n_owners int := 0;
  v_n_contacted int := 0;
  v_n_positive int := 0;
  v_n_blocked int := 0;
  v_delta numeric;
  v_predis text; v_urg text; v_liq text; v_oferta text; v_tip text;
  v_all_blocked boolean := false;
BEGIN
  FOR v_owner IN
    SELECT bo.owner_id, bo.cuota, o.buyer_persona, o.subrole
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id
     WHERE bo.building_id = p_building_id AND o.merged_into IS NULL
  LOOP
    v_n_owners := v_n_owners + 1;
    SELECT kpis_json INTO v_kpis FROM public.owner_call_prep_cache
      WHERE owner_id = v_owner.owner_id LIMIT 1;

    IF v_kpis IS NOT NULL THEN
      v_n_contacted := v_n_contacted + 1;
      v_predis := lower(coalesce(v_kpis->>'predisposicion_a_vender', v_kpis->>'predisposicion',''));
      v_urg    := lower(coalesce(v_kpis->>'urgencia',''));
      v_liq    := lower(coalesce(v_kpis->>'necesidad_liquidez', v_kpis->>'liquidez',''));
      v_oferta := lower(coalesce(v_kpis->>'oferta_previa',''));
      v_tip    := upper(coalesce(v_kpis->>'tipologia', v_kpis->>'tipologia_confirmada',''));

      IF v_predis ~ '(quiere|necesita|vend)' AND v_predis !~ 'no' THEN
        v_delta := 18 * greatest(coalesce(v_owner.cuota,0.25), 0.25);
        v_score := v_score + v_delta;
        v_n_positive := v_n_positive + 1;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','predisposicion_positiva','delta',v_delta,'evidence',v_predis);
      ELSIF v_predis ~ 'condicion' THEN
        v_score := v_score + 6;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','predisposicion_condicionada','delta',6);
      ELSIF v_predis ~ '(bloque|no quiere|cerrad|nunca)' THEN
        v_score := v_score - 20; v_n_blocked := v_n_blocked + 1;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','bloqueado','delta',-20,'evidence',v_predis);
      END IF;

      IF v_urg ~ '(herenc|deud|mudanz|urgent|alta)' THEN
        v_score := v_score + 10;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','urgencia','delta',10,'evidence',v_urg);
      END IF;
      IF v_liq ~ '(si|alta|necesit)' AND v_liq !~ 'no' THEN
        v_score := v_score + 8;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','liquidez','delta',8);
      END IF;
      IF v_oferta ~ '(si|comentad|discutid|ofrec)' AND v_oferta !~ 'no' THEN
        v_score := v_score + 6;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','oferta_previa','delta',6);
      END IF;
      IF v_tip IN ('T1','T2','T5','T7') THEN
        v_score := v_score + 4;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','tipologia_favorable','delta',4,'evidence',v_tip);
      ELSIF v_tip IN ('T3','T6') THEN
        v_score := v_score - 3;
        v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','tipologia_dificil','delta',-3,'evidence',v_tip);
      END IF;
    END IF;
  END LOOP;

  IF v_n_owners = 0 THEN
    RETURN jsonb_build_object('score',50,'breakdown',jsonb_build_object('n_owners',0,'signals','[]'::jsonb,'notes','Sin propietarios registrados'));
  END IF;

  IF v_n_owners >= 4 THEN
    v_score := v_score + 6;
    v_signals := v_signals || jsonb_build_object('signal','muchos_propietarios','delta',6,'evidence',v_n_owners);
  ELSIF v_n_owners = 1 AND v_n_blocked = 1 THEN
    v_score := v_score - 25;
    v_signals := v_signals || jsonb_build_object('signal','propietario_unico_bloqueado','delta',-25);
  END IF;

  v_delta := least(10, round(10.0 * v_n_contacted / v_n_owners));
  v_score := v_score + v_delta;
  v_signals := v_signals || jsonb_build_object('signal','cobertura_kpi','delta',v_delta,
      'evidence',jsonb_build_object('contactados',v_n_contacted,'total',v_n_owners));

  v_all_blocked := (v_n_contacted > 0 AND v_n_blocked = v_n_contacted AND v_n_positive = 0);
  IF v_all_blocked THEN
    v_score := least(v_score, 15);
    v_signals := v_signals || jsonb_build_object('signal','tope_todos_cerrados','delta','cap<=15');
  END IF;

  v_score := greatest(0, least(100, v_score));

  RETURN jsonb_build_object(
    'score', round(v_score,1),
    'breakdown', jsonb_build_object(
      'n_owners', v_n_owners,
      'n_contactados', v_n_contacted,
      'n_positivos', v_n_positive,
      'n_bloqueados', v_n_blocked,
      'signals', v_signals,
      'formula', 'base 50 + señales ponderadas · clamp 0-100'
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.compute_owner_score(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_score_total(p_building_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_activo numeric; v_owner_score numeric; v_owner_result jsonb; v_total numeric;
BEGIN
  BEGIN v_activo := public.compute_score(p_building_id);
  EXCEPTION WHEN OTHERS THEN
    SELECT score INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END;
  IF v_activo IS NULL THEN
    SELECT score INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END IF;

  v_owner_result := public.compute_owner_score(p_building_id);
  v_owner_score := (v_owner_result->>'score')::numeric;
  v_total := round(coalesce(v_activo,0) * (0.30 + 0.70 * coalesce(v_owner_score,50)/100.0), 1);

  UPDATE public.buildings
     SET score_activo = coalesce(v_activo, score_activo),
         score_propietarios = v_owner_score,
         score_propietarios_breakdown = v_owner_result->'breakdown',
         score_total = v_total,
         score = v_total,
         score_propietarios_updated_at = now()
   WHERE id = p_building_id;
  RETURN v_total;
END $$;

GRANT EXECUTE ON FUNCTION public.compute_score_total(uuid) TO authenticated, service_role;

-- Trigger: call_sessions
CREATE OR REPLACE FUNCTION public.tg_call_session_recompute_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bid uuid;
BEGIN
  IF NEW.building_id IS NOT NULL THEN
    PERFORM public.compute_score_total(NEW.building_id);
  ELSIF NEW.owner_id IS NOT NULL THEN
    FOR v_bid IN SELECT DISTINCT building_id FROM public.building_owners WHERE owner_id = NEW.owner_id LOOP
      PERFORM public.compute_score_total(v_bid);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_call_session_score ON public.call_sessions;
CREATE TRIGGER trg_call_session_score
AFTER UPDATE OF voss_post, puntuacion ON public.call_sessions
FOR EACH ROW
WHEN ((OLD.voss_post IS DISTINCT FROM NEW.voss_post) OR (OLD.puntuacion IS DISTINCT FROM NEW.puntuacion))
EXECUTE FUNCTION public.tg_call_session_recompute_score();

-- Trigger: owner_call_prep_cache (INSERT + UPDATE, sin WHEN — se filtra en la función)
CREATE OR REPLACE FUNCTION public.tg_prep_cache_recompute_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bid uuid;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.kpis_json IS NOT DISTINCT FROM NEW.kpis_json THEN RETURN NEW; END IF;
  FOR v_bid IN SELECT DISTINCT building_id FROM public.building_owners WHERE owner_id = NEW.owner_id LOOP
    PERFORM public.compute_score_total(v_bid);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prep_cache_score ON public.owner_call_prep_cache;
CREATE TRIGGER trg_prep_cache_score
AFTER INSERT OR UPDATE OF kpis_json ON public.owner_call_prep_cache
FOR EACH ROW
EXECUTE FUNCTION public.tg_prep_cache_recompute_score();

-- Backfill inicial
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.buildings LOOP
    BEGIN PERFORM public.compute_score_total(r.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
