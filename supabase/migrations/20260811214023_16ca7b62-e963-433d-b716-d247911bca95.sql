CREATE OR REPLACE FUNCTION public.work_modes_validate_mix()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE k text; total numeric := 0;
  allowed text[] := ARRAY['T-01','T-02_03','T-04','T-05','T-06','T-08'];
BEGIN
  FOR k IN SELECT jsonb_object_keys(NEW.mix) LOOP
    IF NOT (k = ANY(allowed)) THEN
      RAISE EXCEPTION 'Clave de mezcla no permitida: %', k;
    END IF;
    total := total + COALESCE((NEW.mix ->> k)::numeric, 0);
  END LOOP;
  IF round(total) <> 100 THEN
    RAISE EXCEPTION 'La mezcla debe sumar 100 (actual: %)', total;
  END IF;
  RETURN NEW;
END;
$fn$;

ALTER TABLE public.work_modes ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT false;
ALTER TABLE public.work_modes ADD COLUMN IF NOT EXISTS etiqueta text;

ALTER TABLE public.work_modes DROP CONSTRAINT IF EXISTS work_modes_mode_check;
DROP INDEX IF EXISTS public.work_modes_global_uniq;
ALTER TABLE public.work_modes ADD CONSTRAINT work_modes_mode_check
  CHECK (mode = ANY (ARRAY['apertura','equilibrado','seguimiento','manual','prospeccion','calidad']));

DELETE FROM public.work_modes WHERE scope = 'global';

INSERT INTO public.work_modes (scope, user_id, mode, etiqueta, mix, activo) VALUES
  ('global', NULL, 'apertura', 'Apertura',
   '{"T-01":20,"T-02_03":60,"T-04":20,"T-05":0,"T-06":0,"T-08":0}'::jsonb, false),
  ('global', NULL, 'equilibrado', 'Equilibrado',
   '{"T-01":20,"T-02_03":40,"T-04":40,"T-05":0,"T-06":0,"T-08":0}'::jsonb, true),
  ('global', NULL, 'seguimiento', 'Seguimiento',
   '{"T-01":10,"T-02_03":15,"T-04":75,"T-05":0,"T-06":0,"T-08":0}'::jsonb, false),
  ('global', NULL, 'manual', 'Manual (personalizado)',
   '{"T-01":20,"T-02_03":40,"T-04":40,"T-05":0,"T-06":0,"T-08":0}'::jsonb, false);

CREATE UNIQUE INDEX IF NOT EXISTS work_modes_global_mode_uq
  ON public.work_modes (mode) WHERE scope = 'global' AND user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_modes_global_activo_uq
  ON public.work_modes ((true)) WHERE scope = 'global' AND user_id IS NULL AND activo;

CREATE OR REPLACE FUNCTION public.set_task_generation_mode(
  p_mode text,
  p_mix jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.work_modes;
  v_old public.work_modes;
  v_mix jsonb;
  v_total numeric := 0;
  v_key text;
  v_val jsonb;
  v_allowed text[] := ARRAY['T-01','T-02_03','T-04','T-05','T-06','T-08'];
BEGIN
  IF NOT public.has_gestor_access(auth.uid()) THEN
    RAISE EXCEPTION 'no_autorizado';
  END IF;

  SELECT * INTO v_row FROM public.work_modes
   WHERE scope = 'global' AND user_id IS NULL AND mode = p_mode;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'modo_desconocido: %', p_mode;
  END IF;

  SELECT * INTO v_old FROM public.work_modes
   WHERE scope = 'global' AND user_id IS NULL AND activo LIMIT 1;

  v_mix := v_row.mix;

  IF p_mix IS NOT NULL THEN
    IF p_mode <> 'manual' THEN
      RAISE EXCEPTION 'porcentajes_fijos: solo el modo Manual admite porcentajes editables';
    END IF;
    IF jsonb_typeof(p_mix) <> 'object' THEN
      RAISE EXCEPTION 'mezcla_invalida';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_mix) LOOP
      IF NOT (v_key = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'tipo_desconocido: %', v_key;
      END IF;
      IF jsonb_typeof(v_val) <> 'number' OR (v_val::numeric) < 0 OR (v_val::numeric) > 100
         OR (v_val::numeric) <> trunc(v_val::numeric) THEN
        RAISE EXCEPTION 'porcentaje_invalido en %', v_key;
      END IF;
      v_total := v_total + (v_val::numeric);
    END LOOP;
    FOREACH v_key IN ARRAY v_allowed LOOP
      IF NOT (p_mix ? v_key) THEN
        RAISE EXCEPTION 'falta_tipo: %', v_key;
      END IF;
    END LOOP;
    IF v_total <> 100 THEN
      RAISE EXCEPTION 'suma_invalida: los porcentajes deben sumar exactamente 100 (actual: %)', v_total;
    END IF;
    v_mix := p_mix;
  END IF;

  UPDATE public.work_modes SET activo = false
   WHERE scope = 'global' AND user_id IS NULL AND activo AND mode <> p_mode;

  UPDATE public.work_modes
     SET mix = v_mix, activo = true, updated_at = now(), updated_by = auth.uid()
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  INSERT INTO public.work_mode_audit (scope, user_id, old_mode, new_mode, old_mix, new_mix, changed_by)
  VALUES ('global', NULL, v_old.mode, v_row.mode, v_old.mix, v_row.mix, auth.uid());

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_generation_mode(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_generation_mode(text, jsonb) TO authenticated;
