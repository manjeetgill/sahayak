ALTER TABLE clinic_payments ADD COLUMN IF NOT EXISTS voided_at timestamptz, ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES staff_users(id), ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE clinic_charges ADD COLUMN IF NOT EXISTS cancelled_at timestamptz, ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES staff_users(id);
ALTER TABLE medical_references ADD COLUMN IF NOT EXISTS archived_at timestamptz;
