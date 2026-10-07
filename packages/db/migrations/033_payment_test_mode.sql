ALTER TABLE clinic_charges ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE clinic_payments ADD COLUMN is_test boolean NOT NULL DEFAULT false;
