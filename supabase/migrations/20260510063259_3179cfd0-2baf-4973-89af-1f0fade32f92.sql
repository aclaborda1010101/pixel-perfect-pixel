DROP INDEX IF EXISTS public.next_actions_dedupe_idx;
CREATE UNIQUE INDEX next_actions_dedupe_idx
  ON public.next_actions (scope_type, scope_id, origen)
  WHERE scope_type IS NOT NULL AND scope_id IS NOT NULL AND origen IS NOT NULL;