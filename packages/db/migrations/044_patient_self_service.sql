CREATE TABLE patient_access_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON patient_access_links(clinic_id,patient_id,expires_at DESC);
ALTER TABLE patient_access_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_access_links FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON patient_access_links
  USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON patient_access_links TO sahayak_app;

ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check
  CHECK (source IN ('manual','whatsapp','walk_in','agent','api','patient_web'));
ALTER TABLE patient_documents DROP CONSTRAINT patient_documents_uploaded_via_check;
ALTER TABLE patient_documents ADD CONSTRAINT patient_documents_uploaded_via_check
  CHECK (uploaded_via IN ('whatsapp','staff','patient_web'));
