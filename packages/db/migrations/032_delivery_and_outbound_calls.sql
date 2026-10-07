ALTER TABLE patient_feedback_delivery ADD COLUMN channel_id uuid;
ALTER TABLE patient_feedback_delivery ADD COLUMN last_checked_at timestamptz;
ALTER TABLE patient_feedback_delivery ADD COLUMN read_at timestamptz;
CREATE TABLE outbound_call_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 requested_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 -- Only user-authorized test destinations; no patient clinical data is sent.
 destination text NOT NULL, agent_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('submitting','accepted','ringing','answered','completed','failed','unknown')),
 provider_call_id uuid, detail text, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE outbound_call_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_call_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON outbound_call_requests USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON outbound_call_requests TO sahayak_app;
CREATE INDEX ON outbound_call_requests(clinic_id,created_at);
