UPDATE public.building_tasks
   SET status = 'completed', completed_at = now()
 WHERE id = 'c55c15bd-7572-4ced-92b8-d20b0ebedb74';

UPDATE public.building_tasks
   SET updated_at = now()
 WHERE id = '1f8cf59d-e538-4dcc-85e3-312e83146ef3';