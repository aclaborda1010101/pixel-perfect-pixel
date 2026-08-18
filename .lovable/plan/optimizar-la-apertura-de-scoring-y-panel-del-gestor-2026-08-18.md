# Optimizar la apertura de Scoring y Panel del gestor

## Objetivo
Reducir de forma perceptible el tiempo desde el clic hasta que aparecen datos útiles, manteniendo los datos actuales y los permisos existentes.

## Evidencia confirmada
- El catálogo de scoring pinta inicialmente 60 tarjetas, pero antes descarga los 1.166 edificios completos en dos páginas secuenciales.
- Cada lectura de `v_building_score` recalcula la vista completa: una consulta real de 50 filas tarda aproximadamente 4,3 segundos y toca más de 112.000 bloques de datos.
- El filtro por edificios no evita todo el trabajo interno: `v_owner_score` tarda aproximadamente 2 segundos para 20 edificios porque recorre y agrega las notas simples globales.
- El panel de Carlos inicia por separado la RPC del panel, el aviso de llamadas sin cerrar, el resumen de correcciones, el horario y la configuración de modos. La pantalla principal queda esperando a la RPC del panel.

## Implementación

### 1. Medir ambos recorridos con sesión real
- Registrar tiempos de red y render desde el clic hasta el primer contenido en Scoring y en el panel de Carlos.
- Medir individualmente las RPC y consultas que monta el panel para confirmar cuál bloquea la primera pintura.
- Guardar una referencia “antes” para comparar el resultado final.

### 2. Scoring: dejar de cargar y recalcular todo antes de mostrar
- Crear una consulta/RPC específica para las tarjetas de scoring, paginada en servidor y limitada a las columnas que realmente usa la cuadrícula.
- Aplicar en servidor el orden y los filtros del catálogo para que la primera respuesta contenga solo el primer lote visible; cargar los siguientes lotes al avanzar, sin descargar los 1.166 al entrar.
- Calcular los agregados necesarios solo para los edificios de la página solicitada, evitando ejecutar `v_building_score` completa por cada página.
- Mantener las columnas denormalizadas de `buildings` como fuente para los scores ya calculados y conservar exactamente las reglas visuales actuales.
- Añadir únicamente los índices que el `EXPLAIN ANALYZE` demuestre necesarios para filtros, orden y relaciones de esa consulta.
- Conservar React Query, pero añadir `staleTime` y precarga de la siguiente página para que volver a la pantalla y paginar sea inmediato sin mostrar datos obsoletos indefinidamente.

### 3. Panel de Carlos: entregar primero el equipo y diferir lo secundario
- Optimizar `get_sales_manager_panel` según su plan real de ejecución; añadir índices parciales por estado/fecha solo si el plan confirma que hacen falta.
- Evitar trabajo duplicado entre la pestaña Equipo y Productividad reutilizando la misma respuesta/cache cuando comparten periodo.
- Cargar al abrir únicamente la información de la pestaña Equipo; Histórico y Productividad consultarán al entrar en su pestaña.
- Hacer que avisos secundarios, correcciones, horario y configuración de modos no bloqueen la aparición de las tareas de David y del resto del equipo.
- Mantener intactas las restricciones de acceso del responsable y evitar lecturas directas de tareas ajenas desde el cliente.

### 4. Estados de carga y caché
- Mostrar el armazón de tarjetas/tablas desde el primer instante y sustituir cada bloque al llegar, en vez de retener toda la pantalla por una sola consulta.
- Reutilizar los datos ya cargados al navegar atrás y adelante, con invalidación explícita después de cambios que afecten tareas o scoring.
- No cambiar fórmulas, porcentajes, filtros, asignaciones ni contenido de las tarjetas.

### 5. Verificación
- Comparar tiempos antes/después en una sesión autenticada para ambos recorridos.
- Confirmar que filtros, orden, recuentos, pestañas y permisos devuelven los mismos resultados.
- Ejecutar pruebas específicas de paginación, filtros y panel del gestor, además del typecheck y la suite relevante.
- Revisar planes de ejecución finales para confirmar que la primera carga ya no recalcula ni descarga el catálogo completo.

## Resultado esperado
- Scoring muestra el primer lote tras una sola consulta acotada, sin esperar a los 1.166 edificios.
- El panel de Carlos muestra rápidamente las tareas del equipo y completa después los bloques secundarios.
- Los datos siguen siendo actuales; no se introduce un refresco periódico ni una caché materializada con retraso.
