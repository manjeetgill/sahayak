CREATE TABLE care_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 family_id uuid NOT NULL,version integer NOT NULL,title text NOT NULL,steps jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES staff_users(id),approved_at timestamptz,archived_at timestamptz,
 UNIQUE(clinic_id,family_id,version)
);
ALTER TABLE care_plans ADD COLUMN template_id uuid REFERENCES care_templates(id), ADD COLUMN creation_request uuid;
CREATE UNIQUE INDEX ON care_plans(clinic_id,creation_request) WHERE creation_request IS NOT NULL;
ALTER TABLE care_plan_steps DROP CONSTRAINT care_plan_steps_status_check;
ALTER TABLE care_plan_steps ADD CONSTRAINT care_plan_steps_status_check CHECK(status IN ('pending','contacted','no_response','completed','needs_review','cancelled'));
ALTER TABLE care_plan_steps ADD COLUMN response_due_at timestamptz;
ALTER TABLE clinical_entries ADD COLUMN result_reviewed_at timestamptz, ADD COLUMN result_reviewed_by uuid REFERENCES staff_users(id), ADD COLUMN result_review_note text;
CREATE TABLE insurance_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,title text NOT NULL,
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','submitted','more_information','approved','denied','closed','cancelled')),
 assigned_to uuid NOT NULL REFERENCES staff_users(id),due_at timestamptz NOT NULL,
 document_id uuid REFERENCES patient_documents(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE insurance_case_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES insurance_cases(id) ON DELETE CASCADE,status text NOT NULL,note text NOT NULL,
 recorded_by uuid NOT NULL REFERENCES staff_users(id),created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['care_templates','insurance_cases','insurance_case_history'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
END LOOP; END $$;
