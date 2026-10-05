ALTER TABLE inbox_reviews ADD COLUMN handled_reason text;
ALTER TABLE clinical_entries ADD COLUMN verified_by uuid REFERENCES staff_users(id);
ALTER TABLE care_plan_steps ADD COLUMN flag_id uuid REFERENCES flags(id) ON DELETE SET NULL;
CREATE TABLE care_step_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 step_id uuid NOT NULL REFERENCES care_plan_steps(id) ON DELETE CASCADE,
 status text NOT NULL,
 response text,
 recorded_by uuid NOT NULL REFERENCES staff_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE care_step_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_step_history FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON care_step_history USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,DELETE ON care_step_history TO sahayak_app;
CREATE OR REPLACE FUNCTION protect_approved_instructions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='approved' AND current_user='sahayak_app' AND TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'Approved instructions cannot be changed; create a new draft';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER instruction_approval_guard BEFORE UPDATE ON patient_instructions FOR EACH ROW EXECUTE FUNCTION protect_approved_instructions();
