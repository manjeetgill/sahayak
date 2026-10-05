ALTER TABLE patient_instructions DROP CONSTRAINT patient_instructions_language_check;
ALTER TABLE patient_instructions ADD CONSTRAINT patient_instructions_language_check CHECK(language IN ('en','hi','hinglish','mr','bn','ta','te','kn','gu'));
ALTER TABLE patient_instructions ADD COLUMN translated_from uuid REFERENCES patient_instructions(id) ON DELETE SET NULL, ADD COLUMN translation_source text;
