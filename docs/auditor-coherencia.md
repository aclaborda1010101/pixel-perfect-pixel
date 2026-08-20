# Auditor de coherencia — cómo añadir una regla nueva

Cada vez que aparezca un fallo nuevo, se añade aquí su comprobación y ya no vuelve a escaparse.

Una regla es una fila en `public.coherencia_reglas`:

| columna | qué es |
|---|---|
| `codigo` | identificador corto y estable (`verificado_sin_propietarios`) |
| `nombre` | nombre en lenguaje llano, sin jerga: es lo que ve el cliente |
| `explicacion` | una línea: qué comprueba y por qué importa |
| `sql_casos` | consulta que devuelve **exactamente dos columnas**: `building_id uuid` (puede ser `NULL`) y `detalle text` |
| `activa` | `false` la retira del panel sin borrar el histórico |
| `aceptada` | la regla se sigue midiendo pero no suma al total (decisión consciente, con motivo) |

Ejemplo:

```sql
INSERT INTO public.coherencia_reglas (codigo, nombre, explicacion, sql_casos) VALUES
('edificios_sin_nota','Edificios sin nota simple','Sin nota registral no podemos confirmar quién es el dueño.',
 $q$SELECT b.id, b.direccion FROM buildings b
   WHERE NOT EXISTS (SELECT 1 FROM notas_simples n WHERE n.building_id = b.id)$q$);
```

Reglas del contrato:
- Una fila devuelta = un caso que incumple. Si el recuento debe ser por edificio, agrupa por edificio.
- El `detalle` es lo que se lee en la lista: pon el dato que ayuda (dirección, nombre, cifra que falla).
- Si `building_id` no es `NULL`, la lista enlaza a la ficha del edificio.

Medición:
- `SELECT public.coherencia_evaluar();` mide todas las reglas y guarda un snapshot (`coherencia_snapshots`).
- Se ejecuta sola cada noche a las 03:15 (`cron` job `coherencia_nocturna`).
- Si una regla falla al medirse, se guarda `n_casos = -1` con el error y el panel lo marca como «no se pudo medir».
- El panel vive en Orquestador → pestaña «Revisión de coherencia».
