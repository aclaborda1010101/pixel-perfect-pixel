CREATE TABLE public.descubrimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  fuente text NOT NULL DEFAULT 'stintelligencelab',
  tipo_busqueda text NOT NULL,
  clave_busqueda text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  telefonos_encontrados text[] NOT NULL DEFAULT '{}',
  domicilios jsonb NOT NULL DEFAULT '[]'::jsonb,
  empresa_vinculada jsonb,
  coste_monedas integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'propuesta',
  ambiguo boolean NOT NULL DEFAULT false,
  ambiguo_motivo text,
  simulado boolean NOT NULL DEFAULT false,
  task_id uuid,
  creado_por uuid,
  resuelto_por uuid,
  resuelto_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT descubrimientos_estado_chk CHECK (estado IN ('propuesta','aprobado','descartado','sin_acceso','error'))
);

GRANT SELECT, INSERT, UPDATE ON public.descubrimientos TO authenticated;
GRANT ALL ON public.descubrimientos TO service_role;

ALTER TABLE public.descubrimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipo interno lee descubrimientos"
ON public.descubrimientos FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "equipo interno crea descubrimientos"
ON public.descubrimientos FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE UNIQUE INDEX descubrimientos_cache_uq
  ON public.descubrimientos (fuente, tipo_busqueda, clave_busqueda);
CREATE INDEX descubrimientos_owner_idx ON public.descubrimientos (owner_id, created_at DESC);
CREATE INDEX descubrimientos_task_idx ON public.descubrimientos (task_id);

CREATE TRIGGER trg_descubrimientos_updated_at
BEFORE UPDATE ON public.descubrimientos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aprobación humana: única vía de escritura en la ficha del propietario.
CREATE OR REPLACE FUNCTION public.aprobar_descubrimiento(
  p_id uuid,
  p_telefono text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.descubrimientos%ROWTYPE;
  v_owner public.owners%ROWTYPE;
  v_tel text;
  v_destino text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;

  SELECT * INTO v_row FROM public.descubrimientos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'descubrimiento inexistente'; END IF;
  IF v_row.estado <> 'propuesta' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ya_resuelto', 'estado', v_row.estado);
  END IF;
  IF v_row.ambiguo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ambiguo', 'detalle', v_row.ambiguo_motivo);
  END IF;

  v_tel := NULLIF(btrim(COALESCE(p_telefono, v_row.telefonos_encontrados[1], '')), '');

  IF v_tel IS NOT NULL AND v_row.owner_id IS NOT NULL THEN
    SELECT * INTO v_owner FROM public.owners WHERE id = v_row.owner_id FOR UPDATE;
    IF FOUND THEN
      IF NULLIF(btrim(COALESCE(v_owner.telefono, '')), '') IS NULL THEN
        UPDATE public.owners
           SET telefono = v_tel, updated_at = now()
         WHERE id = v_row.owner_id;
        v_destino := 'telefono';
      ELSIF v_owner.telefono <> v_tel THEN
        UPDATE public.owners
           SET metadatos = COALESCE(metadatos, '{}'::jsonb) || jsonb_build_object(
                 'telefono_alternativo', v_tel,
                 'telefono_alternativo_origen', v_row.fuente || ':' || v_row.tipo_busqueda,
                 'telefono_alternativo_fecha', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
               ),
               updated_at = now()
         WHERE id = v_row.owner_id;
        v_destino := 'telefono_alternativo';
      ELSE
        v_destino := 'sin_cambios';
      END IF;
    END IF;
  ELSE
    v_destino := 'sin_telefono';
  END IF;

  UPDATE public.descubrimientos
     SET estado = 'aprobado', resuelto_por = auth.uid(), resuelto_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'destino', v_destino, 'telefono', v_tel);
END;
$fn$;

REVOKE ALL ON FUNCTION public.aprobar_descubrimiento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_descubrimiento(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.descartar_descubrimiento(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  UPDATE public.descubrimientos
     SET estado = 'descartado', resuelto_por = auth.uid(), resuelto_at = now()
   WHERE id = p_id AND estado = 'propuesta';
  RETURN jsonb_build_object('ok', FOUND);
END;
$fn$;

REVOKE ALL ON FUNCTION public.descartar_descubrimiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.descartar_descubrimiento(uuid) TO authenticated;