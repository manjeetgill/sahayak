-- Milestone 3: running-late proposals, follow-up jobs.
ALTER TABLE clinic_settings ADD COLUMN followup_rules jsonb NOT NULL
  DEFAULT '{"reminder_hours_before": 24, "post_visit_hours": 24, "recall_days": 90}';

ALTER TABLE queue_entries ADD COLUMN reminded_at timestamptz;

CREATE TABLE schedule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  minutes int NOT NULL CHECK (minutes BETWEEN 5 AND 240),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  requested_text text,
  created_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE schedule_shift_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES schedule_proposals(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  patient_id uuid REFERENCES patients(id),
  old_start timestamptz NOT NULL,
  new_start timestamptz NOT NULL,
  needs_rebooking boolean NOT NULL DEFAULT false,
  notified boolean NOT NULL DEFAULT false,
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','kept','rebooking','no_consent'))
);
CREATE INDEX ON schedule_shift_items (proposal_id);

CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('reminder','post_visit','recall')),
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON follow_ups (status, run_at);
CREATE UNIQUE INDEX follow_ups_once ON follow_ups (appointment_id, kind) WHERE appointment_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schedule_proposals','schedule_shift_items','follow_ups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- The background worker runs across clinics. It may only list WHICH follow-ups are due
-- (ids), then does the work inside each clinic's own row-level-security scope.
CREATE OR REPLACE FUNCTION due_followups(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, clinic_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id FROM follow_ups WHERE status='pending' AND run_at <= now() ORDER BY run_at LIMIT p_limit $$;

-- Clinics that have recall enabled (ids only), for the recall sweep.
CREATE OR REPLACE FUNCTION clinics_for_sweeps() RETURNS TABLE (id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT clinic_id FROM clinic_settings WHERE COALESCE((modules->>'followups')::boolean, true) $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION due_followups(int), clinics_for_sweeps() TO sahayak_app;
