CREATE TYPE public.assignment_status AS ENUM ('active', 'paused', 'discarded');

ALTER TABLE public.building_assignments
  ADD COLUMN status public.assignment_status NOT NULL DEFAULT 'active';

CREATE INDEX idx_building_assignments_user_status ON public.building_assignments (user_id, status);