-- Custom agents: automations a doctor describes in plain words, built from a fixed set of safe building blocks.
CREATE TABLE custom_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',          -- the doctor's own words
  spec jsonb NOT NULL,                           -- {trigger, audience, action}: validated, never code
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  activated_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count int NOT NULL DEFAULT 0
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','skipped')),
  run_at timestamptz NOT NULL DEFAULT now(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,   -- set for event-triggered runs
  event_data jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON agent_runs (status, run_at);
CREATE INDEX ON agent_runs (agent_id, created_at DESC);

-- Per-patient frequency cap across ALL custom agents.
CREATE TABLE custom_agent_sends (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES custom_agents(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON custom_agent_sends (patient_id, sent_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_agents','agent_runs','custom_agent_sends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
