CREATE TABLE clinic_qr_settings (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 amount_paise integer NOT NULL DEFAULT 50000 CHECK(amount_paise BETWEEN 1 AND 100000000),
 public_web_url text,
 updated_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qr_arrivals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 doctor_id uuid NOT NULL REFERENCES doctors(id), arrival_date date NOT NULL,
 access_hash text NOT NULL UNIQUE,
 amount_paise integer NOT NULL CHECK(amount_paise>0),
 status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','queued','cancelled')),
 queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
 charge_id uuid REFERENCES clinic_charges(id) ON DELETE SET NULL,
 confirmed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours'
);
CREATE INDEX ON qr_arrivals(clinic_id,arrival_date,status);
CREATE UNIQUE INDEX qr_arrivals_pending_patient ON qr_arrivals(clinic_id,patient_id,arrival_date) WHERE status='awaiting_payment';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['clinic_qr_settings','qr_arrivals'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
 END LOOP;
END $$;
