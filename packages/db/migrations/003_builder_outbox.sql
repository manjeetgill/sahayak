-- Agent builder (doctor-configurable behaviour), outbound message queue, voice sessions.
ALTER TABLE clinic_settings ADD COLUMN faqs jsonb NOT NULL DEFAULT '[]';              -- [{id, keywords:[..], en, hi}]
ALTER TABLE clinic_settings ADD COLUMN agents jsonb NOT NULL
  DEFAULT '{"checkin":true,"queue":true,"intake":true,"front_desk":true,"schedule":true,"followup":true,"leads":true,"records":true}';

CREATE TABLE settings_changes (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES staff_users(id),
  field text NOT NULL,
  before jsonb, after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  to_contact text NOT NULL,
  body text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (status, next_attempt_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings_changes','outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION due_outbox(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, clinic_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id FROM outbox WHERE status='pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT p_limit $$;

-- Inbound webhooks name the clinic by the business number the patient wrote to.
ALTER TABLE clinic_settings ADD COLUMN whatsapp_number text UNIQUE;
CREATE OR REPLACE FUNCTION clinic_for_whatsapp_number(p_number text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT clinic_id FROM clinic_settings WHERE whatsapp_number = p_number $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app; -- both append-only
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION due_outbox(int), clinic_for_whatsapp_number(text) TO sahayak_app;
