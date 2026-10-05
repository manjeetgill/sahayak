CREATE TABLE clinic_charges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, description text NOT NULL,
 amount_paise integer NOT NULL CHECK(amount_paise>0), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled')),
 created_by uuid NOT NULL REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinic_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 charge_id uuid NOT NULL REFERENCES clinic_charges(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,amount_paise integer NOT NULL CHECK(amount_paise>0),
 method text NOT NULL CHECK(method IN ('cash','card','upi','bank','other')),
 recorded_by uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(clinic_id,request_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clinic_charges','clinic_payments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
 END LOOP;
END $$;
