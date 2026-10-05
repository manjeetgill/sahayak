CREATE TABLE inbox_reviews (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 item_key text NOT NULL,
 patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
 assigned_to uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 acknowledged_at timestamptz,
 acknowledged_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
 snoozed_until timestamptz,
 handled_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(clinic_id,item_key)
);
CREATE TABLE clinical_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('medication','allergy','diagnosis','lab','investigation','referral','insurance')),
 data jsonb NOT NULL,
 document_id uuid REFERENCES patient_documents(id) ON DELETE SET NULL,
 recorded_by uuid NOT NULL REFERENCES staff_users(id),
 occurred_on date NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','stopped','entered_in_error')),
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON clinical_entries(clinic_id,patient_id,kind,occurred_on DESC);
CREATE TABLE patient_instructions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 note_id uuid NOT NULL REFERENCES visit_notes(id) ON DELETE CASCADE,
 language text NOT NULL CHECK(language IN ('en','hi')),
 body text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_by uuid NOT NULL REFERENCES staff_users(id),
 approved_by uuid REFERENCES staff_users(id),
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE care_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 title text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','cancelled')),
 assigned_to uuid NOT NULL REFERENCES staff_users(id),
 created_by uuid NOT NULL REFERENCES staff_users(id),
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE care_plan_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 title text NOT NULL,
 message text NOT NULL,
 due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacted','completed','needs_review','cancelled')),
 response text,
 contacted_at timestamptz,
 responded_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON care_plan_steps(clinic_id,status,due_at);
CREATE TABLE medical_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 title text NOT NULL,
 url text NOT NULL,
 published_on date NOT NULL,
 notes text NOT NULL,
 reviewed_by uuid NOT NULL REFERENCES staff_users(id),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 review_due date NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['inbox_reviews','clinical_entries','patient_instructions','care_plans','care_plan_steps','medical_references'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id=app_clinic_id()) WITH CHECK (clinic_id=app_clinic_id())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
 END LOOP;
END $$;
