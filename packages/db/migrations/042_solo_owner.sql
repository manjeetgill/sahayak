ALTER TABLE staff_users
  ADD COLUMN solo_owner boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT staff_users_solo_owner_doctor CHECK (NOT solo_owner OR role = 'doctor');

CREATE UNIQUE INDEX one_solo_owner_per_clinic ON staff_users(clinic_id) WHERE solo_owner;
