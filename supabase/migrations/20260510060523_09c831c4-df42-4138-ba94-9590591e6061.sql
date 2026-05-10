ALTER TABLE public.next_actions
  ADD COLUMN IF NOT EXISTS scope_type text,
  ADD COLUMN IF NOT EXISTS scope_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS next_actions_dedupe_idx
  ON public.next_actions (scope_type, scope_id, origen, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE scope_type IS NOT NULL AND scope_id IS NOT NULL AND origen IS NOT NULL;

CREATE INDEX IF NOT EXISTS next_actions_scope_idx
  ON public.next_actions (scope_type, scope_id);