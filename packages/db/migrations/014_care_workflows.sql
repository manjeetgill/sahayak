CREATE TABLE care_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('report','referral','document','followup','instructions')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','received','reviewed','informed','cancelled')),
  assigned_to uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL,
  document_id uuid REFERENCES patient_documents(id) ON DELETE SET NULL,
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  informed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON care_tasks (clinic_id,status,due_at);
CREATE TABLE appointment_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  from_date date NOT NULL,
  to_date date NOT NULL CHECK (to_date >= from_date),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','booked','withdrawn')),
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON appointment_waitlist (clinic_id,patient_id,doctor_id) WHERE status='waiting';
CREATE TABLE slot_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  waitlist_id uuid NOT NULL REFERENCES appointment_waitlist(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','declined')),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id,code)
);
CREATE UNIQUE INDEX ON slot_offers (clinic_id,doctor_id,starts_at) WHERE status='pending';
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['care_tasks','appointment_waitlist','slot_offers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id=app_clinic_id()) WITH CHECK (clinic_id=app_clinic_id())',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
  END LOOP;
END $$;
ALTER TABLE outbox ADD COLUMN slot_offer_id uuid REFERENCES slot_offers(id) ON DELETE CASCADE;
