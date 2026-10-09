-- Separate approval and delivery evidence for recurring evening messages.
CREATE TABLE patient_evening_settings (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  channel_id uuid,
  template_id text,
  reviewed_template jsonb,
  reviewed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_evening_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  follow_up_id uuid NOT NULL UNIQUE REFERENCES follow_ups(id) ON DELETE CASCADE,
  channel_id uuid,
  provider_id uuid,
  state text NOT NULL DEFAULT 'prepared',
  detail text,
  delivered_at timestamptz,
  read_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['patient_evening_settings','patient_evening_delivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
  END LOOP;
END $$;

-- The API owns platform-template evening sends. The generic worker must not send them again.
CREATE OR REPLACE FUNCTION due_followups(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, clinic_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id FROM follow_ups
   WHERE status='pending' AND evening_number IS NULL AND run_at<=now()
   ORDER BY run_at LIMIT p_limit $$;
