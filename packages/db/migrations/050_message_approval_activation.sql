-- Clinic approval may be recorded while provider approval is pending.
-- This is never permission to dispatch an unapproved template.
ALTER TABLE patient_feedback_settings ADD COLUMN activation_requested boolean NOT NULL DEFAULT false;
ALTER TABLE patient_evening_settings ADD COLUMN activation_requested boolean NOT NULL DEFAULT false;
ALTER TABLE patient_feedback_settings ADD CONSTRAINT feedback_activation_exclusive CHECK (NOT (enabled AND activation_requested));
ALTER TABLE patient_evening_settings ADD CONSTRAINT evening_activation_exclusive CHECK (NOT (enabled AND activation_requested));
