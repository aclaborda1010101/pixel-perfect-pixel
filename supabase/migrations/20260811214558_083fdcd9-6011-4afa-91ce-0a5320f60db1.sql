
DELETE FROM public.building_tasks
 WHERE user_id = '629f43a0-2e80-4be1-a402-516fddcabee9'
   AND task_key LIKE 'v5:gen1:%'
   AND status = 'pending'
   AND created_at >= now() - interval '30 minutes';

UPDATE public.work_modes SET activo = false WHERE scope = 'global' AND mode <> 'equilibrado';
UPDATE public.work_modes SET activo = true WHERE scope = 'global' AND mode = 'equilibrado';
