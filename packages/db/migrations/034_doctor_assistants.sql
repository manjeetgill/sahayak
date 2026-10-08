CREATE TABLE doctor_assistant_access (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('whatsapp','phone','reminders')),
 allowed boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(clinic_id,doctor_id,kind)
);
ALTER TABLE doctor_assistant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_assistant_access FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON doctor_assistant_access USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON doctor_assistant_access TO sahayak_app;
ALTER TABLE custom_agents ADD COLUMN doctor_id uuid REFERENCES doctors(id) ON DELETE CASCADE;
CREATE INDEX ON custom_agents(clinic_id,doctor_id);
