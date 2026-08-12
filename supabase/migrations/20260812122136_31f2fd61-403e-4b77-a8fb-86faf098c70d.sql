DELETE FROM public.building_tasks
WHERE user_id = '629f43a0-2e80-4be1-a402-516fddcabee9'
  AND task_key LIKE 'v5:gen1:%'
  AND created_at > now() - interval '40 minutes';