CREATE TABLE solo_closeouts (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  clinic_date date NOT NULL,
  counts jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(clinic_id,doctor_id,clinic_date)
);
ALTER TABLE solo_closeouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE solo_closeouts FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON solo_closeouts
  USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON solo_closeouts TO sahayak_app;
