
CREATE TABLE IF NOT EXISTS public.building_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL DEFAULT 'manual',
  task_key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_building_tasks_user_status ON public.building_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_building_tasks_building ON public.building_tasks(building_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_building_tasks_auto_unique
  ON public.building_tasks(building_id, user_id, task_key)
  WHERE task_key IS NOT NULL;

ALTER TABLE public.building_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select_own" ON public.building_tasks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tasks_insert_own" ON public.building_tasks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tasks_update_own" ON public.building_tasks
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tasks_delete_own" ON public.building_tasks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tasks_admin_all" ON public.building_tasks
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER building_tasks_set_updated_at
  BEFORE UPDATE ON public.building_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
