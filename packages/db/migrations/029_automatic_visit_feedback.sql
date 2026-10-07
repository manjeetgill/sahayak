-- Doctor-owned scheduling preferences are independent of admin-owned delivery approval.
CREATE TABLE doctor_feedback_preferences (
 doctor_id uuid PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 delay_days integer NOT NULL DEFAULT 1 CHECK (delay_days BETWEEN 0 AND 30),
 send_time time NOT NULL DEFAULT '18:00' CHECK (send_time >= '08:00' AND send_time < '21:00'),
 assigned_to uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 reminder_enabled boolean NOT NULL DEFAULT false,
 updated_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE doctor_feedback_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_feedback_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON doctor_feedback_preferences USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON doctor_feedback_preferences TO sahayak_app;
