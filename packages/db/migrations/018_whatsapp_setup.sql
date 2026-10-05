CREATE TABLE clinic_whatsapp_setup (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
 phone text NOT NULL, faq text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','STARTING','CONNECTING','OWNERSHIP_CHECK_REQUIRED','CHECK_REQUIRED','CONNECTED')),
 session_id uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clinic_whatsapp_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_whatsapp_setup FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON clinic_whatsapp_setup USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON clinic_whatsapp_setup TO sahayak_app;
