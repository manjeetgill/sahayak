-- "I'm away": days a doctor takes no bookings. Checked in the one place free slots are computed.
CREATE TABLE doctor_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 180)
);
CREATE INDEX doctor_leave_doctor ON doctor_leave (doctor_id, starts_on, ends_on);
ALTER TABLE doctor_leave ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_leave FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON doctor_leave USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_leave TO sahayak_app;
