-- Clinical records: visit notes (drafted by the scribe, signed by the doctor) and patient documents.
ALTER TABLE doctors ADD COLUMN registration_no text;
ALTER TABLE doctors ADD COLUMN qualifications text;
ALTER TABLE clinic_settings ADD COLUMN ai_features jsonb NOT NULL DEFAULT '{"scribe": false}';
ALTER TABLE patients ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN clinical_hold_until date;      -- set when erasure was requested but signed records must be kept
ALTER TABLE patients ADD COLUMN erasure_requested_at timestamptz;

CREATE TABLE visit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed')),
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed','dictated')),
  transcript text NOT NULL,                       -- exactly what the doctor said or typed
  note jsonb NOT NULL DEFAULT '{}',               -- {complaint, history, examination, diagnosis, plan, follow_up}
  flags jsonb NOT NULL DEFAULT '[]',              -- things the scribe could not place
  amends_note_id uuid REFERENCES visit_notes(id),
  amend_reason text,
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz,
  signed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE INDEX ON visit_notes (patient_id, created_at DESC);

CREATE TABLE patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  uploaded_via text NOT NULL CHECK (uploaded_via IN ('whatsapp','staff')),
  kind text NOT NULL DEFAULT 'report' CHECK (kind IN ('report','photo','xray','other')),
  filename text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes int NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  data bytea NOT NULL,
  caption text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE INDEX ON patient_documents (patient_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visit_notes','patient_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- A signed note can never be edited or deleted by normal application code (amendments are new versions).
-- Only the vetted purge function below (after the retention period) may delete clinical records.
CREATE OR REPLACE FUNCTION guard_signed_notes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Blocks the application role. The purge function (security definer) and database administrators are not blocked.
  IF OLD.status = 'signed' AND current_user = 'sahayak_app' THEN
    RAISE EXCEPTION 'signed visit notes cannot be changed or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_notes_guard BEFORE UPDATE OR DELETE ON visit_notes FOR EACH ROW EXECUTE FUNCTION guard_signed_notes();

CREATE OR REPLACE FUNCTION purge_patient_clinical(p_clinic uuid, p_patient uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; c int;
BEGIN
  IF p_clinic IS DISTINCT FROM app_clinic_id() THEN RAISE EXCEPTION 'wrong clinic context'; END IF;
  PERFORM set_config('app.clinical_purge', 'on', true);
  DELETE FROM visit_notes WHERE patient_id = p_patient AND clinic_id = p_clinic AND amends_note_id IS NOT NULL;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM visit_notes WHERE patient_id = p_patient AND clinic_id = p_clinic;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM patient_documents WHERE patient_id = p_patient AND clinic_id = p_clinic;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  PERFORM set_config('app.clinical_purge', 'off', true);
  RETURN n;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION purge_patient_clinical(uuid, uuid) TO sahayak_app;
