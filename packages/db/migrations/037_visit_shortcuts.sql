-- Doctor shortcuts: visit templates (text skeletons the doctor fills in) and favourite medicine lines.
CREATE TABLE visit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX visit_templates_name ON visit_templates (doctor_id, lower(name));

CREATE TABLE favourite_medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  line text NOT NULL CHECK (length(line) BETWEEN 2 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, line)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visit_templates','favourite_medicines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON visit_templates, favourite_medicines TO sahayak_app;
