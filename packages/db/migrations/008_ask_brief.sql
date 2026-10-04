-- "Ask your clinic" and the daily brief.
ALTER TABLE staff_users ADD COLUMN phone text;            -- WhatsApp number for the daily brief and questions (optional)
ALTER TABLE clinic_settings ADD COLUMN brief jsonb NOT NULL DEFAULT '{"enabled": false, "time": "20:00"}';

CREATE TABLE daily_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  brief_date date NOT NULL,
  staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  text text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  delivered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, brief_date, staff_user_id)
);
ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON daily_briefs USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
