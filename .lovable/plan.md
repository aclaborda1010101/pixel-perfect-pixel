## Cambio

Aflojar el criterio de ⭐ **ESTRELLA** en la función `public.compute_cluster_score` (línea 202): pasar de AND a OR.

### Antes
```sql
IF COALESCE(v_terciario_pct,0) >= 0.66
   AND (v_2esc_confirmada OR v_n_escaleras_final >= 2) THEN
  v_es_estrella := true; ...
END IF;
```

### Después
```sql
IF COALESCE(v_terciario_pct,0) >= 0.66
   OR v_2esc_confirmada
   OR v_n_escaleras_final >= 2 THEN
  v_es_estrella := true; ...
END IF;
```

Es decir: se marca estrella si se cumple **cualquiera** de:
- Terciario ≥ 66 %, **o**
- 2ª escalera confirmada, **o**
- ≥ 2 escaleras detectadas (`n_escaleras_final ≥ 2`).

También actualizo el `label`/`detail` del aviso `estrella` para que refleje qué condición disparó la marca (terciario / 2 escaleras / ambas), en vez del texto actual "Terciario ≥66% + 2ª escalera".

### No se toca

- Umbrales: 66 % terciario se mantiene (es el actual, y lo has reconfirmado). No cambio a 60 %.
- Las alarmas independientes siguen igual: `alarma_terciario_alto` (≥66 %) y `alarma_protegido_2esc` (protegido + 2 escaleras).
- El upgrade a `ultra_prime` sigue condicionado a que exista además `alarma_prot_2esc` (protegido + 2 escaleras). Marcar estrella por sí sola NO sube el cluster.
- El score numérico no cambia por la estrella; la ordenación por `es_estrella` sigue haciéndose en frontend (ya implementado).
- Nada del bot de WhatsApp, ni de otras funciones.

### Cómo se aplica

- Migración SQL con `CREATE OR REPLACE FUNCTION public.compute_cluster_score(...)` conteniendo el cuerpo completo con el `IF` cambiado. No se modifica la firma ni permisos.
- Tras la migración, recalcular el score de todos los edificios para que `es_estrella` se actualice. Se hace invocando la edge function existente `recompute-all-scores` (ya en el proyecto), que recorre `buildings` llamando a `compute_cluster_score(id)`. Lo dispararé con `supabase--curl_edge_functions` una vez aplicada la migración.

### Verificación

1. `SELECT count(*) FROM buildings WHERE es_estrella` antes y después: debe crecer (ahora la condición es más laxa).
2. Elegir 2-3 edificios: uno con solo ≥2 escaleras y otro con solo ≥66 % terciario — comprobar que ambos aparecen como estrella y con la nueva razón en `avisos_inteligentes`.
3. En la vista comercial de Edificios, confirmar que aparecen ordenados con ⭐ arriba.
