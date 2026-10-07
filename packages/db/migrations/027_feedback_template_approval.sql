ALTER TABLE patient_feedback_settings ADD COLUMN reviewed_template jsonb;
ALTER TABLE patient_feedback_settings ADD COLUMN reviewed_by uuid REFERENCES staff_users(id);
