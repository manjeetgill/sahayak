CREATE TABLE schedule_message_delivery (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 item_id uuid NOT NULL UNIQUE REFERENCES schedule_shift_items(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 body text NOT NULL,
 next_state jsonb NOT NULL,
 channel_id uuid,
 provider_id uuid,
 state text NOT NULL DEFAULT 'pending',
 detail text,
 delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE schedule_message_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_message_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON schedule_message_delivery USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON schedule_message_delivery TO sahayak_app;
