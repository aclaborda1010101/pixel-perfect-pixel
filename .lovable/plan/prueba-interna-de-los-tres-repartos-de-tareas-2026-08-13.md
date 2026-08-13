# Prueba interna de los tres repartos de tareas

Comprobar que el generador respeta los porcentajes definidos para Apertura (20/60/20), Equilibrado (20/40/40) y Seguimiento (10/15/75), sin tocar datos.

## Qué se hará

1. Leer de la base de datos los porcentajes reales guardados para cada modo (no los del código), para verificar que coinciden con lo acordado.
2. Ejecutar el mismo motor de selección que usa el generador real, con 250 tareas simuladas por modo.
3. Repetir la medición en dos escenarios:
   - Todos los tipos de tarea disponibles (caso ideal).
   - Solo los tipos que hoy tienen candidatos reales en la base de datos (caso realista), consultando qué edificios/propietarios cumplen condiciones para cada tipo.
4. Comparar el reparto obtenido con el objetivo y calcular la desviación por tipo.

## Qué se entrega

Una tabla por modo con: tipo de tarea, porcentaje objetivo, porcentaje obtenido y desviación; más una nota sobre cualquier desvío causado por falta de candidatos reales de algún tipo.

## Detalles técnicos

- Script temporal fuera del proyecto que importa `elegirTipo` de `supabase/functions/_shared/generadorTareas.ts` (la misma función que usa la edge function `generate_next_task`).
- Los porcentajes se leen de `work_modes` (scope global); la disponibilidad de tipos se estima con consultas de solo lectura.
- Cero escrituras: no se crea ni borra ninguna tarea, ni se cambia el modo activo.
