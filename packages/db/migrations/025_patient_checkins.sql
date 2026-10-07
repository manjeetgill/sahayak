CREATE TABLE patient_checkins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 queue_entry_id uuid NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
 assigned_to uuid NOT NULL REFERENCES staff_users(id),
 scheduled_at timestamptz NOT NULL,
 language text NOT NULL CHECK (language IN ('en','hi')),
 consented_at timestamptz NOT NULL DEFAULT now(),
 consent_notice text NOT NULL DEFAULT 'patient-checkin-v1',
 created_by uuid NOT NULL REFERENCES staff_users(id),
 status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
 cancelled_at timestamptz,
 cancellation_reason text CHECK (cancellation_reason IN ('staff','consent_withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patient_checkins_active_visit ON patient_checkins(clinic_id,queue_entry_id) WHERE status='scheduled';
CREATE INDEX ON patient_checkins(clinic_id,status,scheduled_at);
ALTER TABLE patient_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_checkins FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON patient_checkins USING (clinic_id=app_clinic_id()) WITH CHECK (clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON patient_checkins TO sahayak_app;
