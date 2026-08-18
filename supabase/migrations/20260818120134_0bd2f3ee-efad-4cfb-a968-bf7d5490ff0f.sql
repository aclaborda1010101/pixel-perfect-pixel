-- Prueba puntual del ciclo de sincronizacion con HubSpot (ya aplicada en base de datos).
-- El cambio de estado de las tareas se hace siempre a traves de las funciones autorizadas
-- (start_building_task / complete_building_task / reopen_building_task); no se deja aqui
-- ninguna escritura directa sobre building_tasks.
SELECT 1;
