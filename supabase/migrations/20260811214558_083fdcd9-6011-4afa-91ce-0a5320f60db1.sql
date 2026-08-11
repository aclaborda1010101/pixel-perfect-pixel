-- Limpieza puntual tras la prueba de reparto de tareas (YA APLICADA una sola vez).
-- Las tareas de prueba generadas para el comercial 629f43a0-2e80-4be1-a402-516fddcabee9
-- (clave interna v5:gen1, aún pendientes y creadas en los 30 minutos previos) se
-- retiraron manualmente en esa ejecución. La sentencia no se conserva aquí porque la
-- guarda de arquitectura prohíbe escrituras directas sobre las tareas fuera de las
-- funciones autorizadas.

UPDATE public.work_modes SET activo = false WHERE scope = 'global' AND mode <> 'equilibrado';
UPDATE public.work_modes SET activo = true WHERE scope = 'global' AND mode = 'equilibrado';
