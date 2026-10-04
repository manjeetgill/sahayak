-- Public API keys, outbound webhooks and their delivery queue.
ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check CHECK (source IN ('manual','whatsapp','walk_in','agent','api'));

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,                       -- public part of the key, used for lookup
  key_hash text NOT NULL,                            -- sha256 of the full key; the key itself is shown once
  scopes text[] NOT NULL DEFAULT '{read}',           -- read | write | admin
  created_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL,
  level text NOT NULL DEFAULT 'minimal' CHECK (level IN ('minimal','full')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_reason text
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_http_status int,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX ON webhook_deliveries (webhook_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','webhooks','webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- An API call arrives with only the key, before any clinic is known.
CREATE OR REPLACE FUNCTION auth_lookup_api_key(p_prefix text)
RETURNS TABLE (id uuid, clinic_id uuid, key_hash text, scopes text[]) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id, key_hash, scopes FROM api_keys WHERE prefix = p_prefix AND revoked_at IS NULL $$;

CREATE OR REPLACE FUNCTION due_webhook_deliveries(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, clinic_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id FROM webhook_deliveries WHERE status='pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT p_limit $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION auth_lookup_api_key(text), due_webhook_deliveries(int) TO sahayak_app;
