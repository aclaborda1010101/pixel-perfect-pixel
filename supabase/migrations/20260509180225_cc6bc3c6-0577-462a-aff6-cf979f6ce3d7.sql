
-- Tasks
CREATE TABLE public.hubspot_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_id text NOT NULL UNIQUE,
  hs_task_subject text,
  hs_task_body text,
  hs_task_status text,
  hs_task_priority text,
  hs_task_type text,
  hs_timestamp timestamptz,
  hs_task_completion_date timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  associated_contact_ids text[] DEFAULT '{}',
  associated_deal_ids text[] DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hubspot_tasks_status ON public.hubspot_tasks(hs_task_status);
CREATE INDEX idx_hubspot_tasks_timestamp ON public.hubspot_tasks(hs_timestamp DESC);
ALTER TABLE public.hubspot_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_tasks_select_all" ON public.hubspot_tasks FOR SELECT USING (true);
CREATE POLICY "hubspot_tasks_service_write" ON public.hubspot_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Calls
CREATE TABLE public.hubspot_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_id text NOT NULL UNIQUE,
  hs_call_title text,
  hs_call_body text,
  hs_call_status text,
  hs_call_direction text,
  hs_call_disposition text,
  hs_call_duration integer,
  hs_call_recording_url text,
  hs_call_to_number text,
  hs_call_from_number text,
  hs_timestamp timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  associated_contact_ids text[] DEFAULT '{}',
  associated_deal_ids text[] DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hubspot_calls_timestamp ON public.hubspot_calls(hs_timestamp DESC);
ALTER TABLE public.hubspot_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_calls_select_all" ON public.hubspot_calls FOR SELECT USING (true);
CREATE POLICY "hubspot_calls_service_write" ON public.hubspot_calls FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Notes
CREATE TABLE public.hubspot_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_id text NOT NULL UNIQUE,
  hs_note_body text,
  hs_timestamp timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  associated_contact_ids text[] DEFAULT '{}',
  associated_deal_ids text[] DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hubspot_notes_timestamp ON public.hubspot_notes(hs_timestamp DESC);
ALTER TABLE public.hubspot_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_notes_select_all" ON public.hubspot_notes FOR SELECT USING (true);
CREATE POLICY "hubspot_notes_service_write" ON public.hubspot_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lists
CREATE TABLE public.hubspot_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_list_id text NOT NULL UNIQUE,
  name text,
  list_type text,
  object_type_id text,
  processing_type text,
  size integer,
  created_at_hs timestamptz,
  updated_at_hs timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hubspot_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_lists_select_all" ON public.hubspot_lists FOR SELECT USING (true);
CREATE POLICY "hubspot_lists_service_write" ON public.hubspot_lists FOR ALL TO service_role USING (true) WITH CHECK (true);

-- List memberships
CREATE TABLE public.hubspot_list_memberships (
  hs_list_id text NOT NULL,
  record_id text NOT NULL,
  object_type text NOT NULL,
  added_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hs_list_id, record_id)
);
CREATE INDEX idx_hubspot_list_memberships_record ON public.hubspot_list_memberships(record_id, object_type);
ALTER TABLE public.hubspot_list_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_list_memberships_select_all" ON public.hubspot_list_memberships FOR SELECT USING (true);
CREATE POLICY "hubspot_list_memberships_service_write" ON public.hubspot_list_memberships FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Changes log (append-only versioning)
CREATE TABLE public.hubspot_changes_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  hs_id text NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id uuid
);
CREATE INDEX idx_hubspot_changes_log_entity ON public.hubspot_changes_log(entity_type, hs_id, observed_at DESC);
CREATE INDEX idx_hubspot_changes_log_observed ON public.hubspot_changes_log(observed_at DESC);
ALTER TABLE public.hubspot_changes_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_changes_log_select_all" ON public.hubspot_changes_log FOR SELECT USING (true);
CREATE POLICY "hubspot_changes_log_service_write" ON public.hubspot_changes_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Snapshots (weekly)
CREATE TABLE public.hubspot_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL,
  total_count integer NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_hubspot_snapshots_taken ON public.hubspot_snapshots(taken_at DESC);
ALTER TABLE public.hubspot_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_snapshots_select_all" ON public.hubspot_snapshots FOR SELECT USING (true);
CREATE POLICY "hubspot_snapshots_service_write" ON public.hubspot_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
