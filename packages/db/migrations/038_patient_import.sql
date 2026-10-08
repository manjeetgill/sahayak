-- Bring-your-own patient list: imported patients carry no consents until they give them at their first check-in.
ALTER TABLE patients ADD COLUMN imported_at timestamptz;
ALTER TABLE patients ADD COLUMN import_batch uuid;
CREATE INDEX patients_import_batch ON patients (clinic_id, import_batch) WHERE import_batch IS NOT NULL;
