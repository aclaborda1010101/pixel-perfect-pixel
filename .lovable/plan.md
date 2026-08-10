# Diagnóstico del backend (solo lectura, sin cambios)

## 1. Evidencia observada ahora mismo

Comprobaciones ejecutadas (todas de lectura):

- Estado del backend: **activo y sano** desde el panel de la plataforma.
- `select 1` → **funciona** (respuesta inmediata).
- Conexiones: **12 en uso de 60 disponibles** → no hay agotamiento de conexiones.
- Tamaño de base de datos: **871 MB** → lejos de cualquier límite de disco.
- Consultas algo más pesadas (actividad detallada, historial de cron, estadísticas de consultas, métricas de salud) → **fallan de forma intermitente** con "Connection terminated due to connection timeout" y "context deadline exceeded".
- Registros de la base de datos: varios **"canceling statement due to statement timeout"** en los últimos minutos.
- Cron: **27 trabajos activos**, de los cuales 2 se ejecutan **cada minuto** y 9 **cada 5 minutos** (transcripciones, análisis de llamadas, sincronización HubSpot, reparse de notas, consentimiento WhatsApp, watchdog, etc.).

## 2. Qué está fallando exactamente

No falla "el backend" entero: falla la **capa de ejecución de consultas por saturación de CPU/E-S de la instancia**.

- La base de datos responde a lo trivial (`select 1`), luego el proceso Postgres está vivo y accesible.
- Todo lo que requiere trabajo real (leer catálogos grandes, estadísticas, métricas) se corta por tiempo.
- Auth Admin (`listUsers`) devolvió 504 y el endpoint de métricas expira: ambos dependen de la misma instancia saturada.
- Los códigos 499/502/504 que viste son **síntomas del mismo cuello de botella**, no fallos distintos: la petición se agota antes de recibir respuesta y cada capa la reporta con su propio código.

**Confianza: alta (~85%)** en que es saturación de recursos de la instancia (CPU/E-S), no una caída de la plataforma ni un problema de conexiones ni de disco.
Confianza media en la causa concreta: el volumen de trabajos programados es el sospechoso principal, pero no he podido leer el historial de ejecuciones de cron ni las estadísticas de consultas justamente porque esas consultas expiran.

## 3. Descartado con datos

- **Agotamiento de conexiones**: no (12/60).
- **Disco lleno**: no (871 MB).
- **Backend pausado o caído**: no, figura activo y responde.
- **Bloqueos/locks de larga duración**: no observados en el muestreo que sí completó (sólo 2 consultas activas, ninguna antigua salvo una conexión inactiva histórica).

## 4. Servicios externos (Maps, Drive, FileCloud, Firecrawl)

**No hay relación causal.** Esos servicios no consumen CPU de la base de datos; sólo la afectarían si alguna función programada los llamara y escribiera resultados masivamente. Desactivarlos no arregla los timeouts. Puede existir **correlación** aparente si el corte coincidió con un lote de enriquecimiento, pero eso sería el trabajo programado el que satura, no el servicio externo.

## 5. Riesgo de pérdida o corrupción de datos

**Riesgo de corrupción: prácticamente nulo.** Postgres es transaccional: una consulta cancelada por timeout deshace su transacción entera.
**Riesgo real: trabajo no realizado.** Ejecuciones de cron que fallen ahora (sincronizaciones, transcripciones, análisis) simplemente no se completan; se recuperarán en la siguiente pasada si el flujo es idempotente (el nuestro lo es, con claves de idempotencia y colas de reintento).

## 6. Qué hacemos nosotros (cuando lo autorices)

1. **Pausar temporalmente los trabajos más agresivos** (los de cada minuto y varios de cada 5 minutos) para dejar respirar a la instancia. Es la palanca más rápida y reversible.
2. **No lanzar ahora**: creación del usuario Carlos, migraciones, backfills, reparse masivo de notas, auditorías retroactivas. Esperar a que la instancia responda con normalidad.
3. Una vez estable, **medir**: historial de cron y estadísticas de consultas para identificar los 3-5 procesos que se llevan el tiempo.
4. Valorar **subir el tamaño de la instancia** de Lovable Cloud (Cloud → Ajustes avanzados → ampliar instancia). Con ~27 trabajos programados y sincronizaciones continuas contra HubSpot, el proyecto ha superado el dimensionamiento inicial.

## 7. Qué debe hacer soporte de Lovable

Confirmar si hay incidencia o degradación en la infraestructura de esa instancia, y revisar CPU/E-S y el endpoint de métricas (que hoy expira).

### Texto exacto para soporte

```text
Asunto: Timeouts intermitentes en la base de datos — project_id 9c1df87e-c8db-480f-94ec-e2461d3355cf / ref vsbrupwznqaaoiflvliu

El backend figura activo y responde a "select 1", pero cualquier consulta con algo de carga
falla de forma intermitente:
- "Connection terminated due to connection timeout" (HTTP 544 desde la API de consultas)
- "context deadline exceeded" al pedir /customer/v1/privileged/metrics (métricas no disponibles)
- Errores en los logs de Postgres: "canceling statement due to statement timeout"
- Auth Admin listUsers devolvió 504
- Previamente 499 (request_cancelled) y 502 (UNAVAILABLE) para la misma consulta mínima

Descartado por nuestra parte:
- Conexiones: 12 de 60 en uso
- Tamaño de base de datos: 871 MB
- Sin locks ni consultas largas visibles en el muestreo

Petición:
1) Confirmar si hay incidencia/degradación en la instancia o en el nodo que la aloja.
2) Revisar saturación de CPU/E-S y por qué el endpoint de métricas expira.
3) Indicar el tamaño de instancia actual y si recomiendan ampliarlo para este volumen
   (27 trabajos pg_cron activos, 2 cada minuto, 9 cada 5 minutos, sincronización continua con HubSpot).
```

## 8. Siguiente paso que te propongo

Autorízame a **pausar temporalmente los cron más frecuentes** (acción reversible, sin tocar datos) y a repetir las mediciones cuando la instancia se estabilice. Nada más se ejecutará hasta que lo apruebes.
