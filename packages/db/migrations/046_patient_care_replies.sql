ALTER TABLE care_step_history ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE care_step_history ADD COLUMN source text NOT NULL DEFAULT 'staff'
  CHECK (source IN ('staff','patient_web'));
