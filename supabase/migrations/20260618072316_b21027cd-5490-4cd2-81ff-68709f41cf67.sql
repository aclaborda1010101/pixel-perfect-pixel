ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS summary_msg_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS handoff_reason text;