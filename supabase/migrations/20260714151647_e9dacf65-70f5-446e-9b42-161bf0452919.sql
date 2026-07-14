
CREATE TABLE IF NOT EXISTS public.pending_conversation_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  contact_id uuid,
  phone text,
  kind text NOT NULL,
  send_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_conv_emails_conv_kind_idx
  ON public.pending_conversation_emails(conversation_id, kind);
CREATE INDEX IF NOT EXISTS pending_conv_emails_due_idx
  ON public.pending_conversation_emails(status, send_at);

GRANT ALL ON public.pending_conversation_emails TO service_role;

ALTER TABLE public.pending_conversation_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages pending emails"
  ON public.pending_conversation_emails
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
