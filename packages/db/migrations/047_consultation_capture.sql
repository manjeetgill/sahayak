-- Consent for browser speech capture. Audio is never stored by Sahayak.
CREATE TABLE consultation_capture_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  recorded_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  agreed_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  method text NOT NULL DEFAULT 'browser_speech' CHECK (method = 'browser_speech')
);
CREATE INDEX consultation_capture_patient ON consultation_capture_consents (patient_id, agreed_at DESC);
ALTER TABLE consultation_capture_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_capture_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON consultation_capture_consents
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON consultation_capture_consents TO sahayak_app;

ALTER TABLE visit_notes DROP CONSTRAINT IF EXISTS visit_notes_source_check;
ALTER TABLE visit_notes ADD CONSTRAINT visit_notes_source_check
  CHECK (source IN ('typed', 'dictated', 'conversation'));
ALTER TABLE visit_notes ADD COLUMN capture_consent_id uuid
  REFERENCES consultation_capture_consents(id) ON DELETE SET NULL;

-- Names only: no doses, formulations, indications or automated medicine selection.
CREATE TABLE doctor_medicine_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, name)
);
ALTER TABLE doctor_medicine_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_medicine_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON doctor_medicine_catalog
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT, DELETE ON doctor_medicine_catalog TO sahayak_app;
