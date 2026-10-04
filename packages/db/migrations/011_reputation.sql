-- Reputation: private 1-5 feedback after a visit, review link offered to everyone, public clinic page.
ALTER TABLE clinic_settings ADD COLUMN reputation jsonb NOT NULL DEFAULT '{"enabled": false, "review_url": "", "delay_hours": 3, "show_rating": false}';
ALTER TABLE clinic_settings ADD COLUMN public_page jsonb NOT NULL DEFAULT '{"about": ""}';

ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_kind_check;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_kind_check CHECK (kind IN ('reminder','post_visit','recall','review_request'));
ALTER TABLE follow_ups ADD COLUMN queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL;

CREATE TABLE visit_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL,
  queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON visit_feedback (clinic_id, created_at DESC);
ALTER TABLE visit_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON visit_feedback USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- Public clinic page: reads only what the clinic chose to publish, nothing about patients except an aggregate rating.
CREATE OR REPLACE FUNCTION public_clinic_profile(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c clinics%ROWTYPE; s clinic_settings%ROWTYPE; docs jsonb; r jsonb;
BEGIN
  SELECT * INTO c FROM clinics WHERE slug = p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM clinic_settings WHERE clinic_id = c.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'speciality', d.speciality, 'qualifications', d.qualifications, 'registrationNo', d.registration_no, 'whatsapp', d.whatsapp_number) ORDER BY d.name), '[]')
    INTO docs FROM doctors d WHERE d.clinic_id = c.id AND d.active;
  r := NULL;
  IF COALESCE((s.reputation->>'show_rating')::boolean, false) THEN
    SELECT jsonb_build_object('average', round(avg(rating)::numeric, 1), 'count', count(*)) INTO r FROM visit_feedback WHERE clinic_id = c.id;
    IF (r->>'count')::int < 10 THEN r := NULL; END IF;   -- too few ratings to publish
  END IF;
  RETURN jsonb_build_object('name', c.name, 'slug', c.slug, 'about', COALESCE(s.public_page->>'about', ''), 'address', s.address, 'directions', s.directions, 'phone', s.phone,
    'timings', s.timings, 'whatsapp', s.whatsapp_number, 'doctors', docs, 'rating', r);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION public_clinic_profile(text) TO sahayak_app;
